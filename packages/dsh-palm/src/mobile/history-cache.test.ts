// @vitest-environment jsdom
/**
 * history-cache: round-trip, TTL expiry, LRU trim, and graceful degradation
 * when IndexedDB is unavailable. Uses a minimal in-memory IndexedDB fake
 * covering exactly the operations the module performs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearHistoryCache, loadCachedHistory, mergeCachedPage, saveCachedHistory } from './history-cache.ts'

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

describe('缓存合并只许变多（I3 单调）', () => {
  // 直接测纯函数：IndexedDB 那层是 best-effort 的通道（回环用例已在上面），
  // 这里要锁的是**合并规则本身**——它是"缓存被小页覆盖"的唯一防线。
  const page = (seqs: number[]) => ({
    rows: seqs.map(seq => ({ seq, kind: 'assistant', id: `r-${seq}`, text: '' })),
    maxSeq: Math.max(...seqs),
    hasMore: seqs[0] === 1,
  })

  it('旧的 114 行 + 新的 13 行 → 合成 114 行（小的不许把大的顶掉）', () => {
    // 真机现场：尾页按 120 行写入，被后到的一份 25 事件小页覆盖，
    // 于是再进会话的 cache-first 只画得出 13 行。
    const big = page(Array.from({ length: 114 }, (_, i) => i + 1))
    const small = page(Array.from({ length: 13 }, (_, i) => i + 102))
    const merged = mergeCachedPage(big, small)
    expect(merged.rows).toHaveLength(114)
    expect(merged.maxSeq).toBe(114)
  })

  it('同一 seq 以新到的为准（流式正文会被更新成最终版）', () => {
    const first = { rows: [{ seq: 7, kind: 'assistant', id: 'r-7', text: '流式中' }], maxSeq: 7, hasMore: false }
    const second = { rows: [{ seq: 7, kind: 'assistant', id: 'r-7', text: '最终正文' }], maxSeq: 7, hasMore: false }
    const merged = mergeCachedPage(first, second)
    expect(merged.rows).toHaveLength(1)
    expect((merged.rows[0] as { text?: string }).text).toBe('最终正文')
  })

  it('形状不认识时直接用新页（不猜）', () => {
    const merged = mergeCachedPage(undefined, { hello: 'world' })
    expect(merged).toEqual({ hello: 'world' })
  })

  it('行数有上限：合并后保留尾部 400 行', () => {
    const big = page(Array.from({ length: 500 }, (_, i) => i + 1))
    const merged = mergeCachedPage(undefined, big)
    expect(merged.rows).toHaveLength(400)
    expect((merged.rows.at(-1) as { seq?: number }).seq).toBe(500)
  })
})
