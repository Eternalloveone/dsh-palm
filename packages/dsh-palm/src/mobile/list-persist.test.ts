/**
 * list-persist (v3.3 PWA cold-start store): round-trips, TTL expiry, corrupt
 * data tolerance, preview capacity trimming, pairing eviction, and the
 * opportunistic maintenance pass.
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelPersistedWrites,
  clearPairingCaches,
  flushPersistedWrites,
  loadDraft,
  loadPersistedList,
  loadPersistedScroll,
  loadPersistedPreviews,
  loadPinnedSessions,
  maintainPersistedCaches,
  PERSIST_COALESCE_MS,
  queuePersistedList,
  queuePersistedPreviews,
  removeDraft,
  saveDraft,
  savePersistedList,
  savePersistedPreviews,
  savePersistedScroll,
  savePinnedSessions,
} from './list-persist.ts'
import type { SessionView } from './views/App.tsx'

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
  it('round-trips a list page and scroll offset per workspace', () => {
    savePersistedList('w-1', { rows: [row('s-1')], cursor: 'c1', hasMore: true })
    savePersistedScroll('w-1', 432)
    const loaded = loadPersistedList('w-1')
    expect(loaded?.rows).toEqual([row('s-1')])
    expect(loaded?.cursor).toBe('c1')
    expect(loaded?.hasMore).toBe(true)
    expect(loadPersistedScroll('w-1')).toBe(432)
    // Other workspaces stay independent.
    expect(loadPersistedList('w-2')).toBeUndefined()
    expect(loadPersistedScroll('w-2')).toBe(0)
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

  it('round-trips preview summaries and trims past capacity', () => {
    const map = new Map<string, string>()
    for (let index = 0; index < 600; index++) map.set(`s-${index}`, `摘要 ${index}`)
    savePersistedPreviews(map)
    const loaded = loadPersistedPreviews()
    expect(loaded.size).toBeLessThanOrEqual(500)
    // Newest-inserted entries survive (insertion order preserved).
    expect(loaded.has('s-599')).toBe(true)
    expect(loaded.has('s-0')).toBe(false)
    // Re-save the loaded map: stable round-trip.
    savePersistedPreviews(loaded)
    expect(loadPersistedPreviews().size).toBe(loaded.size)
  })

  it('drops non-string preview payloads', () => {
    localStorage.setItem('dsh-palm.prev.v1', JSON.stringify({ 's-1': 'ok', 's-2': 42, 's-3': '' }))
    const loaded = loadPersistedPreviews()
    expect(loaded.get('s-1')).toBe('ok')
    expect(loaded.has('s-2')).toBe(false)
    expect(loaded.has('s-3')).toBe(false)
  })

  it('clearPairingCaches drops every persisted key', () => {
    savePersistedList('w-1', { rows: [row('s-1')], hasMore: false })
    savePersistedScroll('w-1', 100)
    const map = new Map<string, string>([['s-1', '摘要']])
    savePersistedPreviews(map)
    // Unrelated keys survive.
    localStorage.setItem('dsh-palm.list-persist.test.unrelated', 'keep')
    clearPairingCaches()
    expect(loadPersistedList('w-1')).toBeUndefined()
    expect(loadPersistedScroll('w-1')).toBe(0)
    expect(loadPersistedPreviews().size).toBe(0)
    expect(localStorage.getItem('dsh-palm.list-persist.test.unrelated')).toBe('keep')
  })

  it('maintainPersistedCaches drops expired list entries only', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_700_000_000_000)
      savePersistedList('w-1', { rows: [row('s-1')], hasMore: false })
      savePersistedScroll('w-1', 100)
      vi.setSystemTime(1_700_000_000_000 + 25 * 60 * 60 * 1000)
      // A fresh entry written "now" survives the pass.
      savePersistedList('w-2', { rows: [row('s-2')], hasMore: false })
      maintainPersistedCaches()
      expect(loadPersistedList('w-1')).toBeUndefined()
      expect(loadPersistedList('w-2')).not.toBeUndefined()
      // Scroll offsets are not part of the maintenance pass.
      expect(loadPersistedScroll('w-1')).toBe(100)
    } finally {
      vi.useRealTimers()
    }
  })

  it('registry-backed eviction survives a re-save of remaining keys', () => {
    savePersistedList('w-1', { rows: [row('s-1')], hasMore: false })
    savePersistedList('w-2', { rows: [row('s-2')], hasMore: false })
    savePersistedScroll('w-1', 80)
    clearPairingCaches()
    expect(loadPersistedList('w-1')).toBeUndefined()
    expect(loadPersistedList('w-2')).toBeUndefined()
    expect(loadPersistedScroll('w-1')).toBe(0)
    // The registry itself stays usable for later saves.
    savePersistedList('w-3', { rows: [row('s-3')], hasMore: false })
    clearPairingCaches()
    expect(loadPersistedList('w-3')).toBeUndefined()
    expect(localStorage.getItem('dsh-palm.cache-index.v1')).not.toBeNull()
  })
})

describe('pinned sessions', () => {
  it('round-trips the pinned id set (insertion order preserved)', () => {
    savePinnedSessions(new Set(['s-2', 's-1']))
    const loaded = loadPinnedSessions()
    expect([...loaded]).toEqual(['s-2', 's-1'])
    expect(loaded.has('s-1')).toBe(true)
    expect(loaded.has('s-3')).toBe(false)
  })

  it('tolerates corrupt / non-array payloads', () => {
    localStorage.setItem('dsh-palm.pin.v1', '{not json')
    expect(loadPinnedSessions().size).toBe(0)
    localStorage.setItem('dsh-palm.pin.v1', JSON.stringify({ bad: true }))
    expect(loadPinnedSessions().size).toBe(0)
    localStorage.setItem('dsh-palm.pin.v1', JSON.stringify(['s-1', 42, 's-2']))
    expect([...loadPinnedSessions()]).toEqual(['s-1', 's-2'])
  })

  it('clearPairingCaches drops pins too', () => {
    savePinnedSessions(new Set(['s-1']))
    clearPairingCaches()
    expect(loadPinnedSessions().size).toBe(0)
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
 * Both persisted stores are whole-blob rewrites (a roster page, or up to 500
 * preview summaries), so writing them on the interaction that produced them
 * puts a JSON.stringify plus a synchronous localStorage write on the main
 * thread exactly while the list is being scrolled. These pin the deferred
 * path: a trailing window collapses a burst into one write of the newest
 * value, the page-hide paths flush it, and a pairing eviction drops it
 * outright.
 */
