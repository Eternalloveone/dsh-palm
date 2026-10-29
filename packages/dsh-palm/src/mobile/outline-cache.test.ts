// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearOutlineCache, getCachedOutline, setCachedOutline } from './outline-cache.ts'

describe('outline cache', () => {
  beforeEach(() => {
    clearOutlineCache()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('hands back what was stored for the same session', () => {
    const turns = [{ turn: 1, seq: 1 }]
    setCachedOutline('s-1', turns)
    expect(getCachedOutline('s-1')).toBe(turns)
    // 另一个会话互不影响：大纲是逐会话的。
    expect(getCachedOutline('s-2')).toBeUndefined()
  })

  it('expires after five minutes so a stale list cannot outlive the host snapshot', () => {
    setCachedOutline('s-1', [{ turn: 1, seq: 1 }])
    vi.advanceTimersByTime(4 * 60 * 1000)
    expect(getCachedOutline('s-1')).toBeDefined()
    vi.advanceTimersByTime(2 * 60 * 1000)
    expect(getCachedOutline('s-1')).toBeUndefined()
  })

  it('does not cache an empty answer, so a session with no snapshot is asked again', () => {
    setCachedOutline('s-1', null)
    setCachedOutline('s-1', undefined)
    expect(getCachedOutline('s-1')).toBeUndefined()
  })

  it('keeps at most eight sessions, dropping the least recently stored', () => {
    for (let i = 0; i < 10; i += 1) setCachedOutline(`s-${i}`, [{ turn: i, seq: i }])
    expect(getCachedOutline('s-0')).toBeUndefined()
    expect(getCachedOutline('s-1')).toBeUndefined()
    expect(getCachedOutline('s-2')).toBeDefined()
    expect(getCachedOutline('s-9')).toBeDefined()
  })
})
