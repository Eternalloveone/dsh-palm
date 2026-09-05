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
  /** VAPID key pair, generated on first Web Push enable (L2). */
  vapid?: { publicKey: string; privateKey: string }
  /** Third-party channel credentials (L3); empty strings mean disabled. */
  channels?: {
    serverchan?: { sendKey: string }
    bark?: { key: string }
    telegram?: { botToken: string; chatId: string }
    pushplus?: { token: string }
  }
  /** Lock-screen privacy: strip session titles and task names from every
   *  delivered notification (all channels share one decision). */
  hideDetails?: boolean
  /** Per-kind notification gates (absent → defaults: jobs off, todo on,
   *  turns off — the quiet-by-default stance). */
  kinds?: {
    /** Background jobs (bash/pwsh …) terminal transitions. */
    jobs?: boolean
    /** The todo plan reaching all-completed. */
    todo?: boolean
    /** Turns longer than the threshold. */
    turns?: boolean
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
}

/** Hard cap on stored subscriptions (oldest evicted when full). */
export const MAX_SUBSCRIPTIONS = 64

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
}
