/**
 * Notification persistence for the mobile completion-notify feature.
 *
 * One JSON file under DSH_HOME holds the push configuration (turn
 * threshold, cooldown, VAPID keys, third-party channel credentials) and the
 * Web Push subscription table keyed by paired device id. Corrupt or missing
 * files are tolerated (defaults) — persistence is an availability
 * convenience, not a security boundary (the same stance as pairing.ts).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import webPush from 'web-push'
const { generateVAPIDKeys } = webPush

/** Tunables + credentials for the notify feature (see NotifyStore). */
export interface NotifyConfig {
  /** A turn shorter than this (ms) produces no turn-done notification. */
  turnThresholdMs: number
  /** Minimum gap between turn-done notifications of one session (ms). */
  turnCooldownMs: number
  /** Duplicate suppression window for the non-urgent kinds (ms): the same
   *  kind of event for the same session inside this window is dropped. 0
   *  disables it. Approvals and questions ignore it — they are never noise. */
  dedupeMs?: number
  /** VAPID key pair, generated on first Web Push enable (L2). */
  vapid?: { publicKey: string; privateKey: string }
  /** Third-party channel credentials (L3); empty strings mean disabled. */
  channels?: {
    serverchan?: { sendKey: string }
    bark?: { key: string }
    telegram?: { botToken: string; chatId: string }
    wxpusher?: { spt: string }
    /** Demoted, not deleted: pushplus now requires paid verification, so
     *  wxpusher took the recommended slot — but a config that already
     *  carries a pushplus token must keep delivering. */
    pushplus?: { token: string }
  }
  /** Lock-screen privacy: strip session titles and task names from every
   *  delivered notification (all channels share one decision). */
  hideDetails?: boolean
  /** Per-kind notification gates (absent → defaults: jobs off, todo on,
   *  turns off — the quiet-by-default stance; approvals on, because a
   *  blocked turn is the one thing the phone must not miss). */
  kinds?: {
    /** Background jobs (bash/pwsh …) terminal transitions. */
    jobs?: boolean
    /** The todo plan reaching all-completed. */
    todo?: boolean
    /** Turns longer than the threshold. */
    turns?: boolean
    /** Approval requests + questions waiting for an answer. */
    approvals?: boolean
  }
}

/** One Web Push subscription as the browser reported it (L2). */
export interface PushSubscriptionRecord {
  endpoint: string
  keys: { p256dh: string; auth: string }
  createdAt: number
  lastSeenAt: number
}

/** The persisted file shape. */
interface NotifyFile {
  config: NotifyConfig
  subscriptions: Record<string, PushSubscriptionRecord>
}

/** Defaults when the file is absent or corrupt. */
const DEFAULT_CONFIG: NotifyConfig = {
  turnThresholdMs: 30_000,
  turnCooldownMs: 120_000,
  dedupeMs: 15_000,
}

/** Hard cap on stored subscriptions (oldest evicted when full). */
export const MAX_SUBSCRIPTIONS = 64

/**
 * One delivery attempt. Notifications are best-effort by design, so when one
 * does not arrive the only way to answer "why?" is a record of what the host
 * actually tried: which channel, for which decision, and how it ended.
 */
export interface DeliveryRecord {
  at: number
  /** The decision id (see NotifyEvent.id). */
  eventId: string
  kind: string
  /** 'web-push' or a third-party adapter name. */
  channel: string
  /** 'dropped' means the host decided not to send it at all (duplicate, or
   *  an internal sub-turn the user does not care about). */
  status: 'sent' | 'failed' | 'dropped'
  /** HTTP status / error text, truncated. */
  detail?: string
}

/** How many delivery records to keep in memory (a debugging window, not a log). */
const MAX_DELIVERY_RECORDS = 200

/** Load a JSON file defensively; any failure yields the default shape. */
function loadFile(file: string): NotifyFile {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (typeof saved !== 'object' || saved === null) {
      return { config: { ...DEFAULT_CONFIG }, subscriptions: {} }
    }
    const record = saved as Partial<NotifyFile>
    const config = {
      ...DEFAULT_CONFIG,
      ...(typeof record.config === 'object' && record.config !== null ? record.config : {}),
    }
    const subscriptions = typeof record.subscriptions === 'object' && record.subscriptions !== null
      ? record.subscriptions
      : {}
    return { config, subscriptions }
  } catch {
    return { config: { ...DEFAULT_CONFIG }, subscriptions: {} }
  }
}

/**
 * Synchronous JSON persistence for the notify feature. Writes are
 * whole-file and synchronous (same stance as pairing.ts): the file is tiny
 * and writes are rare (subscribe/unsubscribe/config edits), so a blocking
 * write is simpler and safer than a queue.
 */
export class NotifyStore {
  private readonly file: string
  private data: NotifyFile
  private dirty = false

  constructor(file: string) {
    this.file = file
    this.data = loadFile(file)
  }

  /** The current config (live object; mutate through setConfig). */
  getConfig(): NotifyConfig {
    return this.data.config
  }

