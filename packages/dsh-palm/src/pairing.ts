/**
 * Pairing state machine: one active one-time token, a device-session table,
 * and presence tracking. Pure TypeScript with injected clock/randomness so
 * the whole security semantics are unit-testable without cordis. The
 * cordis-facing surfaces (routes, the api/gate listener) live next door.
 *
 * Security invariants:
 * - One active token at a time; `issue()` replaces it, so a refreshed QR
 *   immediately invalidates the previous link.
 * - A token is consumed by the first successful `accept()` — reuse is
 *   refused with `'used'`.
 * - Tokens expire; `accept()` on an expired token is refused like an
 *   unknown one (no oracle for validity).
 * - `stop()` revokes every device session and clears the token, so paired
 *   devices are cut off on their next gated request.
 * - `revoke()` drops one device session; idle sessions older than
 *   `idleExpireMs` are deleted on sweep, load, and the next gated request —
 *   except the primary device, which only `revoke()` and `stop()` remove.
 * - Every device that leaves the table is appended to a best-effort audit
 *   log beside `devicesFile` (`<devicesFile stem>.audit.log`, one JSON line
 *   per action) so a "why do I have to pair again" report is diagnosable.
 */

import { randomBytes, randomInt } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'

/** The observable pairing phases the panel renders. */
export type PairingPhase =
  /** The server is not bound all-interfaces: no usable QR exists. */
  | 'lan-required'
  /** Remote control was stopped; a fresh QR (issue) re-enables it. */
  | 'stopped'
  /** A token is live and no device has paired with it yet. */
  | 'waiting'
  /** At least one paired device was active recently. */
  | 'connected'
  /** Devices are paired but none has been active within the offline window. */
  | 'disconnected'

/** One issued pairing token (keyed by its secret). */
export interface TokenRecord {
  /** Monotonic issue time (ms epoch), drives refresh ordering. */
  issuedAt: number
  /** Absolute expiry (ms epoch); accept() past this is refused. */
  expiresAt: number
  /** Consumed by the first successful accept(). */
  consumed: boolean
  /** Opaque, non-secret identifier surfaced in snapshots (never the pairing secret). */
  id: string
  /** Workspace the QR link should land the phone in (optional). */
  workspaceId?: string
  /** LAN IP literal the QR link was built from (optional; default first). */
  address?: string
  /** Six-digit human-readable pairing code bound to this token (optional). */
  code?: string
}

/**
 * Default idle-expiry window: 90 days without a heartbeat or a gated request.
 *
 * This is deliberately the same window as the device cookie lifetime:
 * `routes.ts` derives the cookie's `Max-Age` from this constant, so the two
 * cannot drift. A cookie that outlives its session — or a session dropped
 * while its cookie is still live — both read to the user as "the phone wants
 * the pairing code again".
 */
export const DEFAULT_IDLE_EXPIRE_MS = 90 * 24 * 60 * 60 * 1000

/** Device-lifecycle actions recorded in the audit log. */
type DeviceAuditAction =
  | 'accept'
  | 'stop'
  | 'revoke'
  | 'idle-evict'
  | 'live-evict'
  | 'store-restore'

/**
 * A spare copy of the device store, written beside it on every persist. A
 * store that comes back empty or missing cannot be told apart from a fresh
 * install, so this copy is what lets a wipe be undone instead of making the
 * phone pair all over again.
 */
function backupOf(file: string): string {
  return `${file}.bak`
}

/** Rotate the device audit log once it passes ~1 MB (to `<file>.1`). */
const AUDIT_LOG_MAX_BYTES = 1_000_000

/** Device ids are session credentials: the audit log keeps only a prefix. */
const AUDIT_DEVICE_ID_CHARS = 8

/** Cap on the persisted/displayed User-Agent string. */
const MAX_USER_AGENT_CHARS = 180

