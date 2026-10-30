/**
 * IndexedDB history cache: the last-known folded tail page per session, so
 * reopening a session paints instantly (stale-while-revalidate) and an
 * offline reopen still shows the last-known history instead of a blank
 * skeleton. Reuses the `dsh-palm` database that {@link offline.ts} owns (its
 * `outbox` store lives there); this module owns the `history` store and bumps
 * the database to version 2.
 *
 * Storage is best-effort everywhere: quota/private-mode failures disable the
 * cache silently (the network path still serves the chat).
 * @module dsh-palm/mobile/history-cache
 */

import { ensurePersistentStorage } from './storage.ts'

const DB_NAME = 'dsh-palm'
const DB_VERSION = 2
const STORE = 'history'

/** A cached tail page is a boot scaffold; the network refresh replaces it
 *  within seconds, so a generous TTL is safe (stale rows never persist long
 *  in view). */
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000
/** Entry cap: evict the oldest (by savedAt) past this so a long-lived page
 *  never grows the store without limit. */
const HISTORY_MAX_ENTRIES = 50

/** One cached tail page (the caller's page type rides the generic). */
interface HistoryCacheEntry<T> {
  key: string
  v: 1
  savedAt: number
  page: T
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      // `outbox` is owned by offline.ts (created at v1); create it here too
      // so a fresh database opened first by this module still has it, and
      // the v1→v2 upgrade never drops it.
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
    }
    request.onsuccess = () => { resolve(request.result) }
    request.onerror = () => { reject(request.error ?? new Error('indexedDB open failed')) }
  })
}

/** Load one session's cached tail page (undefined when absent/expired/corrupt). */
export async function loadCachedHistory<T>(sessionId: string): Promise<T | undefined> {
  try {
    const db = await openDb()
    try {
      const entry = await new Promise<HistoryCacheEntry<T> | undefined>((resolve, reject) => {
        const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(sessionId)
        request.onsuccess = () => { resolve(request.result as HistoryCacheEntry<T> | undefined) }
        request.onerror = () => { reject(request.error ?? new Error('indexedDB read failed')) }
      })
      if (entry === undefined || entry.v !== 1) return undefined
      if (Date.now() - entry.savedAt > HISTORY_TTL_MS) return undefined
      return entry.page
    } finally {
      db.close()
    }
  } catch {
    return undefined
  }
}

/** Persist one session's tail page (best-effort; LRU-trimmed past the cap). */
export async function saveCachedHistory<T>(sessionId: string, page: T): Promise<void> {
  let saved = false
  try {
    const db = await openDb()
    try {
      // 缓存**只许变多**（不变式 I3：单调）。
      //
      // 写这份缓存的地方有三处（尾页 120 行 / 宿主权威页 / 通用兜底），后到的那次
      // 可能是更小的一页。曾经的现场：尾页按 120 行写入后，被一份 25 事件的小页覆盖，
      // 于是「再进会话」的 cache-first 只画得出 13 行（实测 200ms 13 行 / 稳定 114 行）。
      // 这里按行合并：同一 seq 以新到的为准，其余保留，然后按 seq 排序截断。
      // 读旧值（同一连接）再决定写什么：缓存只增不减，见 mergeCachedPage。
      const previous = await readEntry<T>(db, sessionId)
      const merged = ((): T => {
        try {
          return mergeCachedPage(previous?.page, page)
        } catch {
          return page
        }
      })()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        store.put({ key: sessionId, v: 1, savedAt: Date.now(), page: merged } satisfies HistoryCacheEntry<T>)
        tx.oncomplete = () => { resolve() }
        tx.onerror = () => { reject(tx.error ?? new Error('indexedDB write failed')) }
        tx.onabort = () => { reject(tx.error ?? new Error('indexedDB write aborted')) }
      })
      await trimHistory(db)
      saved = true
    } finally {
      db.close()
    }
  } catch {
    // quota / private mode: cache silently off
  }
  // Lazy on purpose: the first successful write is the moment there is something
  // worth protecting, so the persistent-storage request (which some browsers may
  // prompt for) happens here rather than on first paint. Deliberately not awaited
  // — a prompt must never hold up the chat.
  if (saved) void ensurePersistentStorage()
}

