/**
 * list-persist (v3.3 PWA cold-start store): list-page round-trips, TTL expiry,
 * corrupt data tolerance, composer drafts, pairing eviction, and the deferred
 * write path (a burst collapses into one trailing write of the newest value).
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelPersistedWrites,
  clearPairingCaches,
  flushPersistedWrites,
  loadDraft,
  loadPersistedList,
  maintainPersistedCaches,
  PERSIST_COALESCE_MS,
  queuePersistedList,
  removeDraft,
  saveDraft,
  savePersistedList,
} from './list-persist.ts'
import type { SessionView } from '../shared/session-view.ts'

const row = (sessionId: string): SessionView => ({
  sessionId,
  title: `会话 ${sessionId}`,
  updatedAt: 1_700_000_000_000,
  running: false,
  blank: false,
})

beforeEach(() => {
  // The deferred-write queue outlives a test (module scope): drop anything a
  // previous test left armed, or its flush would resurrect data here.
  cancelPersistedWrites()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('list-persist', () => {
  it('round-trips a list page per workspace', () => {
    savePersistedList('w-1', { rows: [row('s-1')], cursor: 'c1', hasMore: true })
    const loaded = loadPersistedList('w-1')
    expect(loaded?.rows).toEqual([row('s-1')])
    expect(loaded?.cursor).toBe('c1')
    expect(loaded?.hasMore).toBe(true)
    // Other workspaces stay independent.
    expect(loadPersistedList('w-2')).toBeUndefined()
  })

  it('rejects expired lists (TTL) and corrupt payloads', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_700_000_000_000)
      savePersistedList('w-1', { rows: [row('s-1')], hasMore: false })
      // 25 hours later the same list is gone.
      vi.setSystemTime(1_700_000_000_000 + 25 * 60 * 60 * 1000)
      expect(loadPersistedList('w-1')).toBeUndefined()
      // Corrupt JSON and out-of-schema payloads are tolerated.
      localStorage.setItem('dsh-palm.list.v1.w-2', '{not json')
      expect(loadPersistedList('w-2')).toBeUndefined()
      localStorage.setItem('dsh-palm.list.v1.w-3', JSON.stringify({ v: 99, rows: [] }))
      expect(loadPersistedList('w-3')).toBeUndefined()
      localStorage.setItem('dsh-palm.list.v1.w-4', JSON.stringify({ v: 1, rows: [{ bad: true }], savedAt: Date.now() }))
      expect(loadPersistedList('w-4')).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('clearPairingCaches drops every persisted key', () => {
    savePersistedList('w-1', { rows: [row('s-1')], hasMore: false })
    // Unrelated keys survive.
    localStorage.setItem('dsh-palm.list-persist.test.unrelated', 'keep')
    clearPairingCaches()
    expect(loadPersistedList('w-1')).toBeUndefined()
    expect(localStorage.getItem('dsh-palm.list-persist.test.unrelated')).toBe('keep')
  })

  it('maintainPersistedCaches drops expired list entries only', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_700_000_000_000)
      savePersistedList('w-1', { rows: [row('s-1')], hasMore: false })
      vi.setSystemTime(1_700_000_000_000 + 25 * 60 * 60 * 1000)
      // A fresh entry written "now" survives the pass.
      savePersistedList('w-2', { rows: [row('s-2')], hasMore: false })
      maintainPersistedCaches()
      expect(loadPersistedList('w-1')).toBeUndefined()
      expect(loadPersistedList('w-2')).not.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('registry-backed eviction survives a re-save of remaining keys', () => {
    savePersistedList('w-1', { rows: [row('s-1')], hasMore: false })
    savePersistedList('w-2', { rows: [row('s-2')], hasMore: false })
    clearPairingCaches()
    expect(loadPersistedList('w-1')).toBeUndefined()
    expect(loadPersistedList('w-2')).toBeUndefined()
    // The registry itself stays usable for later saves.
    savePersistedList('w-3', { rows: [row('s-3')], hasMore: false })
    clearPairingCaches()
    expect(loadPersistedList('w-3')).toBeUndefined()
    expect(localStorage.getItem('dsh-palm.cache-index.v1')).not.toBeNull()
  })
})

describe('composer drafts', () => {
  it('round-trips a draft per session and removes on empty save', () => {
    saveDraft('s-1', '正在写的内容')
    expect(loadDraft('s-1')).toBe('正在写的内容')
    expect(loadDraft('s-2')).toBe('')
    // Empty save removes the entry.
    saveDraft('s-1', '')
    expect(loadDraft('s-1')).toBe('')
    // removeDraft is idempotent.
    removeDraft('s-1')
    expect(loadDraft('s-1')).toBe('')
  })

  it('caps a draft at the length limit', () => {
    saveDraft('s-1', 'x'.repeat(5000))
    expect(loadDraft('s-1').length).toBe(4096)
  })

  it('expires drafts after the TTL and drops them in maintenance', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_700_000_000_000)
      saveDraft('s-1', '旧草稿')
      vi.setSystemTime(1_700_000_000_000 + 8 * 24 * 60 * 60 * 1000)
      expect(loadDraft('s-1')).toBe('') // TTL gate on read
      // A fresh draft survives the maintenance pass.
      saveDraft('s-2', '新草稿')
      maintainPersistedCaches()
      expect(loadDraft('s-2')).toBe('新草稿')
    } finally {
      vi.useRealTimers()
    }
  })

  it('evicts the oldest drafts past the entry cap', () => {
    for (let index = 0; index < 55; index++) saveDraft(`s-${index}`, `草稿 ${index}`)
    // The 5 oldest (s-0..s-4) are gone; the newest survive.
    expect(loadDraft('s-0')).toBe('')
    expect(loadDraft('s-4')).toBe('')
    expect(loadDraft('s-54')).toBe('草稿 54')
  })

  it('clearPairingCaches drops drafts too (sensitive text must not linger)', () => {
    saveDraft('s-1', '敏感草稿')
    savePersistedList('w-1', { rows: [row('s-1')], hasMore: false })
    clearPairingCaches()
    expect(loadDraft('s-1')).toBe('')
    expect(loadPersistedList('w-1')).toBeUndefined()
  })
})

/**
 * The persisted roster page is a whole-blob rewrite, so writing it on the
 * interaction that produced it puts a JSON.stringify plus a synchronous
 * localStorage write on the main thread exactly while the list is being
 * scrolled. These pin the deferred path: a trailing window collapses a burst
 * into one write of the newest value, the page-hide paths flush it, and a
 * pairing eviction drops it outright.
 */
