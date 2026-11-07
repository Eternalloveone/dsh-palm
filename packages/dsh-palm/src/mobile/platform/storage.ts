/**
 * Persistent-storage request for the phone's local caches.
 *
 * The history cache and the offline outbox live in IndexedDB, which is evictable
 * by default: under storage pressure the browser may drop the whole origin's data
 * — silently, which is exactly what a cache must never do to prompts the user has
 * already queued. `navigator.storage.persist()` asks for the exempt bucket
 * instead.
 *
 * Asked for lazily, after the first successful cache write (i.e. once the user has
 * actually opened a session and there is something worth protecting), never on
 * first paint. Chrome decides on engagement heuristics and usually grants quietly;
 * Firefox may prompt. A refusal is not an error — the caches keep working, merely
 * evictable — and {@link storageInfo} is what makes that visible in a capture.
 *
 * @module dsh-palm/mobile/storage
 */

export interface StorageInfo {
  /** `navigator.storage.persisted()` — the bucket is exempt from eviction. */
  persisted: boolean
  /** Bytes used by this origin, when the browser reports an estimate. */
  usage?: number
  /** Bytes available to this origin, when the browser reports an estimate. */
  quota?: number
  /** When the numbers were last refreshed (epoch ms). */
  at?: number
  /** Why the numbers are missing: `unsupported` (no StorageManager) or `denied`. */
  note?: 'unsupported' | 'denied'
}

/** The StorageManager, or undefined where the API (or the whole object) is absent. */
function storageManager(): StorageManager | undefined {
  if (typeof navigator === 'undefined') return undefined
  return (navigator as Navigator & { storage?: StorageManager }).storage
}

let info: StorageInfo = { persisted: false }
let requested = false

/** The last known storage picture (synchronous; refreshed by the call below). */
export function storageInfo(): StorageInfo {
  return { ...info }
}

async function refreshEstimate(storage: StorageManager): Promise<void> {
  try {
    if (typeof storage.persisted === 'function') info.persisted = await storage.persisted()
    if (typeof storage.estimate === 'function') {
      const estimate = await storage.estimate()
      if (typeof estimate.usage === 'number') info.usage = estimate.usage
      if (typeof estimate.quota === 'number') info.quota = estimate.quota
    }
    info.at = Date.now()
    delete info.note
  } catch {
    info.note = 'denied'
    info.at = Date.now()
  }
}

/**
 * Ask for a persistent bucket once, then keep the estimate fresh.
 *
 * Idempotent and it never throws: unsupported, denied and private-mode all leave
 * the caches working, merely evictable.
 */
export async function ensurePersistentStorage(): Promise<void> {
  const storage = storageManager()
  if (storage === undefined) {
    info = { ...info, note: 'unsupported' }
    return
  }
  if (requested) return
  requested = true
  try {
    if (typeof storage.persist === 'function') info.persisted = await storage.persist()
  } catch {
    // A refused request is not an error; the estimate below still reports.
  }
  await refreshEstimate(storage)
}

/** Test seam: forget that persist() was already asked for. */
export function resetStorageRequest(): void {
  requested = false
  info = { persisted: false }
}
