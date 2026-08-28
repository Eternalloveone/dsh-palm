/**
 * Offline outbox: prompts drafted while the network is down queue in a tiny
 * IndexedDB key-value store (memory fallback when IDB is unavailable, e.g.
 * private-mode browsers) and flush automatically when the connection
 * returns. Pure storage + flush logic; the UI wires the online/offline
 * events.
 *
 * Failure handling is resumable, never permanent: every listOutbox re-tries
 * IndexedDB, so a private-mode blip degrades to memory only while it lasts
 * and merges the memory-held entries back into the store on the first
 * successful read — nothing queued before OR during the outage is lost or
 * double-delivered.
 */

/** One queued prompt. */
export interface OutboxEntry {
  id: string
  sessionId: string
  text: string
  queuedAt: number
}

const DB_NAME = 'dsh-palm'
const STORE = 'outbox'

/**
 * Entries that could not be persisted yet (IDB down; also the seam tests
 * inject into). listOutbox merges them with the store on every successful
 * read and persists them, so a temporary outage never drops a queued item.
 */
const memoryQueue: OutboxEntry[] = []
/** True while the last IndexedDB attempt failed (enqueue path short-circuits). */
let memoryOnly = false
/** True while a flush run is in flight (concurrent flush protection). */
let flushing = false

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'))
      return
    }
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => { resolve(request.result) }
    request.onerror = () => { reject(request.error ?? new Error('indexedDB open failed')) }
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => { resolve(request.result) }
      request.onerror = () => { reject(request.error ?? new Error('indexedDB request failed')) }
    })
  } finally {
    db.close()
  }
}

/** Write the memory-held entries into the store; clears them on success. */
async function persistMemoryQueue(): Promise<void> {
  if (memoryQueue.length === 0) return
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      for (const entry of memoryQueue) store.put(entry)
      tx.oncomplete = () => { resolve() }
      tx.onerror = () => { reject(tx.error ?? new Error('indexedDB transaction failed')) }
      tx.onabort = () => { reject(tx.error ?? new Error('indexedDB transaction aborted')) }
    })
    memoryQueue.length = 0
    memoryOnly = false
  } finally {
    db.close()
  }
}

/** Queue one prompt for later delivery. */
export async function enqueuePrompt(entry: OutboxEntry): Promise<void> {
  if (!memoryOnly) {
    try {
      await withStore('readwrite', store => store.put(entry))
      return
    } catch {
      memoryOnly = true
    }
  }
  memoryQueue.push(entry)
}

/** Snapshot the queued prompts (oldest first), merging store + memory-held
 * entries so nothing queued during an outage is skipped. */
export async function listOutbox(): Promise<OutboxEntry[]> {
  // Always re-try IndexedDB: a transient failure must not permanently hide
  // entries that were persisted before the outage (the old code ignored the
  // whole store once it degraded).
  try {
    const entries = await withStore<OutboxEntry[]>('readonly', store => store.getAll() as IDBRequest<OutboxEntry[]>)
    if (memoryQueue.length > 0) {
      try {
        await persistMemoryQueue()
      } catch {
        // Keep the memory-held entries for the next attempt; merge below.
      }
    }
    const byId = new Map<string, OutboxEntry>()
    for (const entry of entries) byId.set(entry.id, entry)
    for (const entry of memoryQueue) {
      if (!byId.has(entry.id)) byId.set(entry.id, entry)
    }
    memoryOnly = false
    return [...byId.values()].sort((a, b) => a.queuedAt - b.queuedAt)
  } catch {
    memoryOnly = true
    return [...memoryQueue].sort((a, b) => a.queuedAt - b.queuedAt)
  }
}

/** Drop one queued prompt (after successful delivery) from BOTH sources, so
 * an entry persisted before an outage is never re-delivered after recovery. */
export async function removeFromOutbox(id: string): Promise<void> {
  const index = memoryQueue.findIndex(entry => entry.id === id)
  if (index !== -1) memoryQueue.splice(index, 1)
  try {
    await withStore('readwrite', store => store.delete(id))
  } catch {
    memoryOnly = true
  }
}

/** Flush result: how many went out, how many still queue. */
export interface FlushResult {
  sent: number
  failed: number
}

/** Deliver every queued prompt in order; a failing entry is skipped (it
 * stays queued for the next flush) so one permanently failing prompt never
 * blocks the rest of the outbox. Concurrent calls coalesce into the
 * in-flight run (no double delivery). */
export async function flushOutbox(send: (entry: OutboxEntry) => Promise<void>): Promise<FlushResult> {
  if (flushing) return { sent: 0, failed: 0 }
  flushing = true
  try {
    const entries = await listOutbox()
    let sent = 0
    let failed = 0
    for (const entry of entries) {
      try {
        await send(entry)
        await removeFromOutbox(entry.id)
        sent += 1
      } catch {
        // Keep the entry queued (it retries on the next flush) and move on.
        failed += 1
      }
    }
    return { sent, failed }
  } finally {
    flushing = false
  }
}

/** Test seam: reset the memory fallback between tests. */
export function resetOutboxForTest(): void {
  memoryQueue.length = 0
  memoryOnly = false
  flushing = false
}
