// @vitest-environment jsdom
/** perf.ts structural guarantees: no-op when off, bounded ring, spans, export. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recordError } from './errors.ts'
import {
  LONG_TASK_RING_CAP, PERF_KEY, PERF_RING_CAP,
  installPerfWindowHook, perfAnomaly, perfClear, perfEnabled, perfMark, perfRefresh, perfSnapshot, perfStats,
  startPerfSampler,
} from './perf.ts'

const KEY = PERF_KEY

beforeEach(() => {
  perfClear()
  localStorage.removeItem(KEY)
  history.replaceState(null, '', '/m/') // no ?perf=1
})

afterEach(() => {
  perfClear()
  localStorage.removeItem(KEY)
  history.replaceState(null, '', '/m/')
})

describe('mobile perf instrumentation', () => {
  it('is a no-op while the switch is off', () => {
    expect(perfEnabled()).toBe(false)
    perfMark('recv', { seq: 1 })
    perfAnomaly('seq-gap', 'x')
    const snapshot = perfSnapshot()
    expect(snapshot.armed).toBe(false)
    expect(snapshot.marks).toHaveLength(0)
    expect(snapshot.anomalies).toHaveLength(0)
    expect(snapshot.frames).toEqual({ sampled: 0, long: 0 })
  })

  it('records marks and derives spans once armed via localStorage', () => {
    localStorage.setItem(KEY, '1')
    perfRefresh()
    expect(perfEnabled()).toBe(true)
    perfMark('recv', { seq: 5, frame: 'session/event' })
    perfMark('state', { seq: 5, frame: 'session/event' })
    perfMark('commit', { seq: 5, frame: 'session/event' })
    const stats = perfStats()
    expect(stats.armed).toBe(true)
    expect(stats.marks).toBe(3)
    expect((stats.spans as { toState: { n: number } }).toState.n).toBe(1)
    expect((stats.spans as { toCommit: { n: number } }).toCommit.n).toBe(1)
    // spans are non-negative durations
    for (const key of ['toState', 'toCommit'] as const) {
      const span = (stats.spans as Record<string, { avg: number; max: number }>)[key]
      expect(span.avg).toBeGreaterThanOrEqual(0)
      expect(span.max).toBeGreaterThanOrEqual(span.avg)
    }
    // per-seq spans only pair the same seq's recv with its later marks
    perfMark('state', { seq: 99, frame: 'session/event' }) // no recv for 99
    const after = perfStats()
    expect((after.spans as { toState: { n: number } }).toState.n).toBe(1)
  })

  it('records anomalies and caps the ring buffer', () => {
    localStorage.setItem(KEY, '1')
    perfRefresh()
    perfAnomaly('poll-refill', 'window')
    perfAnomaly('seq-gap', 'last=1 got=9')
    expect(perfSnapshot().anomalies).toEqual([
      { kind: 'poll-refill', at: expect.any(Number), detail: 'window' },
      { kind: 'seq-gap', at: expect.any(Number), detail: 'last=1 got=9' },
    ])
    for (let i = 0; i < PERF_RING_CAP + 100; i++) perfMark('recv', { seq: i })
    expect(perfSnapshot().marks.length).toBeLessThanOrEqual(PERF_RING_CAP)
  })

  it('clear() resets everything while armed', () => {
    localStorage.setItem(KEY, '1')
    perfRefresh()
    perfMark('recv', { seq: 1 })
    perfClear()
    expect(perfSnapshot().marks).toHaveLength(0)
    expect(perfStats().marks).toBe(0)
  })

  it('installs the window export', () => {
    localStorage.setItem(KEY, '1')
    perfRefresh()
    installPerfWindowHook()
    const api = (window as unknown as { __dshPalmPerf?: { toJSON: () => unknown; clear: () => void; refresh: () => void } }).__dshPalmPerf
    expect(api).toBeTruthy()
    expect(typeof api?.toJSON).toBe('function')
    expect(typeof api?.clear).toBe('function')
    expect(typeof api?.refresh).toBe('function')
  })
})

/** One Long Task entry as the observer would deliver it. */
function longTask(startTime: number, duration: number): PerformanceEntry {
  return { startTime, duration, name: 'self', entryType: 'longtask', toJSON: () => ({}) } as PerformanceEntry
}

describe('long tasks, suspension and the capture envelope', () => {
  it('installs no observer while the switch is off', () => {
    const Observer = vi.fn()
    vi.stubGlobal('PerformanceObserver', Observer)
    try {
      startPerfSampler()
      expect(Observer).not.toHaveBeenCalled()
      expect(perfSnapshot().longTasks).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('observes long tasks, and flags the ones that began while hidden', () => {
    let deliver: ((list: { getEntries: () => PerformanceEntry[] }) => void) | undefined
    const observe = vi.fn()
    class FakeObserver {
      constructor(callback: (list: { getEntries: () => PerformanceEntry[] }) => void) { deliver = callback }
      observe(init: unknown): void { observe(init) }
    }
    vi.stubGlobal('PerformanceObserver', FakeObserver)
    localStorage.setItem(KEY, '1')
    perfRefresh()
    try {
      startPerfSampler()
      expect(observe).toHaveBeenCalledWith({ entryTypes: ['longtask'] })

      // Hide, take a "long task" while hidden, then come back and take a real one.
      const hiddenFrom = performance.now()
      Object.defineProperty(document, 'hidden', { value: true, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      const whileHidden = performance.now()
      deliver?.({ getEntries: () => [longTask(whileHidden, 9000)] })
      Object.defineProperty(document, 'hidden', { value: false, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      const visibleAgain = performance.now()
      deliver?.({ getEntries: () => [longTask(visibleAgain + 5, 120)] })

      const stats = perfStats() as {
        longTasks: { n: number; suspended: number; max: number }
        suspension: { hiddenCount: number }
      }
      // The 9s entry overlapped a hidden window: suspension, not jank. Mixing it
      // into the distribution would invent a regression no code change caused.
      expect(stats.longTasks.n).toBe(1)
      expect(stats.longTasks.suspended).toBe(1)
      expect(stats.longTasks.max).toBe(120)
      expect(stats.suspension.hiddenCount).toBe(1)
      expect(perfSnapshot().suspension.hiddenMs).toBeGreaterThanOrEqual(0)
      expect(perfSnapshot().longTasks).toHaveLength(2)
      expect(hiddenFrom).toBeLessThanOrEqual(whileHidden)

      // The ring is bounded like every other capture buffer.
      deliver?.({
        getEntries: () => Array.from(
          { length: LONG_TASK_RING_CAP + 5 },
          (_, index) => longTask(visibleAgain + 10 + index, 60),
        ),
      })
      expect(perfSnapshot().longTasks).toHaveLength(LONG_TASK_RING_CAP)
    } finally {
      vi.unstubAllGlobals()
      Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    }
  })

  it('carries the error ring and the storage picture inside every capture', () => {
    recordError({ kind: 'error', message: 'boom from a test' })

    const snapshot = perfSnapshot()
    expect(snapshot.errors.total).toBe(1)
    expect(snapshot.errors.recent[0]?.message).toBe('boom from a test')
    // storage.ts has not been asked yet on this page; the shape is still present.
    expect(snapshot.storage).toEqual({ persisted: false })

    const stats = perfStats() as { errors: { total: number }; storage: unknown; suspension: unknown }
    expect(stats.errors.total).toBe(1)
    expect(stats.storage).toBeTruthy()
    expect(stats.suspension).toBeTruthy()
  })
})