/** One paired device session, keyed by the device id stored in its cookie. */
export interface DeviceSession {
  /** Pairing time (ms epoch). */
  createdAt: number
  /** Last time the device passed a gated request or heartbeat. */
  lastSeenAt: number
  /** Sanitized User-Agent captured at accept (optional; missing on old files). */
  userAgent?: string
  /** User-assigned display name (e.g. "我的手机"); optional. */
  name?: string
  /** The primary device is never auto-evicted by the device cap. */
  primary?: boolean
}

/** One device row in a loopback snapshot (ids are session credentials). */
export interface DeviceSnapshot {
  /** Cookie value / session credential of this device. */
  id: string
  /** Pairing time (ms epoch). */
  createdAt: number
  /** Last heartbeat or gated request (ms epoch). */
  lastSeenAt: number
  /** Whether lastSeenAt is within the offline window. */
  online: boolean
  /** Sanitized User-Agent captured at accept, when known. */
  userAgent?: string
  /** User-assigned display name, when set. */
  name?: string
  /** Whether this device is the protected primary. */
  primary?: boolean
}

/** One snapshot frame pushed to desktop status streams. */
export interface PairingSnapshot {
  phase: PairingPhase
  /** Whether the server bind is all-interfaces (a QR is constructible). */
  lanAvailable: boolean
  /** The LAN IP literals a QR can be built from (interface order). */
  lanAddresses: string[]
  /** Configured public (tunneled) base URL, when present. */
  publicUrl?: string
  /** Opaque (non-secret) id of the active token (undefined when stopped/lan-required). */
  tokenId?: string
  /** Absolute expiry of the active token. */
  tokenExpiresAt?: number
  /** Count of ever-paired devices. */
  deviceCount: number
  /** Count of devices active within the offline window. */
  onlineCount: number
  /** Per-device roster for the loopback panel (never sent on /api/pair/status). */
  devices: DeviceSnapshot[]
}

/** Service tunables (config-validated upstream; plain numbers here). */
export interface PairingConfig {
  /** Token lifetime; the QR stops working after this. */
  tokenTtlMs: number
  /** A device is "online" while its lastSeenAt is newer than this. */
  offlineAfterMs: number
  /** Hard cap on paired device sessions (oldest-evicted when full). */
  maxDevices: number
  /** Cookie name carrying the device id. */
  cookieName: string
  /**
   * Idle sessions older than this are deleted (memory and disk). Defaults
   * to {@link DEFAULT_IDLE_EXPIRE_MS} when omitted.
   */
  idleExpireMs?: number
  /**
   * Path to a JSON file where paired device sessions are persisted. When
   * set, sessions survive process restarts (the phone keeps its 90-day
   * cookie), so re-pairing after a dsh web restart is not required. The
   * device audit log is derived from this path. When unset, sessions and
   * their audit trail stay memory-only.
   */
  devicesFile?: string
}

/** Result of one accept() attempt. */
export type AcceptResult =
  | { ok: true; deviceId: string }
  | { ok: false; code: 'invalid' | 'used' | 'device-cap-full' }

/** Cap on a user-assigned device display name. */
export const MAX_DEVICE_NAME_CHARS = 40

/** Thrown by issue() for an address outside the sampled LAN literals. */
export class UnknownLanAddressError extends Error {
  /**
   * @param address - the offending literal.
   */
  constructor(address: string) {
    super(`dsh-palm: unknown LAN address ${JSON.stringify(address)}`)
    this.name = 'UnknownLanAddressError'
  }
}

/** Clock and entropy injection for tests. */
export interface PairingClock {
  now(): number
  randomToken(): string
  /** Six-digit numeric pairing code (leading zeros allowed). */
  randomCode(): string
}

/** Real clock/entropy: 32 random hex chars per token, 6 random digits per code. */
export const defaultClock: PairingClock = {
  now: () => Date.now(),
  randomToken: () => randomBytes(16).toString('hex'),
  randomCode: () => String(randomInt(0, 1_000_000)).padStart(6, '0'),
}

