/**
 * The pairing idle window and the device audit log.
 *
 * Regression cover for "the phone suddenly wants the pairing code again":
 * the primary device must survive an idle window (it is only removed by an
 * explicit revoke()/stop()), non-primary devices must still expire (the
 * eviction was not switched off), the default window must match the device
 * cookie lifetime, and every device that leaves the table must leave an
 * audit record — best-effort, never able to break pairing or the gate.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isPairedDeviceRequest } from '../src/gate.ts'
import { DEFAULT_IDLE_EXPIRE_MS, PairingService, type PairingClock, type PairingConfig } from '../src/pairing.ts'

const DAY_MS = 24 * 60 * 60 * 1000

/** One audit-log line (fields stay unknown: the test asserts their shape). */
interface AuditRecord {
  at?: unknown
  action?: unknown
  deviceId?: unknown
  reason?: unknown
  userAgent?: unknown
}

let dir: string

beforeEach(() => {
  // A temp directory per test: the real `~/.dsh` device store is never touched.
  dir = mkdtempSync(join(tmpdir(), 'dsh-palm-idle-audit-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** A remote (non-loopback) request carrying the device cookie. */
function phoneRequest(deviceId: string): IncomingMessage {
  const request = Readable.from([]) as unknown as IncomingMessage
  Object.assign(request, {
    headers: { host: '192.168.1.5:3080', cookie: `dsh_pair=${deviceId}` },
    socket: { remoteAddress: '192.168.1.5' },
  })
  return request
}

/** Parse the audit log (one JSON object per line). */
function readAudit(file: string): AuditRecord[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line !== '')
    .map(line => JSON.parse(line) as AuditRecord)
}

interface Harness {
  service: PairingService
  clock: PairingClock & { advance(ms: number): void }
  devicesFile: string
  auditFile: string
  advance(ms: number): void
  /** Issue a token and accept it: a freshly paired device. */
  pair(userAgent?: string): string
}

function makeHarness(overrides: Partial<PairingConfig> = {}): Harness {
  let time = Date.parse('2026-01-01T00:00:00.000Z')
  let serial = 0
  const clock = {
    now: () => time,
    randomToken: () => `tok${(serial++).toString().padStart(6, '0')}`,
    randomCode: () => `4829${String(serial % 10)}${String((serial + 1) % 10)}`,
    advance: (ms: number) => { time += ms },
  }
  const devicesFile = join(dir, 'devices.json')
  const service = new PairingService({
    tokenTtlMs: 60_000,
    offlineAfterMs: 25_000,
    maxDevices: 4,
    idleExpireMs: DEFAULT_IDLE_EXPIRE_MS,
    cookieName: 'dsh_pair',
    devicesFile,
    ...overrides,
  }, clock)
  service.setPublicBaseUrl('https://pairing.example.test')
  const pair = (userAgent?: string): string => {
    const { token } = service.issue()
    const result = service.accept(token, userAgent)
    if (!result.ok) throw new Error(`pair failed: ${result.code}`)
    return result.deviceId
  }
  return {
    service,
    clock,
    devicesFile,
    auditFile: join(dir, 'devices.audit.log'),
    advance: clock.advance,
    pair,
  }
}

describe('pairing idle window', () => {
  it('keeps the primary device valid across a full idle window (gate path)', () => {
    const harness = makeHarness()
    const primaryId = harness.pair('Mozilla/5.0 PrimaryPhone')
    // The first paired device becomes the protected primary.
    expect(harness.service.snapshot().devices[0]?.primary).toBe(true)
    harness.advance(DEFAULT_IDLE_EXPIRE_MS + DAY_MS)
    // The phone the user actually uses still passes the gate...
    expect(isPairedDeviceRequest(harness.service, phoneRequest(primaryId))).toBe(true)
    // ...and the session was not silently deleted on the way.
    expect(harness.service.snapshot().devices.map(device => device.id)).toEqual([primaryId])
    expect(harness.service.snapshot().devices[0]?.lastSeenAt).toBe(Date.parse('2026-01-01T00:00:00.000Z') + DEFAULT_IDLE_EXPIRE_MS + DAY_MS)
  })

  it('restores the primary device across a restart after a full idle window', () => {
    const harness = makeHarness()
    const primaryId = harness.pair()
    harness.advance(DEFAULT_IDLE_EXPIRE_MS + DAY_MS)
    // A new process instance reloads the persisted session instead of pruning it.
    const restarted = new PairingService({
      tokenTtlMs: 60_000,
      offlineAfterMs: 25_000,
      maxDevices: 4,
      idleExpireMs: DEFAULT_IDLE_EXPIRE_MS,
      cookieName: 'dsh_pair',
      devicesFile: harness.devicesFile,
    }, harness.clock)
    expect(restarted.hasDevice(primaryId)).toBe(true)
    expect(isPairedDeviceRequest(restarted, phoneRequest(primaryId))).toBe(true)
  })

  it('still idle-evicts a non-primary device at the gate', () => {
    const harness = makeHarness()
    const primaryId = harness.pair()
    const secondaryId = harness.pair()
    harness.advance(DEFAULT_IDLE_EXPIRE_MS + 1)
    // Removing the exemption carve-out must not remove the eviction itself.
    expect(isPairedDeviceRequest(harness.service, phoneRequest(secondaryId))).toBe(false)
    expect(harness.service.snapshot().devices.map(device => device.id)).toEqual([primaryId])
    // The deletion is audited as a gated-request eviction.
    expect(readAudit(harness.auditFile).filter(record => record.action === 'live-evict')).toEqual([
      expect.objectContaining({ deviceId: secondaryId.slice(0, 8) }),
    ])
  })

  it('still idle-evicts a non-primary device on sweep', () => {
    const harness = makeHarness()
    const primaryId = harness.pair()
    const secondaryId = harness.pair()
    harness.advance(DEFAULT_IDLE_EXPIRE_MS + 1)
    harness.service.sweep()
    expect(harness.service.snapshot().devices.map(device => device.id)).toEqual([primaryId])
    expect(readAudit(harness.auditFile).some(record =>
      record.action === 'idle-evict' && record.deviceId === secondaryId.slice(0, 8),
    )).toBe(true)
  })

  it('keeps a non-primary device alive just inside the window and drops it just past it', () => {
    const harness = makeHarness()
    harness.pair()
    const secondaryId = harness.pair()
    harness.advance(89 * DAY_MS)
    expect(harness.service.hasDevice(secondaryId)).toBe(true)
    harness.advance(2 * DAY_MS)
    expect(harness.service.hasDevice(secondaryId)).toBe(false)
  })

  it('defaults the idle window to 90 days, the same window as the device cookie', () => {
    expect(DEFAULT_IDLE_EXPIRE_MS).toBe(90 * DAY_MS)
    expect(DEFAULT_IDLE_EXPIRE_MS).toBe(7_776_000_000)
    // routes.ts derives the cookie's Max-Age from this constant and
    // tests/routes.spec.ts independently pins the rendered header to
    // `Max-Age=7776000`: a window change has to fail both gates together.
    expect(DEFAULT_IDLE_EXPIRE_MS / 1000).toBe(7_776_000)
    // The 7-day default used to undercut the 90-day cookie, so a device
    // expired while the phone still held a valid cookie.
    expect(DEFAULT_IDLE_EXPIRE_MS).toBeGreaterThan(7 * DAY_MS)
  })
})

describe('device audit log', () => {
  it('appends one complete JSON line per device event beside the device store', () => {
    const harness = makeHarness()
    const deviceId = harness.pair('Mozilla/5.0 AuditPhone')
    // The path is derived from devicesFile: devices.json -> devices.audit.log.
    expect(harness.auditFile).toBe(join(dir, 'devices.audit.log'))
    expect(existsSync(harness.auditFile)).toBe(true)
    expect(harness.service.revoke(deviceId)).toBe(true)

    const records = readAudit(harness.auditFile)
    expect(records.map(record => record.action)).toEqual(['accept', 'revoke'])
    for (const record of records) {
      expect(Object.keys(record).sort()).toEqual(['action', 'at', 'deviceId', 'reason', 'userAgent'])
      expect(new Date(String(record.at)).toISOString()).toBe(record.at)
      // Device ids are session credentials: only the 8-char prefix is written.
      expect(String(record.deviceId)).toBe(deviceId.slice(0, 8))
      expect(String(record.deviceId)).toHaveLength(8)
      expect(String(record.reason).length).toBeGreaterThan(0)
    }
    expect(records[0]).toMatchObject({ action: 'accept', userAgent: 'Mozilla/5.0 AuditPhone' })
    expect(records[1]).toMatchObject({ action: 'revoke', reason: 'revoked explicitly' })
  })

  it('records stop() for every device it drops', () => {
    const harness = makeHarness()
    const firstId = harness.pair()
    const secondId = harness.pair()
    harness.service.stop()
    const stops = readAudit(harness.auditFile).filter(record => record.action === 'stop')
    expect(stops).toHaveLength(2)
    expect(stops.map(record => record.deviceId).sort()).toEqual([firstId.slice(0, 8), secondId.slice(0, 8)].sort())
    expect(stops.every(record => String(record.reason).includes('stopped'))).toBe(true)
    // stop() semantics are untouched: the table is empty and the gate refuses.
    expect(harness.service.snapshot().deviceCount).toBe(0)
    expect(harness.service.hasDevice(firstId)).toBe(false)
  })

  it('rotates the log to .audit.log.1 instead of growing without bound', () => {
    const harness = makeHarness()
    harness.pair()
    // A log already past ~1 MB: the next append rotates it first.
    writeFileSync(harness.auditFile, 'x'.repeat(1_000_001))
    harness.pair()
    expect(existsSync(`${harness.auditFile}.1`)).toBe(true)
    expect(statSync(`${harness.auditFile}.1`).size).toBe(1_000_001)
    expect(readAudit(harness.auditFile).map(record => record.action)).toEqual(['accept'])
  })

  it('never lets an unwritable audit log affect pairing, eviction, or revocation', () => {
    const harness = makeHarness()
    const primaryId = harness.pair()
    // A directory at the log path makes every append fail.
    rmSync(harness.auditFile, { force: true })
    mkdirSync(harness.auditFile)
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const secondaryId = harness.pair()
      expect(harness.service.hasDevice(secondaryId)).toBe(true)
      harness.advance(DEFAULT_IDLE_EXPIRE_MS + 1)
      // The gate still evicts the idle non-primary device...
      expect(isPairedDeviceRequest(harness.service, phoneRequest(secondaryId))).toBe(false)
      // ...the primary is still live, and revoke() still works.
      expect(harness.service.hasDevice(primaryId)).toBe(true)
      expect(harness.service.revoke(primaryId)).toBe(true)
      expect(harness.service.hasDevice(primaryId)).toBe(false)
      // The failure is reported, never silent and never fatal.
      expect(reported).toHaveBeenCalled()
    } finally {
      reported.mockRestore()
    }
  })

  it('keeps the trail memory-only when devicesFile is unset', () => {
    const service = new PairingService({
      tokenTtlMs: 60_000,
      offlineAfterMs: 25_000,
      maxDevices: 4,
      idleExpireMs: DEFAULT_IDLE_EXPIRE_MS,
      cookieName: 'dsh_pair',
    }, {
      now: () => 1_000_000,
      randomToken: () => 'tok-1',
      randomCode: () => '482913',
    })
    service.setPublicBaseUrl('https://pairing.example.test')
    const { token } = service.issue()
    expect(service.accept(token).ok).toBe(true)
    // No path to derive the log from: nothing is written and nothing throws.
    expect(readdirSync(dir)).toEqual([])
  })
})
