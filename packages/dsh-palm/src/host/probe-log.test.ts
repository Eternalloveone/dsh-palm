import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendProbeLog, probeLogFile, pruneProbeLogs } from './probe-log.ts'

const dir = (): string => mkdtempSync(join(tmpdir(), 'palm-probes-'))
const at = (day: number): number => new Date(2026, 10, day, 12, 0, 0).getTime()

describe('探针日志（probe-log）', () => {
  it('一天一个文件，用宿主本地日期命名', () => {
    expect(probeLogFile('/tmp/x', at(16))).toBe(join('/tmp/x', 'probe-2026-11-16.jsonl'))
  })

  it('同一个探针追加到同一行式文件，一条一行 JSON', () => {
    const base = dir()
    appendProbeLog(base, { probe: 'stream-lag', lag: 28 }, at(16))
    appendProbeLog(base, { probe: 'stream-lag', lag: 31 }, at(16))
    const file = probeLogFile(base, at(16))
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!)).toMatchObject({ probe: 'stream-lag', lag: 28 })
    expect(JSON.parse(lines[1]!)).toMatchObject({ lag: 31 })
  })

  it('跨天分到不同文件', () => {
    const base = dir()
    appendProbeLog(base, { probe: 'flush-stall' }, at(15))
    appendProbeLog(base, { probe: 'flush-stall' }, at(16))
    expect(readdirSync(base).sort()).toEqual(['probe-2026-11-15.jsonl', 'probe-2026-11-16.jsonl'])
  })

  it('只留最近 keepDays 个文件', () => {
    const base = dir()
    for (const day of [10, 11, 12, 13]) appendProbeLog(base, { probe: 'p' }, at(day))
    pruneProbeLogs(base, 2)
    expect(readdirSync(base).sort()).toEqual(['probe-2026-11-12.jsonl', 'probe-2026-11-13.jsonl'])
  })

  it('目录不可写时不抛异常（日志不是关键路径）', () => {
    expect(() => appendProbeLog('', { probe: 'p' }, at(16))).not.toThrow()
    expect(appendProbeLog('', { probe: 'p' }, at(16))).toBeUndefined()
  })
})