/** Parse one device store file. Undefined when it is missing or unusable. */
function readDeviceStore(file: string): Map<string, DeviceSession> | undefined {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (typeof saved !== 'object' || saved === null) return undefined
    const store = new Map<string, DeviceSession>()
    for (const [deviceId, session] of Object.entries(saved)) {
      if (typeof deviceId !== 'string') continue
      if (typeof session !== 'object' || session === null) continue
      const { createdAt, lastSeenAt, userAgent, name, primary } = session as {
        createdAt?: unknown
        lastSeenAt?: unknown
        userAgent?: unknown
        name?: unknown
        primary?: unknown
      }
      if (typeof createdAt !== 'number' || typeof lastSeenAt !== 'number') continue
      const label = typeof userAgent === 'string' ? sanitizeUserAgent(userAgent) : undefined
      const deviceName = typeof name === 'string' ? name.trim().slice(0, MAX_DEVICE_NAME_CHARS) : undefined
      store.set(deviceId, {
        createdAt,
        lastSeenAt,
        ...(label !== undefined ? { userAgent: label } : {}),
        ...(deviceName !== undefined && deviceName !== '' ? { name: deviceName } : {}),
        ...(primary === true ? { primary: true } : {}),
      })
    }
    return store
  } catch {
    return undefined
  }
}

/**
 * The pairing state machine. Structural mutations issue/accept/stop/revoke
 * and config updates (LAN bases, public base) notify state listeners
 * after the commit point that makes them true, and notification dedupes
 * against the last emitted snapshot. Presence-only updates (touchDevice /
 * heartbeat) just mark the store dirty and broadcast on the next sweep,
 * which also surfaces time-driven transitions (a device aging offline)
 * without any mutation.
 */
export class PairingService {
  private readonly tokens = new Map<string, TokenRecord>()
  /** Six-digit pairing-code index: code → token secret (one live code at a time). */
  private readonly codeIndex = new Map<string, string>()
  private readonly devices = new Map<string, DeviceSession>()
  private readonly listeners = new Set<(snapshot: PairingSnapshot) => void>()
  private lastEmitted: PairingSnapshot | undefined
  private stopped = false
  private tokenSerial = 0
  /** LAN base URLs keyed by the advertised IP literal (interface order). */
  private lanBases = new Map<string, string>()
  /** Public (tunneled) base URL, e.g. a Cloudflare Tunnel quick URL. */
  private publicBase: string | undefined
  /** True when lastSeenAt changed since the last persist (flushed on sweep). */
  private dirty = false

  /**
   * @param config - tunables. The settings surface replaces the object (a
   * fresh literal) when a committed section changes; every operation reads
   * the current one.
   * @param clock - clock/entropy source (injectable for tests).
   */
  constructor(
    public config: PairingConfig,
    private readonly clock: PairingClock = defaultClock,
  ) {
    this.loadPersisted()
  }

  /**
   * Restore device sessions persisted by a previous process run. A corrupt
   * or missing file is tolerated (an empty device table, never a throw) —
   * persistence is an availability convenience, not a security boundary.
   *
   * An empty store is ambiguous: it is what a fresh install looks like, and
   * it is also what a wiped file looks like. The spare copy written by
   * persist() settles it — a spare with devices in it means the store was
   * lost, so the devices come back instead of the phone having to pair again.
   */
  private loadPersisted(): void {
    const file = this.config.devicesFile
    if (file === undefined) return
    let restored = false
    this.adopt(readDeviceStore(file))
    if (this.devices.size === 0) {
      const spare = readDeviceStore(backupOf(file))
      if (spare !== undefined && spare.size > 0) {
        this.adopt(spare)
        restored = true
        this.audit('store-restore', '-', 'the device store was empty or missing; restored from the backup copy')
      }
    }
    this.clampToMaxDevices()
    const evicted = this.evictIdle()
    // A store written by an older build has no copy beside it yet; write one
    // now so the protection starts with this boot rather than the next pair.
    const copyMissing = this.devices.size > 0 && readDeviceStore(backupOf(file))?.size !== this.devices.size
    // The restored table is written back so the store and its copy agree
    // again; otherwise the next boot repeats the restore.
    if (restored || evicted || copyMissing) this.persist()
    // One line per boot: "the phone wants the code again" is otherwise
    // invisible until someone connects, and this count is what tells a fresh
    // install apart from a store that failed to load.
    console.log(
      `[dsh-palm] device store: ${String(this.devices.size)} device(s) from ${file}` +
      `${restored ? ' (restored from the backup copy)' : ''}`,
    )
  }

