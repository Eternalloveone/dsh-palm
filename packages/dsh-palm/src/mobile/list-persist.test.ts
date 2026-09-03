/**
 * list-persist (v3.3 PWA cold-start store): round-trips, TTL expiry, corrupt
 * data tolerance, preview capacity trimming, pairing eviction, and the
 * opportunistic maintenance pass.
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPairingCaches,
  loadDraft,
  loadPersistedList,
  loadPersistedScroll,
  loadPersistedPreviews,
  maintainPersistedCaches,
  removeDraft,
  saveDraft,
  savePersistedList,
  savePersistedPreviews,
  savePersistedScroll,
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