  /** Merge a config patch and persist. */
  setConfig(patch: Partial<NotifyConfig>): NotifyConfig {
    this.data.config = { ...this.data.config, ...patch }
    this.dirty = true
    this.persist()
    return this.data.config
  }

  /**
   * The VAPID key pair, generated on first use (idempotent). The public key
   * rides push.config reads so the phone can subscribe; the private key
   * never leaves this file.
   */
  ensureVapid(): { publicKey: string; privateKey: string } {
    if (this.data.config.vapid === undefined) {
      this.data.config.vapid = generateVAPIDKeys()
      this.dirty = true
      this.persist()
    }
    const vapid = this.data.config.vapid
    if (vapid === undefined) {
      // Unreachable: the branch above always assigns before this point.
      throw new Error('dsh-palm: VAPID key generation failed')
    }
    return vapid
  }

  /** All stored subscriptions (deviceId → record). */
  listSubscriptions(): Readonly<Record<string, PushSubscriptionRecord>> {
    return this.data.subscriptions
  }

  /** Store one device's subscription (FIFO-capped). */
  addSubscription(deviceId: string, subscription: Omit<PushSubscriptionRecord, 'createdAt' | 'lastSeenAt'>): void {
    const now = Date.now()
    this.data.subscriptions[deviceId] = { ...subscription, createdAt: now, lastSeenAt: now }
    const entries = Object.entries(this.data.subscriptions)
    if (entries.length > MAX_SUBSCRIPTIONS) {
      entries.sort((a, b) => a[1].createdAt - b[1].createdAt)
      for (const [id] of entries.slice(0, entries.length - MAX_SUBSCRIPTIONS)) {
        delete this.data.subscriptions[id]
      }
    }
    this.dirty = true
    this.persist()
  }

  /** Remove one device's subscription (unsubscribe / device revoked). */
  removeSubscription(deviceId: string): void {
    if (this.data.subscriptions[deviceId] === undefined) return
    delete this.data.subscriptions[deviceId]
    this.dirty = true
    this.persist()
  }

  /** Remove every subscription whose endpoint matches (410 cleanup). */
  removeSubscriptionByEndpoint(endpoint: string): void {
    let removed = false
    for (const [deviceId, record] of Object.entries(this.data.subscriptions)) {
      if (record.endpoint === endpoint) {
        delete this.data.subscriptions[deviceId]
        removed = true
      }
    }
    if (removed) {
      this.dirty = true
      this.persist()
    }
  }

  private persist(): void {
    if (!this.dirty) return
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8')
      this.dirty = false
    } catch (error) {
      console.error('dsh-palm: failed to persist notify state', error)
    }
  }

  /* ── delivery telemetry ──────────────────────────────────────────────── */

  /** Recent delivery attempts, oldest first. Memory only: a restarted host
   *  starts a fresh window rather than pretending it remembers. */
  private readonly deliveries: DeliveryRecord[] = []

  /** Record one attempt (bounded; oldest dropped). */
  recordDelivery(record: DeliveryRecord): void {
    this.deliveries.push(record)
    if (this.deliveries.length > MAX_DELIVERY_RECORDS) {
      this.deliveries.splice(0, this.deliveries.length - MAX_DELIVERY_RECORDS)
    }
  }

  /** Recent attempts, newest first. */
  recentDeliveries(limit = 40): DeliveryRecord[] {
    return this.deliveries.slice(-limit).reverse()
  }

  /**
   * Aggregated health for the settings page: how much went out, through
   * which channel, and how much failed — the numbers that tell you whether
   * silence means "nothing happened" or "delivery is broken".
   */
  deliverySummary(): {
    total: number
    sent: number
    failed: number
    dropped: number
    byChannel: Array<{ channel: string; sent: number; failed: number; dropped: number }>
    byKind: Array<{ kind: string; sent: number; failed: number; dropped: number }>
    since: number
  } {
    const byChannel = new Map<string, { sent: number; failed: number; dropped: number }>()
    const byKind = new Map<string, { sent: number; failed: number; dropped: number }>()
    let sent = 0
    let failed = 0
    let dropped = 0
    for (const record of this.deliveries) {
      const channelEntry = byChannel.get(record.channel) ?? { sent: 0, failed: 0, dropped: 0 }
      const kindEntry = byKind.get(record.kind) ?? { sent: 0, failed: 0, dropped: 0 }
      if (record.status === 'sent') {
        sent += 1
        channelEntry.sent += 1
        kindEntry.sent += 1
      } else if (record.status === 'dropped') {
        dropped += 1
        channelEntry.dropped += 1
        kindEntry.dropped += 1
      } else {
        failed += 1
        channelEntry.failed += 1
        kindEntry.failed += 1
      }
      byChannel.set(record.channel, channelEntry)
      byKind.set(record.kind, kindEntry)
    }
    return {
      total: this.deliveries.length,
      sent,
      failed,
      dropped,
      byChannel: [...byChannel].map(([channel, counts]) => ({ channel, ...counts })),
      byKind: [...byKind].map(([kind, counts]) => ({ kind, ...counts })),
      since: this.deliveries[0]?.at ?? 0,
    }
  }
}