  /** Merge one parsed store into the live table (no side effects). */
  private adopt(store: Map<string, DeviceSession> | undefined): void {
    if (store === undefined) return
    for (const [deviceId, session] of store) this.devices.set(deviceId, session)
  }

  /** FIFO-cap the device table (a persisted file may outlive a lowered cap). */
  private clampToMaxDevices(): void {
    if (this.devices.size <= this.config.maxDevices) return
    const overflow = this.devices.size - this.config.maxDevices
    // Never drop the primary; evict the oldest-created non-primary sessions.
    const ordered = [...this.devices.entries()]
      .filter(([, session]) => session.primary !== true)
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
    for (const [id] of ordered.slice(0, overflow)) this.devices.delete(id)
  }

  /**
   * Drop sessions whose lastSeenAt is older than idleExpireMs. The primary
   * device is exempt: it only leaves through revoke() or stop().
   */
  private evictIdle(): boolean {
    const now = this.clock.now()
    const limit = this.config.idleExpireMs ?? DEFAULT_IDLE_EXPIRE_MS
    let removed = false
    for (const [id, session] of [...this.devices]) {
      if (session.primary === true) continue
      if (now - session.lastSeenAt > limit) {
        this.devices.delete(id)
        this.audit('idle-evict', id, `idle for more than ${String(limit)} ms`, session.userAgent)
        removed = true
      }
    }
    return removed
  }

  /**
   * Write the current device table to the configured file. Called on the
   * mutation boundaries that change the set of live sessions (accept, stop,
   * revoke, idle eviction) and, throttled, from sweep() so lastSeenAt
   * survives a restart without a write per request.
   *
   * Device ids are session credentials (the gate authorizes requests by the
   * cookie's device id), so the file is written 0600 via a temp file and
   * atomic rename; a crash mid-write can never leave a half-written store.
   *
   * The spare copy beside it is written from the same bytes on every call, so
   * it can only ever disagree with the store when something outside this
   * process removed or emptied the store — which is exactly when it is used.
   * A wipe this process *meant* to do (revoke, stop) updates both files, so a
   * revoked device is never resurrected from the copy.
   */
  private persist(): void {
    const file = this.config.devicesFile
    if (file === undefined) return
    try {
      mkdirSync(dirname(file), { recursive: true })
      const payload: Record<string, DeviceSession> = {}
      for (const [id, session] of this.devices) payload[id] = session
      const body = JSON.stringify(payload)
      for (const target of [file, backupOf(file)]) {
        const temp = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
        writeFileSync(temp, body, { mode: 0o600 })
        renameSync(temp, target)
      }
      this.dirty = false
    } catch (error) {
      console.error('dsh-palm: failed to persist paired devices', error)
    }
  }

  /**
   * `<devicesFile stem>.audit.log`, beside the device store. Undefined when
   * the store is memory-only (nothing to derive the location from).
   */
  private auditFile(): string | undefined {
    const file = this.config.devicesFile
    if (file === undefined || file === '') return undefined
    return join(dirname(file), `${basename(file, extname(file))}.audit.log`)
  }

