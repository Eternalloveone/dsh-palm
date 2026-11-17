/**
 * `mobile.error` intake: what may land on disk, where it lands, and how much is
 * kept. The route is a thin wrapper around these functions, so the guarantees
 * are pinned here rather than through HTTP: strict shape rejection, host-named
 * paths (nothing from the wire steers one), retention, and a stable fingerprint.
 * **This channel never pushes** (2026-11-17): `pushed` is always false.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ERROR_REPORT_KEEP,
  errorFingerprint,
  errorSeen,
  ingestErrorReport,
  pruneErrorReports,
  validateErrorReport,
  writeErrorReport,
} from './mobile-api.ts'

/** A well-formed report, exactly the shape errors.ts keeps. */
const report = {
  kind: 'error',
  message: 'boom',
  source: 'mobile.js:12:34',
  frames: ['chat.js:1:1', 'app.js:5:6'],
  count: 1,
  clientAt: 1234,
}

describe('mobile.error validation', () => {
  it('accepts a well-formed report', () => {
    expect(validateErrorReport(report)).toBeUndefined()
  })

  it('refuses non-objects and missing/illegal kind', () => {
    expect(validateErrorReport(null)).toBeDefined()
    expect(validateErrorReport('report')).toBeDefined()
    expect(validateErrorReport([report])).toBeDefined()
    expect(validateErrorReport({ ...report, kind: 'other' })).toBeDefined()
    expect(validateErrorReport({ ...report, kind: undefined })).toBeDefined()
  })

  it('refuses a non-string or absent message, and one over the ring cap', () => {
    expect(validateErrorReport({ ...report, message: '' })).toBeDefined()
    expect(validateErrorReport({ ...report, message: 42 })).toBeDefined()
    // The cap is the CLIENT ring's 240 chars, not the 64 KB body ceiling: a
    // message the ring could never produce is refused, not absorbed.
    expect(validateErrorReport({ ...report, message: 'x'.repeat(240) })).toBeUndefined()
    expect(validateErrorReport({ ...report, message: 'x'.repeat(241) })).toBe('错误报告 message 超过 240 字')
    // The body ceiling still applies to the whole report: a frame is a basename
    // shape but unbounded in length, so an oversized one is caught here.
    expect(validateErrorReport({ ...report, frames: [`${'x'.repeat(70 * 1024)}:1:1`] })).toBe('错误报告超过体积上限')
  })

  it('refuses an illegal source and over-limit frames', () => {
    // A path separator in source is a path-carrying attempt, not a location.
    expect(validateErrorReport({ ...report, source: '../../etc/passwd' })).toBeDefined()
    expect(validateErrorReport({ ...report, source: 'not-a-frame' })).toBeDefined()
    // A full URL is the other half of the same rule: errors.ts reduces
    // event.filename to a basename before reporting, so a URL arriving here
    // would put the origin on disk.
    expect(validateErrorReport({ ...report, source: 'https://host:3080/m/mobile.js:12:34' })).toBeDefined()
    expect(validateErrorReport({ ...report, source: 'mobile.js:12:34' })).toBeUndefined()
    expect(validateErrorReport({ ...report, frames: ['a.js:1:1', 'b.js:2:2', 'c.js:3:3', 'd.js:4:4'] })).toBe('错误报告帧数超过 3 条')
    expect(validateErrorReport({ ...report, frames: ['../x.js:1:1'] })).toBeDefined()
    expect(validateErrorReport({ ...report, frames: 'nope' })).toBeDefined()
  })

  it('refuses a non-positive count', () => {
    expect(validateErrorReport({ ...report, count: 0 })).toBeDefined()
    expect(validateErrorReport({ ...report, count: -1 })).toBeDefined()
    expect(validateErrorReport({ ...report, count: 1.5 })).toBeDefined()
    expect(validateErrorReport({ ...report, count: undefined })).toBeDefined()
  })
})

