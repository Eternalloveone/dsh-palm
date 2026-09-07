// @vitest-environment jsdom
/** perf.ts structural guarantees: no-op when off, bounded ring, spans, export. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PERF_KEY, PERF_RING_CAP,
  installPerfWindowHook, perfAnomaly, perfClear, perfEnabled, perfMark, perfRefresh, perfSnapshot, perfStats,
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