  /**
   * Append one device-lifecycle record as a single JSON line. Best-effort by
   * contract: an unwritable log is reported on stderr and never throws, so
   * losing the trail can never block pairing, revocation, or a gated request
   * (the log is a debugging aid, not a security boundary).
   * @param action - what happened to the device.
   * @param deviceId - the session credential (only its prefix is written).
   * @param reason - human-readable explanation of the record.
   * @param userAgent - sanitized User-Agent of the device, when known.
   */
  private audit(action: DeviceAuditAction, deviceId: string, reason: string, userAgent?: string): void {
    try {
      const file = this.auditFile()
      if (file === undefined) return
      this.rotateAuditLog(file)
      const record = {
        at: new Date(this.clock.now()).toISOString(),
        action,
        deviceId: deviceId.slice(0, AUDIT_DEVICE_ID_CHARS),
        reason,
        ...(userAgent !== undefined ? { userAgent } : {}),
      }
      mkdirSync(dirname(file), { recursive: true })
      appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 })
    } catch (error) {
      console.error('dsh-palm: failed to append the device audit log', error)
    }
  }

  /**
   * Keep the audit log bounded: once it passes the size cap it is moved to
   * `<file>.1` (replacing an older rotation). A failed rotation leaves the
   * current file in place — the next append retries.
   */
  private rotateAuditLog(file: string): void {
    let size: number
    try {
      size = statSync(file).size
    } catch {
      return // no log yet
    }
    if (size < AUDIT_LOG_MAX_BYTES) return
    try {
      renameSync(file, `${file}.1`)
    } catch (error) {
      console.error('dsh-palm: failed to rotate the device audit log', error)
    }
  }

  /** The default LAN base URL (the first interface; undefined when not LAN-reachable). */
  get lanBaseUrl(): string | undefined {
    return this.lanBases.values().next().value as string | undefined
  }

  /** The LAN base URL for one specific literal (undefined when not constructible). */
  lanBaseUrlFor(address: string): string | undefined {
    return this.lanBases.get(address)
  }

  /** The LAN IP literals QR links can be built from (interface order). */
  get lanAddresses(): string[] {
    return [...this.lanBases.keys()]
  }

  /** Set the LAN base URLs once the server bind is known (interface order). */
  setLanBases(entries: readonly { address: string; base: string }[]): void {
    this.lanBases = new Map(entries.map(entry => [entry.address, entry.base]))
    this.notify()
  }

  /** The configured public (tunneled) base URL, when present. */
  get publicBaseUrl(): string | undefined {
    return this.publicBase
  }

  /** Set or clear the public base URL (a tunnel in front of this server). */
  setPublicBaseUrl(url: string | undefined): void {
    this.publicBase = url
    this.notify()
  }

  /**
   * Issue a fresh token, replacing (invalidating) any previous one. A
   * stopped service re-arms through this call (the panel's refresh button).
   * @param workspaceId - optional workspace the QR link should land in.
   * @param address - optional LAN IP literal the QR must be built from; the
   * default is the public base (when configured) or the first interface.
   * Unknown addresses are refused.
   * @returns the token secret and its expiry.
   * @throws {Error} when no reachable base exists (no all-interfaces bind and
   * no public base) — callers surface this as the lan-required state instead
   * of minting an unusable QR.
   */
  issue(workspaceId?: string, address?: string): { token: string; code: string; expiresAt: number } {
    if (this.lanBases.size === 0 && this.publicBase === undefined) {
      throw new Error('dsh-palm: pairing requires a reachable bind (--host 0.0.0.0 or publicBaseUrl)')
    }
    if (address !== undefined && !this.lanBases.has(address)) {
      throw new UnknownLanAddressError(address)
    }
    const now = this.clock.now()
    const token = this.clock.randomToken()
    const code = this.clock.randomCode()
    this.tokens.clear()
    this.codeIndex.clear()
    this.stopped = false
    this.tokenSerial += 1
    this.tokens.set(token, {
      id: `t${this.tokenSerial}`,
      issuedAt: now,
      expiresAt: now + this.config.tokenTtlMs,
      consumed: false,
      code,
      ...(workspaceId !== undefined ? { workspaceId } : {}),
      ...(address !== undefined ? { address } : {}),
    })
    this.codeIndex.set(code, token)
    this.notify()
    return { token, code, expiresAt: now + this.config.tokenTtlMs }
  }

  /**
   * Consume a token or its six-digit pairing code and bind a device session.
   * One-time: the second successful call for the same secret is impossible
   * because the first consumes it.
   * @param secret - the token secret from the QR link, or the six-digit code
   * shown on the desktop panel.
   * @param userAgent - optional User-Agent header captured at accept.
   * @returns the new device id, or a refusal code.
   */
  accept(secret: string, userAgent?: string): AcceptResult {
    const token = this.tokens.has(secret) ? secret : this.codeIndex.get(secret)
    const record = token === undefined ? undefined : this.tokens.get(token)
    if (record === undefined || record.consumed || this.stopped || this.clock.now() > record.expiresAt) {
      return { ok: false, code: record?.consumed === true ? 'used' : 'invalid' }
    }
    record.consumed = true
    const deviceId = this.clock.randomToken()
    const now = this.clock.now()
    const isFirstDevice = this.devices.size === 0
    if (this.devices.size >= this.config.maxDevices) {
      // Smart eviction: never drop an online device or the primary. Prefer
      // the idle device with the oldest lastSeenAt (least recently active).
      // If every slot is held by an online device (or the primary), refuse
      // the new pairing with a clear code instead of silently cutting off a
      // live device — the UI guides the user to revoke one first.
      const onlineWindow = this.config.offlineAfterMs
      let evict: { id: string; lastSeenAt: number } | undefined
      for (const [id, session] of this.devices) {
        if (session.primary === true) continue
        if (now - session.lastSeenAt <= onlineWindow) continue // online: keep
        if (evict === undefined || session.lastSeenAt < evict.lastSeenAt) {
          evict = { id, lastSeenAt: session.lastSeenAt }
        }
      }
      if (evict === undefined) {
        record.consumed = false // roll back: the token stays usable
        return { ok: false, code: 'device-cap-full' }
      }
      this.devices.delete(evict.id)
    }
    const label = sanitizeUserAgent(userAgent)
    this.devices.set(deviceId, {
      createdAt: now,
      lastSeenAt: now,
      // The first paired device becomes the protected primary automatically.
      ...(isFirstDevice ? { primary: true } : {}),
      ...(label !== undefined ? { userAgent: label } : {}),
    })
    this.audit('accept', deviceId, isFirstDevice ? 'paired the first device (primary)' : 'paired a new device', label)
    this.persist()
    this.notify()
    return { ok: true, deviceId }
  }

  /**
   * Stop remote control: revoke every device session and clear the token.
   * The phone's next gated /api request 403s; the panel falls back to
   * stopped until a fresh QR is issued.
   */
  stop(): void {
    this.tokens.clear()
    this.codeIndex.clear()
    // One record per device: every id that disappears from the store is
    // individually accounted for in the audit log.
    for (const [id, session] of this.devices) {
      this.audit('stop', id, 'remote control stopped; every device was revoked', session.userAgent)
    }
    this.devices.clear()
    this.persist()
    this.stopped = true
    this.notify()
  }

  /**
   * Revoke one paired device. The next gated request from that cookie is
   * refused; other sessions stay live. Unknown ids are a no-op.
   * @param deviceId - the cookie value of the device to drop.
   * @returns true when a live session was removed.
   */
  revoke(deviceId: string): boolean {
    if (this.stopped) return false
    const session = this.devices.get(deviceId)
    if (session === undefined || !this.devices.delete(deviceId)) return false
    this.audit('revoke', deviceId, 'revoked explicitly', session.userAgent)
    this.persist()
    this.notify()
    return true
  }

  /**
   * Promote one device to primary, demoting the previous primary. The primary
   * is never auto-evicted by the device cap. Unknown ids are a no-op.
   * @param deviceId - the cookie value of the device to promote.
   * @returns true when a live session was promoted.
   */
  setPrimary(deviceId: string): boolean {
    if (this.stopped) return false
    const session = this.devices.get(deviceId)
    if (session === undefined) return false
    for (const [id, other] of this.devices) {
      if (id !== deviceId && other.primary === true) other.primary = false
    }
    session.primary = true
    this.persist()
    this.notify()
    return true
  }

  /**
   * Assign a user-facing display name to a device (empty clears it). Unknown
   * ids are a no-op.
   * @param deviceId - the cookie value of the device to rename.
   * @param name - the new display name (trimmed, capped).
   * @returns true when a live session was renamed.
   */
  renameDevice(deviceId: string, name: string): boolean {
    if (this.stopped) return false
    const session = this.devices.get(deviceId)
    if (session === undefined) return false
    const trimmed = name.trim().slice(0, MAX_DEVICE_NAME_CHARS)
    if (trimmed === '') delete session.name
    else session.name = trimmed
    this.persist()
    this.notify()
    return true
  }

  /**
   * The api/gate path: record activity for a device id and report whether
   * the request may proceed. Unknown or revoked ids (including any device
   * after stop() or idle expiry) are refused.
   *
   * Presence refreshes are throttled on purpose: every gated request (and
   * the mobile SSE keepalive) lands here, so a broadcast per call would fan
   * a full snapshot out to every status stream on the hot path. The refresh
   * only updates lastSeenAt and marks the store dirty; the snapshot reaches
   * listeners at the next sweep() (structural changes notify immediately).
   * @param deviceId - the cookie value of the requesting device.
   * @returns true when the device session is live and was refreshed.
   */
  touchDevice(deviceId: string): boolean {
    const session = this.liveSession(deviceId)
    if (session === undefined) return false
    session.lastSeenAt = this.clock.now()
    this.dirty = true
    return true
  }

  /** Explicit presence heartbeat (the phone's client sends these). */
  heartbeat(deviceId: string): boolean {
    return this.touchDevice(deviceId)
  }

  /**
   * Periodic sweep: drop idle sessions, flush a dirty lastSeenAt, and
   * re-evaluate the derived snapshot (a device aging past the offline
   * window flips the phase to disconnected). Emits only when the snapshot
   * actually changed.
   */
  sweep(): void {
    const evicted = this.evictIdle()
    if (evicted || this.dirty) this.persist()
    this.notify()
  }

  /** The current snapshot (fresh object per call — stable between emits). */
  snapshot(): PairingSnapshot {
    const now = this.clock.now()
    const devices = [...this.devices.entries()]
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
      .map(([id, session]) => this.toDeviceSnapshot(id, session, now))
    const onlineCount = devices.filter(device => device.online).length
    const token = this.activeToken()
    return {
      phase: this.derivePhase(onlineCount, token !== undefined),
      lanAvailable: this.lanBases.size > 0,
      lanAddresses: [...this.lanBases.keys()],
      ...(this.publicBase !== undefined ? { publicUrl: this.publicBase } : {}),
      ...(token !== undefined ? { tokenId: token.record.id, tokenExpiresAt: token.record.expiresAt } : {}),
      deviceCount: this.devices.size,
      onlineCount,
      devices,
    }
  }

  /** Whether a cookie value names a currently live (non-idle) device session. */
  hasDevice(deviceId: string): boolean {
    return this.liveSession(deviceId) !== undefined
  }

  /** Subscribe to snapshot changes (each emit passes a fresh snapshot). */
  onState(listener: (snapshot: PairingSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private activeToken(): { token: string; record: TokenRecord } | undefined {
    for (const [token, record] of this.tokens) {
      if (this.stopped) return undefined
      if (this.clock.now() > record.expiresAt) continue
      return { token, record }
    }
    return undefined
  }

  /**
   * Return a live session, deleting it first when idle-expired. Side-effecting
   * so a stale cookie cannot pass the gate between sweeps.
   *
   * The primary device is exempt from idle expiry, exactly as in
   * `evictIdle()`: the phone the user actually uses must not be silently
   * dropped, or the next visit greets them with a pairing prompt. It only
   * leaves through an explicit revoke() or stop().
   */
  private liveSession(deviceId: string): DeviceSession | undefined {
    if (this.stopped) return undefined
    const session = this.devices.get(deviceId)
    if (session === undefined) return undefined
    if (session.primary !== true) {
      const limit = this.config.idleExpireMs ?? DEFAULT_IDLE_EXPIRE_MS
      if (this.clock.now() - session.lastSeenAt > limit) {
        this.devices.delete(deviceId)
        this.audit('live-evict', deviceId, `idle for more than ${String(limit)} ms at a gated request`, session.userAgent)
        this.persist()
        this.notify()
        return undefined
      }
    }
    return session
  }

  private toDeviceSnapshot(id: string, session: DeviceSession, now: number): DeviceSnapshot {
    return {
      id,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      online: this.isOnlineAt(session, now),
      ...(session.userAgent !== undefined ? { userAgent: session.userAgent } : {}),
      ...(session.name !== undefined ? { name: session.name } : {}),
      ...(session.primary === true ? { primary: true } : {}),
    }
  }

  private derivePhase(onlineCount: number, hasToken: boolean): PairingPhase {
    if (this.lanBases.size === 0 && this.publicBase === undefined) return 'lan-required'
    if (this.stopped) return 'stopped'
    if (onlineCount > 0) return 'connected'
    if (this.devices.size > 0) return 'disconnected'
    if (hasToken) return 'waiting'
    return 'stopped'
  }

  private isOnlineAt(session: DeviceSession, now: number): boolean {
    return now - session.lastSeenAt <= this.config.offlineAfterMs
  }

  private notify(): void {
    const snapshot = this.snapshot()
    if (this.lastEmitted !== undefined && snapshotsEqual(this.lastEmitted, snapshot)) return
    this.lastEmitted = snapshot
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch (error) {
        // A throwing subscriber must not break the emit loop or the caller.
        console.error('dsh-palm: pairing state listener failed', error)
      }
    }
  }
}

