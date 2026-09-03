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

import type { SessionView } from './views/App.tsx'

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
      savePersistedList(key, { rows, cursor: entry.cursor, hasMore: entry.hasMore })
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
const PREVIEW_STORE = 'dsh-palm.prev.v1'
const SCROLL_PREFIX = 'dsh-palm.scroll.v1.'
const DRAFT_PREFIX = 'dsh-palm.draft.v1.'
/**
 * Self-maintained key registry: storage environments differ wildly (browser
 * Storage exposes length/key(), while vitest's jsdom localStorage is a plain
 * stub whose Object.keys returns the METHODS — no enumerable data keys at
 * all). Persisting keys here makes eviction/maintenance environment-proof.
 */
const INDEX_KEY = 'dsh-palm.cache-index.v1'

/** List rows are only a boot scaffold — the background refresh replaces them
 *  within seconds, so a generous TTL is safe (stale rows never persist long
 *  in view). */
const LIST_PERSIST_TTL_MS = 24 * 60 * 60 * 1000
/** Preview summary capacity: entry cap + estimated-byte cap (a conservative
 *  share of localStorage's ~5MB; summaries are ~30 chars each). */
const PREVIEW_PERSIST_MAX_ENTRIES = 500
const PREVIEW_PERSIST_MAX_BYTES = 512 * 1024

/** Local preview store shape: { sessionId: summary } (insertion-ordered map
 *  semantics come from the runtime Map; the JSON record loses it, so eviction
 *  re-writes the whole record with the current Map's order). */
function previewStoreName(): string {
  return PREVIEW_STORE
}

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

/** Load one workspace's saved scroll offset (0 when absent). */
export function loadPersistedScroll(workspaceId: string): number {
  if (!hasStorage()) return 0
  const raw = Number(readRaw(SCROLL_PREFIX + workspaceId) ?? '')
  return Number.isFinite(raw) && raw > 0 ? raw : 0
}

/** Persist one workspace's scroll offset (PWA cold start restores it). */
export function savePersistedScroll(workspaceId: string, y: number): void {
  write(SCROLL_PREFIX + workspaceId, String(Math.max(0, y)))
}

/** Load persisted preview summaries into the caller's map (empty for none). */
export function loadPersistedPreviews(): Map<string, string> {
  const out = new Map<string, string>()
  if (!hasStorage()) return out
  const record = readJson<Record<string, string>>(readRaw(previewStoreName()))
  if (record === undefined) return out
  for (const [sessionId, summary] of Object.entries(record)) {
    if (typeof sessionId !== 'string' || typeof summary !== 'string' || summary === '') continue
    out.set(sessionId, summary)
  }
  return out
}

/** Persist the preview map (capacity-trimmed to the newest-inserted entries;
 *  the runtime Map is insertion-ordered with LRU re-inserts). */
export function savePersistedPreviews(map: ReadonlyMap<string, string>): void {
  if (!hasStorage() || map.size === 0) return
  let record: Record<string, string> = {}
  for (const [sessionId, summary] of map) record[sessionId] = summary
  // Byte-cap: drop oldest-inserted entries until the estimate fits.
  let encoded = JSON.stringify(record)
  while (Object.keys(record).length > PREVIEW_PERSIST_MAX_ENTRIES || encoded.length > PREVIEW_PERSIST_MAX_BYTES) {
    const first = Object.keys(record)[0]
    if (first === undefined) break
    delete record[first]
    encoded = JSON.stringify(record)
  }
  write(previewStoreName(), encoded)
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

/** Drop every persisted cache (pairing eviction / re-pair on this device). */
export function clearPairingCaches(): void {
  if (!hasStorage()) return
  const doomed = indexedKeys().filter(key =>
    key.startsWith(LIST_PREFIX) || key.startsWith(SCROLL_PREFIX) || key.startsWith(DRAFT_PREFIX) || key === PREVIEW_STORE)
  removeKeys(doomed)
}

/** Opportunistic maintenance: drop expired list entries and drafts (previews
 *  are capacity-bounded at write time; scroll offsets expire with their
 *  list). */
export function maintainPersistedCaches(): void {
  if (!hasStorage()) return
  const now = Date.now()
  const doomed = indexedKeys().filter(key => {
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