describe('deferred store writes', () => {
  /** The preview store's localStorage name (module-private in list-persist.ts). */
  const PREVIEW_STORE = 'dsh-palm.prev.v1'

  /**
   * Swap in a plain-object storage for one test. Counting writes cannot go
   * through `vi.spyOn(localStorage, 'setItem')`: on a CI runner the global is a
   * storage proxy, the spy silently fails to intercept, and every assertion
   * about writes turns vacuously true — which is how the 1.3.5 publish gate
   * went red while the local gate was green. A plain object behaves identically
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

  it('collapses a burst of preview schedules into one write of the newest map', () => {
    const storage = installFakeStorage()
    vi.useFakeTimers()
    try {
      queuePersistedPreviews(new Map([['s-1', '旧摘要']]))
      // Nothing on the interaction path: not even the stringify has happened.
      expect(loadPersistedPreviews().size).toBe(0)
      vi.advanceTimersByTime(PERSIST_COALESCE_MS * 0.6)
      // A later update inside the same window must NOT postpone the write past
      // it: a coalescing writer that re-arms starves and drops the newest state.
      queuePersistedPreviews(new Map([['s-1', '新摘要'], ['s-2', '另一条']]))
      expect(storage.writes).toHaveLength(0)
      vi.advanceTimersByTime(PERSIST_COALESCE_MS * 0.6)
      expect(storage.writes.filter(name => name === PREVIEW_STORE)).toHaveLength(1)
      const loaded = loadPersistedPreviews()
      expect(loaded.get('s-1')).toBe('新摘要')
      expect(loaded.get('s-2')).toBe('另一条')
    } finally {
      vi.useRealTimers()
      storage.restore()
    }
  })

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

  it('does not arm a write for an empty preview map', () => {
    const storage = installFakeStorage()
    vi.useFakeTimers()
    try {
      queuePersistedPreviews(new Map())
      vi.advanceTimersByTime(PERSIST_COALESCE_MS * 2)
      expect(storage.writes).toHaveLength(0)
      expect(loadPersistedPreviews().size).toBe(0)
    } finally {
      vi.useRealTimers()
      storage.restore()
    }
  })

  it('flushes a deferred write when the page is hidden, and cancels the timer', () => {
    const storage = installFakeStorage()
    vi.useFakeTimers()
    try {
      queuePersistedPreviews(new Map([['s-1', '口袋里的摘要']]))
      document.dispatchEvent(new Event('pagehide'))
      expect(loadPersistedPreviews().get('s-1')).toBe('口袋里的摘要')
      expect(storage.writes.filter(name => name === PREVIEW_STORE)).toHaveLength(1)
      // The window's timer went with the flush: advancing writes nothing more.
      vi.advanceTimersByTime(PERSIST_COALESCE_MS)
      expect(storage.writes.filter(name => name === PREVIEW_STORE)).toHaveLength(1)
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
      queuePersistedPreviews(new Map([['s-1', 'a']]))
      flushPersistedWrites()
      expect(loadPersistedPreviews().get('s-1')).toBe('a')
      queuePersistedPreviews(new Map([['s-2', 'b']]))
      vi.advanceTimersByTime(PERSIST_COALESCE_MS)
      expect(loadPersistedPreviews().get('s-2')).toBe('b')
    } finally {
      vi.useRealTimers()
    }
  })

  it('clearPairingCaches drops queued writes instead of resurrecting them', () => {
    vi.useFakeTimers()
    try {
      savePersistedList('w-1', { rows: [row('s-1')], hasMore: false })
      queuePersistedList('w-1', { rows: [row('s-1'), row('s-2')], hasMore: false })
      queuePersistedPreviews(new Map([['s-1', '别的设备的摘要']]))
      clearPairingCaches()
      vi.advanceTimersByTime(PERSIST_COALESCE_MS * 2)
      expect(loadPersistedList('w-1')).toBeUndefined()
      expect(loadPersistedPreviews().size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
