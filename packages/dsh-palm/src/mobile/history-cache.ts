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
  try {
    const db = await openDb()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        store.put({ key: sessionId, v: 1, savedAt: Date.now(), page } satisfies HistoryCacheEntry<T>)
        tx.oncomplete = () => { resolve() }
        tx.onerror = () => { reject(tx.error ?? new Error('indexedDB write failed')) }
        tx.onabort = () => { reject(tx.error ?? new Error('indexedDB write aborted')) }
      })
      await trimHistory(db)
    } finally {
      db.close()
    }
  } catch {
    // quota / private mode: cache silently off
  }
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
