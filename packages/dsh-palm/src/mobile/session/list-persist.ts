/**
 * PWA cold-start persistence (v3.3): session-list rows, paging cursor,
 * preview summaries and scroll positions survive app relaunch through
 * localStorage (per-origin — the installed PWA window and browser tabs
 * share it). On boot the list re-renders INSTANTLY from this store and the
 * network refresh re-validates in the background; the store is bounded by
 * TTL (lists), capacity (previews), and pairing eviction (a revoked device
 * must not keep another device's sessions).
 *
 * Storage is best-effort everywhere: quota/private-mode failures disable
 * persistence silently (the caches still work in memory for the session).
 */

import type { SessionView } from '../shared/session-view.ts'

/**
 * Cross-mount list cache (v3.2): returning from a chat remounts the list
 * view, and the roster must render INSTANTLY from the previous visit's rows
 * while the background refresh re-validates. Keyed by workspace id; bounded
 * by time, not size. Lives here (not in the view) so the chat view's
 * blank-session revocation can drop rows without a view-module import cycle.
 * Exported for test isolation.
 */
export const sessionListCache = new Map<string, { rows: SessionView[]; cursor?: string; hasMore: boolean; at: number }>()

/**
 * Drop one session row from every cached roster (memory + persisted): the
 * blank-session revocation path calls this BEFORE navigating back, so the
 * returning list never flashes the revoked row while the host archive
 * settles.
 */
export function dropSessionFromCaches(sessionId: string): void {
  for (const [key, entry] of sessionListCache) {
    const rows = entry.rows.filter(row => row.sessionId !== sessionId)
    if (rows.length !== entry.rows.length) {
      sessionListCache.set(key, { ...entry, rows })
      // Through the queue, never straight to storage: a deferred page for this
      // workspace could otherwise land after this drop and resurrect the row.
      queuePersistedList(key, { rows, cursor: entry.cursor, hasMore: entry.hasMore })
    }
  }
  // A revoked blank session's draft is meaningless — drop it too.
  removeDraft(sessionId)
}

/** One workspace's persisted list page (rows + paging position). */
export interface PersistedList {
  /** Schema version (bump to drop incompatible stores). */
  v: 1
  rows: SessionView[]
  cursor?: string
  hasMore: boolean
  savedAt: number
}

const LIST_PREFIX = 'dsh-palm.list.v1.'
const DRAFT_PREFIX = 'dsh-palm.draft.v1.'
/** Retired reading-bookmark prefixes. The 「回到上次」 chip is gone (it kept
 *  offering a jump the reader never asked for), so nothing reads these any
 *  more: the maintenance pass and the pairing clear sweep them so they do not
 *  linger on a phone that ran an older build. */
const LEGACY_READING_PREFIXES = ['dsh-palm.reading.v1.', 'dsh-palm.reading.v2.', 'dsh-palm.reading.v3.']
/**
 * Self-maintained key registry: storage environments differ wildly (browser
 * Storage exposes length/key(), while vitest's jsdom localStorage is a plain
 * stub whose Object.keys returns the METHODS — no enumerable data keys at
 * all). Persisting keys here makes eviction/maintenance environment-proof.
 */
const INDEX_KEY = 'dsh-palm.cache-index.v1' //gitleaks:allow  值是 localStorage 名字，不是凭据

/** List rows are only a boot scaffold — the background refresh replaces them
 *  within seconds, so a generous TTL is safe (stale rows never persist long
 *  in view). */
const LIST_PERSIST_TTL_MS = 24 * 60 * 60 * 1000

function readJson<T>(raw: string | null): T | undefined {
  if (raw === null) return undefined
  try {
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
    registerKey(key)
  } catch {
    // quota / private mode: persistence silently off
  }
}

/** Record one persisted key in the registry (environment-proof eviction). */
function registerKey(key: string): void {
  try {
    const index = readJson<string[]>(localStorage.getItem(INDEX_KEY)) ?? []
    if (index.includes(key)) return
    index.push(key)
    localStorage.setItem(INDEX_KEY, JSON.stringify(index))
  } catch {
    // non-fatal
  }
}

