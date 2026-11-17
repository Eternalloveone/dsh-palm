import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { errorFingerprint, ingestErrorReport } from './error-report.ts'

const temp = (): string => mkdtempSync(join(tmpdir(), 'palm-policy-'))
const at = (): number => new Date(2026, 10, 16, 12, 0, 0).getTime()
const probe = (name: string, detail: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'error', message: `${name} lag=28 localSeq=3703`, count: 1, probe: name, at: at(), ...detail,
})
const failure = (): Record<string, unknown> => ({ kind: 'error', message: 'boom', count: 1, at: at() })

describe('探针 = 日志（2026-11-17 口径：任何探针都不推送、不弹窗）', () => {
  it('每个探针都只写 probe 日志，错误目录一条不留', () => {
    const errorDir = temp()
    const probeDir = temp()
    const names = ['stream-lag', 'tail-reload-stall', 'tail-reload-failed', 'flush-stall', 'send-no-echo', 'turn-duplicate']
    for (const name of names) {
      const result = ingestErrorReport({ dir: errorDir, probeDir, report: probe(name), now: at() })
      expect(result.pushed).toBe(false)
    }
    expect(readdirSync(errorDir)).toEqual([])
    const lines = readFileSync(join(probeDir, 'probe-2026-11-16.jsonl'), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(names.length)
    for (const name of names) expect(lines.some(line => line.includes(name))).toBe(true)
  })

  it('同一探针读数变化不产生新指纹（原来 lag=28 与 lag=91 算两条）', () => {
    expect(errorFingerprint(probe('stream-lag', { lag: 28 }))).toBe(errorFingerprint(probe('stream-lag', { lag: 91 })))
  })

  it('真错误照旧落错误目录，同样不推送', () => {
    const errorDir = temp()
    const probeDir = temp()
    const result = ingestErrorReport({ dir: errorDir, probeDir, report: failure(), now: at() })
    expect(result.pushed).toBe(false)
    expect(readdirSync(errorDir)).toHaveLength(1)
    expect(readdirSync(probeDir)).toEqual([])
  })

  it('不传 probeDir 时探针退回错误目录，仍然不推送', () => {
    const errorDir = temp()
    const result = ingestErrorReport({ dir: errorDir, report: probe('stream-lag'), now: at() })
    expect(result.pushed).toBe(false)
    expect(readdirSync(errorDir)).toHaveLength(1)
  })
})