/** 读一条缓存（同一连接；不存在或读失败就是 undefined）。 */
async function readEntry<T>(db: IDBDatabase, sessionId: string): Promise<HistoryCacheEntry<T> | undefined> {
  try {
    return await new Promise<HistoryCacheEntry<T> | undefined>((resolve) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(sessionId)
      request.onsuccess = () => { resolve(request.result as HistoryCacheEntry<T> | undefined) }
      request.onerror = () => { resolve(undefined) }
    })
  } catch {
    return undefined
  }
}

/** 缓存里留多少行：够铺满首屏并留出上翻余量。 */
const CACHE_MAX_ROWS = 240

/**
 * 把「旧缓存」和「这次要写的页」合成一份**只增不减**的页。
 *
 * - 形状不认识（没有 rows 数组 / 行没有数字 seq）→ 直接用新页；
 * - 同一 seq 两行都在 → 新页那行胜出（它更新）；
 * - 合并后按 seq 升序、保留尾部 `CACHE_MAX_ROWS` 行；
 * - `maxSeq` 取大者，`hasMore` 跟新页（它代表"更早还有没有"，只有网络页知道）。
 */
export function mergeCachedPage<T>(existing: T | undefined, incoming: T): T {
  const previous = existing as unknown as { rows?: unknown; maxSeq?: unknown; hasMore?: unknown } | undefined
  const next = incoming as unknown as { rows?: unknown; maxSeq?: unknown; hasMore?: unknown }
  // 没有旧值（或形状不认识）：仍然把这一页按上限截断，别让单条缓存无限长。
  const capped = (): T => {
    if (!Array.isArray(next.rows) || next.rows.length <= CACHE_MAX_ROWS) return incoming
    return { ...(next as object), rows: (next.rows as unknown[]).slice(-CACHE_MAX_ROWS) } as unknown as T
  }
  if (
    previous === undefined
    || !Array.isArray(previous.rows)
    || !Array.isArray(next.rows)
    || typeof previous.maxSeq !== 'number'
    || typeof next.maxSeq !== 'number'
  ) return capped()

  type SeqRow = { seq?: unknown }
  const bySeq = new Map<number, unknown>()
  const seqOf = (row: unknown): number | undefined => {
    if (typeof row !== 'object' || row === null) return undefined
    const seq = (row as SeqRow).seq
    return typeof seq === 'number' && Number.isFinite(seq) ? seq : undefined
  }
  for (const row of previous.rows as unknown[]) {
    const seq = seqOf(row)
    if (seq === undefined) return incoming
    bySeq.set(seq, row)
  }
  for (const row of next.rows as unknown[]) {
    const seq = seqOf(row)
    if (seq === undefined) return incoming
    bySeq.set(seq, row)
  }
  const rows = [...bySeq.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row)
    .slice(-CACHE_MAX_ROWS)
  const maxSeq = typeof previous.maxSeq === 'number' ? Math.max(previous.maxSeq, next.maxSeq) : next.maxSeq
  return {
    ...(next as object),
    rows,
    maxSeq,
  } as unknown as T
}

/** Evict the oldest entries past the cap (by savedAt). */
async function trimHistory(db: IDBDatabase): Promise<void> {
  try {
    const entries = await new Promise<Array<{ key: string; savedAt: number }>>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
      request.onsuccess = () => {
        const all = (request.result as Array<{ key: string; savedAt: number }> | undefined) ?? []
        resolve(all.map(entry => ({ key: entry.key, savedAt: entry.savedAt })))
      }
      request.onerror = () => { reject(request.error ?? new Error('indexedDB read failed')) }
    })
    if (entries.length <= HISTORY_MAX_ENTRIES) return
    const doomed = entries
      .sort((a, b) => a.savedAt - b.savedAt)
      .slice(0, entries.length - HISTORY_MAX_ENTRIES)
      .map(entry => entry.key)
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      for (const key of doomed) store.delete(key)
      tx.oncomplete = () => { resolve() }
      tx.onerror = () => { reject(tx.error ?? new Error('indexedDB trim failed')) }
      tx.onabort = () => { reject(tx.error ?? new Error('indexedDB trim aborted')) }
    })
  } catch {
    // non-fatal
  }
}

/** Drop every cached tail page (pairing eviction / re-pair on this device). */
export async function clearHistoryCache(): Promise<void> {
  try {
    const db = await openDb()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).clear()
        tx.oncomplete = () => { resolve() }
        tx.onerror = () => { reject(tx.error ?? new Error('indexedDB clear failed')) }
        tx.onabort = () => { reject(tx.error ?? new Error('indexedDB clear aborted')) }
      })
    } finally {
      db.close()
    }
  } catch {
    // non-fatal
  }
}
