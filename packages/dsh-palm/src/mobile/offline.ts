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
  /**
   * True while a flush is delivering this entry. A crash mid-delivery (after
   * the send succeeded but before the removal) leaves it set, so the entry is
   * NOT auto-resent on restart — it is "pending confirmation" and the user
   * can retry or remove it. Old persisted entries without this field are
   * treated as to-send.
   */
  sending?: boolean
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

/**
 * Drop every queued prompt for one session. Called when the session is
 * deleted (from the chat's 更多 menu or the session list) so its outbox
 * entries stop retrying forever against a session that no longer exists.
 */
export async function removeOutboxForSession(sessionId: string): Promise<void> {
  const entries = await listOutbox()
  for (const entry of entries) {
    if (entry.sessionId === sessionId) await removeFromOutbox(entry.id)
  }
}

/**
 * Thrown by a flush {@link send} callback to mark an entry as permanently
 * undeliverable (e.g. the session was deleted and no longer accepts prompts).
 * flushOutbox drops such an entry instead of keeping it queued for the next
 * retry, so a dead outbox item never retries forever.
 */
export class PermanentOutboxError extends Error {
  constructor(message = 'permanent outbox failure') {
    super(message)
    this.name = 'PermanentOutboxError'
  }
}

/** Update one queued entry in BOTH sources (store + memory-held). The memory
 * entry is mutated first so a store outage (IDB down) still records the
 * change for the memory fallback; a store-only entry that cannot be reached
 * degrades to memory-only for the rest of the flush. */
async function updateEntry(id: string, mutate: (entry: OutboxEntry) => void): Promise<void> {
  const memory = memoryQueue.find(entry => entry.id === id)
  if (memory !== undefined) mutate(memory)
  try {
    const db = await openDb()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        const get = store.get(id)
        get.onsuccess = () => {
          const entry = get.result as OutboxEntry | undefined
          if (entry !== undefined) {
            mutate(entry)
            store.put(entry)
          }
        }
        tx.oncomplete = () => { resolve() }
        tx.onerror = () => { reject(tx.error ?? new Error('indexedDB transaction failed')) }
        tx.onabort = () => { reject(tx.error ?? new Error('indexedDB transaction aborted')) }
      })
    } finally {
      db.close()
    }
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
 * in-flight run (no double delivery).
 *
 * At-least-once without duplicate delivery: each entry is marked `sending`
 * and persisted BEFORE the send, and only removed after the send succeeds. A
 * crash between the send and the removal leaves the entry `sending`, so it is
 * NOT auto-resent on restart (the prompt may already have reached the host,
 * which has no idempotency key) — it stays queued as "pending confirmation"
 * for the user to retry or remove. */
export async function flushOutbox(send: (entry: OutboxEntry) => Promise<void>): Promise<FlushResult> {
  if (flushing) return { sent: 0, failed: 0 }
  flushing = true
  try {
    const entries = await listOutbox()
    let sent = 0
    let failed = 0
    for (const entry of entries) {
      // A sending entry is "pending confirmation": a previous flush marked it
      // sending and the process crashed before it was removed. It is NOT
      // auto-resent (the prompt may already have been delivered), so it stays
      // queued for the user to retry or remove manually.
      if (entry.sending === true) continue
      try {
        // Mark sending and persist BEFORE the send: if the process crashes
        // after the send succeeds but before the removal, the entry is left
        // sending and is not re-delivered on restart.
        await updateEntry(entry.id, e => { e.sending = true })
        await send(entry)
        await removeFromOutbox(entry.id)
        sent += 1
      } catch (error) {
        if (error instanceof PermanentOutboxError) {
          // The entry can never be delivered (session gone): drop it outright
          // so it stops retrying forever, then move on.
          await removeFromOutbox(entry.id)
        } else {
          // The send failed (network, etc.): clear the sending flag so the
          // entry is retried on the next flush, and move on.
          await updateEntry(entry.id, e => { e.sending = false })
        }
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