/** All keys this module has persisted (registry-backed). */
function indexedKeys(): string[] {
  return readJson<string[]>(readRaw(INDEX_KEY)) ?? []
}

/** Remove keys and keep the registry in step. */
function removeKeys(keys: readonly string[]): void {
  if (keys.length === 0) return
  for (const key of keys) {
    try {
      localStorage.removeItem(key)
    } catch {
      // non-fatal
    }
  }
  try {
    const remaining = indexedKeys().filter(key => !keys.includes(key))
    localStorage.setItem(INDEX_KEY, JSON.stringify(remaining))
  } catch {
    // non-fatal
  }
}

function hasStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

/** Read one raw storage key, tolerating a storage access failure (private
 *  mode) like every write path does. */
function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/* ── deferred writes ──────────────────────────────────────────────────────── */

/**
 * Coalescing window for both whole-blob stores. Persisting the roster page or
 * the preview map is a JSON.stringify plus a synchronous localStorage write,
 * and doing that on the interaction that produced it puts both on the main
 * thread exactly while the list is being scrolled. The write is deferred to a
 * trailing window instead; a burst inside one window collapses into a single
 * write of the newest value per store key (the store is a boot scaffold — the
 * background refresh re-validates it within seconds — so a write that never
 * lands costs nothing).
 */
export const PERSIST_COALESCE_MS = 5_000

/** Queued writes: store key → the thunk that performs it (newest per key). */
const pendingWrites = new Map<string, () => void>()
let writeTimer: ReturnType<typeof setTimeout> | undefined
let flushHooksInstalled = false

/**
 * Flush as the page goes away. A frozen or killed PWA never runs the timer,
 * and the window's whole point is that the newest state still lands: `pagehide`
 * covers navigation and close, `visibilitychange` the iOS backgrounding freeze.
 * Both are cheap and idempotent.
 */
function installFlushHooks(): void {
  if (flushHooksInstalled || typeof document === 'undefined') return
  flushHooksInstalled = true
  document.addEventListener('pagehide', () => { flushPersistedWrites() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPersistedWrites()
  })
}

/** Queue one deferred store write (newest per key; at most one flush per window). */
function scheduleWrite(key: string, writeNow: () => void): void {
  pendingWrites.set(key, writeNow)
  installFlushHooks()
  // Never re-arm: a steady stream of updates must not postpone the write past
  // one window (that is how a "coalescing" writer starves and loses everything).
  if (writeTimer !== undefined) return
  writeTimer = setTimeout(() => { flushPersistedWrites() }, PERSIST_COALESCE_MS)
}

/** Write every queued store now (the page-hide paths call this). */
export function flushPersistedWrites(): void {
  if (writeTimer !== undefined) {
    clearTimeout(writeTimer)
    writeTimer = undefined
  }
  if (pendingWrites.size === 0) return
  const queued = [...pendingWrites.values()]
  pendingWrites.clear()
  for (const writeNow of queued) writeNow()
}

/** Drop every queued write without running it: a pairing eviction must not be
 *  undone seconds later by a flush that was armed before it (the queued page
 *  could be another device's roster). Also the test isolation seam. */
export function cancelPersistedWrites(): void {
  if (writeTimer !== undefined) {
    clearTimeout(writeTimer)
    writeTimer = undefined
  }
  pendingWrites.clear()
}

/** Defer one workspace's list page (the newest page for a workspace wins). */
export function queuePersistedList(
  workspaceId: string,
  value: Parameters<typeof savePersistedList>[1],
): void {
  scheduleWrite(`${LIST_PREFIX}${workspaceId}`, () => { savePersistedList(workspaceId, value) })
}

/** Load one workspace's persisted list (undefined when absent/expired/corrupt). */
export function loadPersistedList(workspaceId: string): PersistedList | undefined {
  if (!hasStorage()) return undefined
  const entry = readJson<PersistedList>(readRaw(LIST_PREFIX + workspaceId))
  if (entry === undefined || entry.v !== 1 || !Array.isArray(entry.rows)) return undefined
  if (entry.rows.some(row => row === null || typeof row !== 'object' || typeof row.sessionId !== 'string')) return undefined
  if (Date.now() - entry.savedAt > LIST_PERSIST_TTL_MS) return undefined
  return entry
}