/** Structural equality over the snapshot's wire fields. */
function snapshotsEqual(a: PairingSnapshot, b: PairingSnapshot): boolean {
  return a.phase === b.phase
    && a.lanAvailable === b.lanAvailable
    && sameStrings(a.lanAddresses, b.lanAddresses)
    && a.publicUrl === b.publicUrl
    && a.tokenId === b.tokenId
    && a.tokenExpiresAt === b.tokenExpiresAt
    && a.deviceCount === b.deviceCount
    && a.onlineCount === b.onlineCount
    && devicesEqual(a.devices, b.devices)
}

/** Per-device roster equality (order is pairing time). */
function devicesEqual(a: readonly DeviceSnapshot[], b: readonly DeviceSnapshot[]): boolean {
  return a.length === b.length && a.every((device, index) => {
    const other = b[index]
    return other !== undefined
      && device.id === other.id
      && device.createdAt === other.createdAt
      && device.lastSeenAt === other.lastSeenAt
      && device.online === other.online
      && device.userAgent === other.userAgent
      && device.name === other.name
      && device.primary === other.primary
  })
}

/** Element-wise string list equality (interface order is meaningful). */
function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/** Strip control characters and cap the User-Agent stored with a session. */
export function sanitizeUserAgent(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
  if (cleaned === '') return undefined
  return cleaned.length <= MAX_USER_AGENT_CHARS ? cleaned : cleaned.slice(0, MAX_USER_AGENT_CHARS)
}