describe('deferred store writes', () => {
  /**
   * Swap in a plain-object storage for one test. Counting writes cannot go
   * through `vi.spyOn(localStorage, 'setItem')`: on a CI runner the global is a
   * storage proxy, the spy silently fails to intercept, and every assertion
   * about writes turns vacuously true. A plain object behaves identically
   * everywhere and makes "how many writes" observable.
   */
  function installFakeStorage(): { writes: string[]; restore: () => void } {
    const store = new Map<string, string>()
    const writes: string[] = []
    vi.stubGlobal('localStorage', {
      get length() { return store.size },
      key: (index: number) => [...store.keys()][index] ?? null,
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { writes.push(key); store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) },
      clear: () => { store.clear() },
    })
    return { writes, restore: () => { vi.unstubAllGlobals() } }
  }

  it('keeps one deferred page per workspace, newest wins', () => {
    vi.useFakeTimers()
    try {
      queuePersistedList('w-1', { rows: [row('s-1')], hasMore: true })
      queuePersistedList('w-1', { rows: [row('s-1'), row('s-2')], hasMore: false })
      queuePersistedList('w-2', { rows: [row('s-9')], hasMore: false })
      vi.advanceTimersByTime(PERSIST_COALESCE_MS)
      const w1 = loadPersistedList('w-1')
      expect(w1?.rows.map(entry => entry.sessionId)).toEqual(['s-1', 's-2'])
      expect(w1?.hasMore).toBe(false)
      expect(loadPersistedList('w-2')?.rows).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('flushes a deferred write when the page is hidden, and cancels the timer', () => {
    const storage = installFakeStorage()
    vi.useFakeTimers()
    try {
      queuePersistedList('w-1', { rows: [row('s-1')], hasMore: false })
      document.dispatchEvent(new Event('pagehide'))
      expect(loadPersistedList('w-1')?.rows).toHaveLength(1)
      expect(storage.writes.filter(name => name === 'dsh-palm.list.v1.w-1')).toHaveLength(1)
      // The window's timer went with the flush: advancing writes nothing more.
      vi.advanceTimersByTime(PERSIST_COALESCE_MS)
      expect(storage.writes.filter(name => name === 'dsh-palm.list.v1.w-1')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
      storage.restore()
    }
  })

  it('flushes when the page goes to the background (iOS freeze path)', () => {
    vi.useFakeTimers()
    try {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      try {
        queuePersistedList('w-1', { rows: [row('s-1')], hasMore: false })
        document.dispatchEvent(new Event('visibilitychange'))
        expect(loadPersistedList('w-1')?.rows).toHaveLength(1)
      } finally {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('an explicit flush writes now and re-arms cleanly afterwards', () => {
    vi.useFakeTimers()
    try {
      queuePersistedList('w-1', { rows: [row('s-1')], hasMore: false })
      flushPersistedWrites()
      expect(loadPersistedList('w-1')?.rows).toHaveLength(1)
      queuePersistedList('w-2', { rows: [row('s-2')], hasMore: false })
      vi.advanceTimersByTime(PERSIST_COALESCE_MS)
      expect(loadPersistedList('w-2')?.rows).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clearPairingCaches drops queued writes instead of resurrecting them', () => {
    vi.useFakeTimers()
    try {
      savePersistedList('w-1', { rows: [row('s-1')], hasMore: false })
      queuePersistedList('w-1', { rows: [row('s-1'), row('s-2')], hasMore: false })
      clearPairingCaches()
      vi.advanceTimersByTime(PERSIST_COALESCE_MS * 2)
      expect(loadPersistedList('w-1')).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('sweeps the retired reading bookmarks a phone may still carry', () => {
    // 2026-10-20: the 「回到上次」 chip was removed. Phones that ran an older
    // build still hold v1/v2/v3 records, so the maintenance pass must drop them
    // (nothing else reads or writes that store any more).
    const keys = [
      'dsh-palm.reading.v1.s-old',
      'dsh-palm.reading.v2.s-old',
      'dsh-palm.reading.v3.s-old',
    ]
    for (const key of keys) localStorage.setItem(key, JSON.stringify({ t: Date.now(), v: 3 }))
    localStorage.setItem('dsh-palm.cache-index.v1', JSON.stringify(keys))
    maintainPersistedCaches()
    for (const key of keys) expect(localStorage.getItem(key)).toBeNull()
  })

  it('clearPairingCaches drops the retired reading bookmarks too', () => {
    const keys = ['dsh-palm.reading.v2.s-old', 'dsh-palm.reading.v3.s-old']
    for (const key of keys) localStorage.setItem(key, JSON.stringify({ t: Date.now(), v: 5 }))
    localStorage.setItem('dsh-palm.cache-index.v1', JSON.stringify(keys))
    clearPairingCaches()
    for (const key of keys) expect(localStorage.getItem(key)).toBeNull()
  })
})
