/**
 * `mobile.perf` intake: what may land on disk, where it lands, and how much of
 * it is kept. The route itself is a thin wrapper around these three functions,
 * so the guarantees (host-named path, shape validation, retention) are pinned
 * here rather than through the HTTP layer.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PERF_CAPTURE_KEEP,
  PERF_CAPTURE_MAX_BYTES,
  PERF_RAW_MAX_BYTES,
  perfCaptureKind,
  prunePerfCaptures,
  validatePerfCapture,
  writePerfCapture,
} from './mobile-api.ts'

/** The shape `window.__dshPalmPerf.stats()` returns (aggregates only). */
const capture = {
  spans: { toState: { p50: 1.2, p95: 3.4 }, toCommit: { p50: 4.5, p95: 9.9 } },
  frames: { sampled: 900, long: 3 },
  anomalies: [{ kind: 'seq-gap', at: 12, detail: 'last=1 got=9' }],
}

describe('mobile.perf intake', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-palm-perf-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('accepts a stats() aggregate and refuses everything else', () => {
    expect(validatePerfCapture(capture)).toBeUndefined()
    expect(validatePerfCapture(null)).toBeDefined()
    expect(validatePerfCapture('capture')).toBeDefined()
    expect(validatePerfCapture([1, 2, 3])).toBeDefined()
    expect(validatePerfCapture({})).toBeDefined()
    // spans without the two spans the parser needs (parse-capture.mjs requires
    // toState/toCommit) is not a usable capture either.
    expect(validatePerfCapture({ spans: {}, frames: {} })).toBeDefined()
    // Its own ceiling: the aggregate form is a few KB, so past 64 KB is a bug.
    expect(validatePerfCapture({ spans: { toState: {} }, filler: 'x'.repeat(PERF_CAPTURE_MAX_BYTES) }))
      .toBe('性能抓取超过体积上限')
  })

  it('accepts the raw mark ring, and refuses an empty or oversized one', () => {
    const ring = { marks: 2, stamps: [{ t: 1, stage: 'recv' }, { t: 2, stage: 'commit' }] }
    expect(perfCaptureKind(ring)).toBe('raw')
    expect(perfCaptureKind(capture)).toBe('aggregate')
    expect(perfCaptureKind(null)).toBe('invalid')
    expect(validatePerfCapture(ring)).toBeUndefined()
    // A raw capture with no marks adds nothing the aggregate would not.
    expect(validatePerfCapture({ stamps: [], frames: {} })).toBe('原始抓取里没有标记')
    // The raw ring is ~200 KB when full, so it has its own ceiling.
    const oversized = { stamps: Array.from({ length: 8000 }, (_, i) => ({ t: i, stage: 'recv', detail: 'y'.repeat(100) })) }
    expect(Buffer.byteLength(JSON.stringify(oversized))).toBeGreaterThan(PERF_RAW_MAX_BYTES)
    expect(validatePerfCapture(oversized)).toBe('原始抓取超过体积上限')
  })

  it('writes the capture kind into the file name', () => {
    const rawFile = writePerfCapture(dir, { stamps: [{ t: 1 }] }, 'android-lan', Date.UTC(2026, 8, 12, 2, 0, 0), 'raw')
    const aggregateFile = writePerfCapture(dir, capture, 'android-lan', Date.UTC(2026, 8, 12, 2, 1, 0))
    expect(basename(rawFile)).toContain('-android-lan-raw.json')
    expect(basename(aggregateFile)).toContain('-android-lan-aggregate.json')
  })

  it('names the file host-side, so no wire label can steer a path', () => {
    const file = writePerfCapture(dir, capture, '../../etc/passwd', Date.UTC(2026, 8, 12, 1, 2, 3))
    expect(file.startsWith(dir)).toBe(true)
    const name = basename(file)
    expect(name).not.toContain('/')
    expect(name).not.toContain('\\')
    expect(name).not.toContain('..')
    expect(name).toMatch(/^capture-2026-09-12T01-02-03-000Z-[A-Za-z0-9_-]+\.json$/)
    expect(readdirSync(dir)).toHaveLength(1)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(capture)
  })

  it('falls back to a generic label when the wire label sanitizes away', () => {
    const file = writePerfCapture(dir, capture, '../..', Date.UTC(2026, 8, 12, 1, 0, 0))
    expect(basename(file)).toContain('-device-aggregate.json')
  })

  it('keeps only the newest captures', () => {
    for (let minute = 0; minute < PERF_CAPTURE_KEEP + 5; minute++) {
      writePerfCapture(dir, capture, 'android-lan', Date.UTC(2026, 8, 12, 1, minute, 0))
    }
    const names = readdirSync(dir).sort()
    expect(names).toHaveLength(PERF_CAPTURE_KEEP)
    // Names start with the ISO stamp, so the sort is an age sort: the oldest
    // minutes are the ones that went.
    expect(names[0]).toContain('01-05-00')
    expect(names[names.length - 1]).toContain(`01-${PERF_CAPTURE_KEEP + 4}-00`)
  })

  it('never throws on an unreadable directory (prune is best effort)', () => {
    expect(() => { prunePerfCaptures(join(dir, 'missing'), 3) }).not.toThrow()
    expect(() => { prunePerfCaptures(dir, 0) }).not.toThrow()
  })
})