/** Persist one workspace's list page (rows + paging position). */
export function savePersistedList(workspaceId: string, list: Omit<PersistedList, 'v' | 'savedAt'>): void {
  write(LIST_PREFIX + workspaceId, JSON.stringify({ v: 1, ...list, savedAt: Date.now() }))
}

/* ── composer drafts (per session) ─────────────────────────────────────── */

/** One session's draft record: saved-at + text (TTL + LRU bounded). */
interface DraftRecord {
  t: number
  v: string
}

/** Drafts expire after a week of disuse (sensitive text must not linger). */
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Per-draft length cap (a draft is a scratchpad, not a document). */
const DRAFT_MAX_CHARS = 4096
/** Draft entry cap (LRU: oldest saved-at evicted past this). */
const DRAFT_MAX_ENTRIES = 50

/** Load one session's draft ('' when absent/expired/corrupt). */
export function loadDraft(sessionId: string): string {
  if (!hasStorage()) return ''
  const record = readJson<DraftRecord>(readRaw(DRAFT_PREFIX + sessionId))
  if (record === undefined || typeof record.v !== 'string') return ''
  if (Date.now() - record.t > DRAFT_TTL_MS) return ''
  return record.v
}

/** Persist one session's draft ('' removes it). LRU-trimmed past the cap. */
export function saveDraft(sessionId: string, text: string): void {
  if (text === '') {
    removeDraft(sessionId)
    return
  }
  write(DRAFT_PREFIX + sessionId, JSON.stringify({ t: Date.now(), v: text.slice(0, DRAFT_MAX_CHARS) }))
  trimDrafts()
}

/** Drop one session's draft (send success / blank-session revocation). */
export function removeDraft(sessionId: string): void {
  removeKeys([DRAFT_PREFIX + sessionId])
}

/** Evict the oldest drafts past the entry cap (by saved-at). */
function trimDrafts(): void {
  const keys = indexedKeys().filter(key => key.startsWith(DRAFT_PREFIX))
  if (keys.length <= DRAFT_MAX_ENTRIES) return
  const byAge = keys
    .map(key => ({ key, t: readJson<DraftRecord>(readRaw(key))?.t ?? 0 }))
    .sort((a, b) => a.t - b.t)
  removeKeys(byAge.slice(0, keys.length - DRAFT_MAX_ENTRIES).map(entry => entry.key))
}

/* ── reading position (retired) ─────────────────────────────────────────────
   The 「回到上次」 chip was removed: it appeared on opens where the reader had
   never scrolled away from the bottom, because the open-time pin's echoes read
   as a gesture. Only its key sweep survives — see LEGACY_READING_PREFIXES. */

/** Drop every persisted cache (pairing eviction / re-pair on this device). */
export function clearPairingCaches(): void {
  if (!hasStorage()) return
  // Anything queued was armed before the eviction, so it must not run after it.
  cancelPersistedWrites()
  const doomed = indexedKeys().filter(key =>
    key.startsWith(LIST_PREFIX) || key.startsWith(DRAFT_PREFIX) || LEGACY_READING_PREFIXES.some(prefix => key.startsWith(prefix)))
  removeKeys(doomed)
}

/** Opportunistic maintenance: drop expired list entries and drafts, and sweep
 *  the retired reading bookmarks. */
export function maintainPersistedCaches(): void {
  if (!hasStorage()) return
  const now = Date.now()
  const doomed = indexedKeys().filter(key => {
    // Retired reading records are never read again — drop them outright.
    if (LEGACY_READING_PREFIXES.some(prefix => key.startsWith(prefix))) return true
    if (key.startsWith(LIST_PREFIX)) {
      const entry = readJson<PersistedList>(readRaw(key))
      return entry === undefined || now - entry.savedAt > LIST_PERSIST_TTL_MS
    }
    if (key.startsWith(DRAFT_PREFIX)) {
      const record = readJson<DraftRecord>(readRaw(key))
      return record === undefined || now - record.t > DRAFT_TTL_MS
    }
    return false
  })
  removeKeys(doomed)
}
