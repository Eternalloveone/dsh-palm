// @vitest-environment jsdom
/**
 * history-cache: round-trip, TTL expiry, LRU trim, and graceful degradation
 * when IndexedDB is unavailable. Uses a minimal in-memory IndexedDB fake
 * covering exactly the operations the module performs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearHistoryCache, loadCachedHistory, saveCachedHistory } from './history-cache.ts'

interface FakeRequest {
  result?: unknown
  error?: Error
  onsuccess?: () => void
  onerror?: () => void
}

class FakeObjectStore {
  data = new Map<string, unknown>()
  constructor(public keyPath: string) {}
  get(key: string): FakeRequest {
    const req: FakeRequest = {}
    queueMicrotask(() => { req.result = this.data.get(key); req.onsuccess?.() })
    return req
  }
  put(value: Record<string, unknown>): FakeRequest {
    const req: FakeRequest = {}
    queueMicrotask(() => { this.data.set(String(value[this.keyPath]), value); req.onsuccess?.() })
    return req
  }
  getAll(): FakeRequest {
    const req: FakeRequest = {}
    queueMicrotask(() => { req.result = [...this.data.values()]; req.onsuccess?.() })
    return req
  }
  delete(key: string): FakeRequest {
    const req: FakeRequest = {}
    queueMicrotask(() => { this.data.delete(key); req.onsuccess?.() })
    return req
  }
  clear(): FakeRequest {
    const req: FakeRequest = {}
    queueMicrotask(() => { this.data.clear(); req.onsuccess?.() })
    return req
  }
}

class FakeTransaction {
  oncomplete?: () => void
  onerror?: () => void
  onabort?: () => void
  constructor(private db: FakeDB, private storeName: string, public mode: string) {
    // All store ops are synchronous in the fake; complete on a microtask.
    queueMicrotask(() => this.oncomplete?.())
  }
  objectStore(_name: string): FakeObjectStore {
    return this.db.stores.get(this.storeName)!
  }
}

class FakeDB {
  stores = new Map<string, FakeObjectStore>()
  objectStoreNames = { contains: (name: string): boolean => this.stores.has(name) }
  createObjectStore(name: string, opts: { keyPath: string }): FakeObjectStore {
    const store = new FakeObjectStore(opts.keyPath)
    this.stores.set(name, store)
    return store
  }
  transaction(storeName: string, mode: string): FakeTransaction {
    return new FakeTransaction(this, storeName, mode)
  }
  close(): void {}
}

class FakeOpenRequest {
  result?: FakeDB
  error?: Error
  onupgradeneeded?: () => void
  onsuccess?: () => void
  onerror?: () => void
}

function installFakeIndexedDB(): FakeDB {
  const db = new FakeDB()
  const open = (_name: string, _version: number): FakeOpenRequest => {
    const req = new FakeOpenRequest()
    queueMicrotask(() => {
      req.result = db
      req.onupgradeneeded?.()
      req.onsuccess?.()
    })
    return req
  }
  ;(globalThis as unknown as { indexedDB: unknown }).indexedDB = { open }
  return db
}

function uninstallFakeIndexedDB(): void {
  delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_700_000_000_000)
})

afterEach(() => {
  vi.useRealTimers()
  uninstallFakeIndexedDB()
})

describe('history-cache', () => {
  it('round-trips a tail page per session', async () => {
    installFakeIndexedDB()
    const page = { rows: [{ id: 'm-1' }], maxSeq: 5, hasMore: false }
    await saveCachedHistory('s-1', page)
    expect(await loadCachedHistory<typeof page>('s-1')).toEqual(page)
    expect(await loadCachedHistory<typeof page>('s-2')).toBeUndefined()
  })

  it('expires entries past the TTL', async () => {
    installFakeIndexedDB()
    await saveCachedHistory('s-1', { rows: [], maxSeq: 0, hasMore: false })
    vi.setSystemTime(1_700_000_000_000 + 25 * 60 * 60 * 1000)
    expect(await loadCachedHistory('s-1')).toBeUndefined()
  })

  it('trims the oldest entries past the cap', async () => {
    installFakeIndexedDB()
    for (let index = 0; index < 55; index++) {
      await saveCachedHistory(`s-${index}`, { rows: [], maxSeq: index, hasMore: false })
    }
    // The 5 oldest (s-0..s-4) are evicted; the newest survive.
    expect(await loadCachedHistory('s-0')).toBeUndefined()
    expect(await loadCachedHistory('s-54')).toEqual({ rows: [], maxSeq: 54, hasMore: false })
  })

  it('clearHistoryCache drops every entry', async () => {
    installFakeIndexedDB()
    await saveCachedHistory('s-1', { rows: [], maxSeq: 0, hasMore: false })
    await clearHistoryCache()
    expect(await loadCachedHistory('s-1')).toBeUndefined()
  })

  it('degrades gracefully when IndexedDB is unavailable', async () => {
    // No fake installed: indexedDB is undefined.
    expect(await loadCachedHistory('s-1')).toBeUndefined()
    await expect(saveCachedHistory('s-1', { rows: [], maxSeq: 0, hasMore: false })).resolves.toBeUndefined()
    await expect(clearHistoryCache()).resolves.toBeUndefined()
  })
})