describe('mobile.error fingerprint + intake', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-palm-errors-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('is a stable 8-hex hash of kind + message + source', () => {
    const a = errorFingerprint(report)
    expect(a).toMatch(/^[0-9a-f]{8}$/)
    // Same kind+message+source → same fingerprint.
    expect(errorFingerprint(report)).toBe(a)
    // Anything different → different fingerprint.
    expect(errorFingerprint({ ...report, message: 'boom2' })).not.toBe(a)
    expect(errorFingerprint({ ...report, source: 'other.js:1:1' })).not.toBe(a)
  })

  it('names the file host-side, so no report string can steer a path', () => {
    const hostile = { ...report, message: '../../../../etc/passwd', source: '..\\\\..\\\\evil.js:1:1' }
    const file = writeErrorReport(dir, hostile, Date.UTC(2026, 8, 12, 1, 2, 3))
    expect(file.startsWith(dir)).toBe(true)
    const name = basename(file)
    expect(name).not.toContain('/')
    expect(name).not.toContain('\\')
    expect(name).not.toContain('..')
    expect(name).toMatch(/^error-2026-09-12T01-02-03-000Z-[0-9a-f]{8}\.json$/)
    expect(readdirSync(dir)).toHaveLength(1)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(hostile)
  })

  it('keeps only the newest reports', () => {
    for (let minute = 0; minute < ERROR_REPORT_KEEP + 5; minute++) {
      writeErrorReport(dir, { ...report, message: `m${minute}`, source: 'a.js:1:1' }, Date.UTC(2026, 8, 12, 1, minute, 0))
    }
    const names = readdirSync(dir).sort()
    expect(names).toHaveLength(ERROR_REPORT_KEEP)
    // Newest 20 kept; the five oldest minutes (0-4) are gone.
    expect(names.some(name => name.includes('T01-04-00'))).toBe(false)
    expect(names.some(name => name.includes('T01-05-00'))).toBe(true)
    expect(names.some(name => name.includes('T01-24-00'))).toBe(true)
  })

  it('report the same fingerprint as seen once it is written', () => {
    const file = writeErrorReport(dir, report, Date.UTC(2026, 8, 12, 1, 0, 0))
    const fingerprint = errorFingerprint(report)
    expect(errorSeen(dir, fingerprint)).toBe(true)
    expect(basename(file)).toContain(`-${fingerprint}.json`)
  })

  it('never throws on an unreadable directory (prune is best effort)', () => {
    expect(() => { pruneErrorReports(join(dir, 'missing'), 3) }).not.toThrow()
    expect(() => { pruneErrorReports(dir, 0) }).not.toThrow()
  })
})

describe('ingestErrorReport（只留档，不推送）', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-palm-errors-ingest-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('写一份真失败，pushed 恒为 false（这条通道不再推送）', () => {
    const first = ingestErrorReport({ dir, report, now: 1_000_000 })
    expect(first.pushed).toBe(false)
    expect(readdirSync(dir)).toHaveLength(1)
  })

  it('探针一律进 probe 日志，连「用户丢了东西」的两个也不再弹窗', () => {
    const probeDir = mkdtempSync(join(tmpdir(), 'dsh-palm-probes-'))
    try {
      for (const name of ['stream-lag', 'send-no-echo', 'turn-duplicate']) {
        const result = ingestErrorReport({
          dir,
          probeDir,
          now: new Date(2026, 10, 17, 12, 0, 0).getTime(),
          report: { kind: 'error', message: `${name} sessionId=s`, count: 1, probe: name },
        })
        expect(result.pushed).toBe(false)
        expect(basename(result.file)).toBe('probe-2026-11-17.jsonl')
      }
      expect(readdirSync(dir)).toEqual([])
      const logged = readFileSync(join(probeDir, 'probe-2026-11-17.jsonl'), 'utf8').trim().split('\n')
      expect(logged).toHaveLength(3)
    } finally {
      rmSync(probeDir, { recursive: true, force: true })
    }
  })

  it('没有 probeDir 时探针退回错误目录，仍然不推送', () => {
    const result = ingestErrorReport({
      dir,
      now: 1_000_000,
      report: { kind: 'error', message: 'stream-lag lag=1', count: 1, probe: 'stream-lag' },
    })
    expect(result.pushed).toBe(false)
    expect(readdirSync(dir)).toHaveLength(1)
  })
})
