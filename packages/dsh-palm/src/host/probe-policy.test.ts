import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { errorFingerprint, ingestErrorReport, isEvidenceOnly } from './error-report.ts'
import { probeLogFile } from './probe-log.ts'

const temp = (): string => mkdtempSync(join(tmpdir(), 'palm-policy-'))
const at = (): number => new Date(2026, 10, 16, 12, 0, 0).getTime()
const probe = (name: string, detail: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'error', message: `${name} lag=28 localSeq=3703`, count: 1, probe: name, at: at(), ...detail,
})
const failure = (): Record<string, unknown> => ({ kind: 'error', message: 'boom', count: 1, at: at() })

describe('探针与告警分流（2026-11-16：探针不再弹「手机端出错」）', () => {
  it('证据类探针默认不推送（含自愈两步与帧刷新）', () => {
    expect(isEvidenceOnly(probe('stream-lag'))).toBe(true)
    expect(isEvidenceOnly(probe('tail-reload-stall'))).toBe(true)
    expect(isEvidenceOnly(probe('tail-reload-failed'))).toBe(true)
    expect(isEvidenceOnly(probe('flush-stall'))).toBe(true)
  })

  it('用户真的丢了东西的两个探针仍在告警白名单', () => {
    expect(isEvidenceOnly(probe('send-no-echo'))).toBe(false)
    expect(isEvidenceOnly(probe('turn-duplicate'))).toBe(false)
  })

  it('真错误不因为带 probeDir 而被降级', () => {
    expect(isEvidenceOnly(failure())).toBe(false)
  })

  it('探针写 probe 日志，错误目录为空，返回值 pushed=false', () => {
    const errorDir = temp()
    const probeDir = temp()
    const pushed: unknown[] = []
    const result = ingestErrorReport({
      dir: errorDir, probeDir, report: probe('stream-lag'), notify: undefined, now: at(),
      push: () => { pushed.push(1) },
    })
    expect(result.pushed).toBe(false)
    expect(pushed).toHaveLength(0)
    expect(readdirSync(errorDir)).toEqual([])
    expect(readFileSync(result.file, 'utf8')).toContain('stream-lag')
  })

  it('同一探针读数变化不产生新指纹（原来 lag=28 与 lag=91 算两条）', () => {
    expect(errorFingerprint(probe('stream-lag', { lag: 28 }))).toBe(errorFingerprint(probe('stream-lag', { lag: 91 })))
  })

  it('白名单探针带 probeDir 也照样推送，并且不写进探针日志', () => {
    const errorDir = temp()
    const probeDir = temp()
    const pushed: unknown[] = []
    const result = ingestErrorReport({
      dir: errorDir, probeDir, report: probe('send-no-echo'), notify: undefined, now: at(),
      push: (_n, _r, fingerprint) => { pushed.push(fingerprint) },
    })
    expect(result.pushed).toBe(true)
    expect(pushed).toHaveLength(1)
    expect(readdirSync(probeDir)).toEqual([])
    expect(readdirSync(errorDir)).toHaveLength(1)
  })

  it('不传 probeDir 时退回旧行为：探针落错误目录但不推送', () => {
    const errorDir = temp()
    const result = ingestErrorReport({
      dir: errorDir, report: probe('stream-lag'), notify: undefined, now: at(), push: () => { throw new Error('不该推送') },
    })
    expect(result.pushed).toBe(false)
    expect(readdirSync(errorDir)).toHaveLength(1)
  })
})
