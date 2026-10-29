/** 基线只做并集、静默只在「谁都没提到它」时才清 —— 两条都是手机上会立刻看见的病。 */
import { describe, expect, it } from 'vitest'
import { RUNNING_EVIDENCE_MAX_MS, mergeRunningBaseline, staleRunningEvidence } from './running-baseline.ts'

describe('mergeRunningBaseline', () => {
  it('keeps the frame-built set when the host roster comes back empty', () => {
    // 上游会话表的 running 字段恒 false：一次空基线不许把正在跑的会话抹掉。
    const current = new Set(['s-1'])
    expect(mergeRunningBaseline(current, [])).toEqual(['s-1'])
  })

  it('adds host sessions the frames never saw', () => {
    const current = new Set(['s-1'])
    expect(mergeRunningBaseline(current, ['s-2', 's-1', ''])).toEqual(['s-1', 's-2'])
  })
})

describe('staleRunningEvidence', () => {
  it('never drops a session the host still lists', () => {
    const evidence = new Map([['s-1', 0]])
    expect(staleRunningEvidence(evidence, new Set(['s-1']), RUNNING_EVIDENCE_MAX_MS * 2)).toEqual([])
  })

  it('drops a session nobody has mentioned for the whole window', () => {
    const evidence = new Map([['s-ghost', 0]])
    expect(staleRunningEvidence(evidence, new Set(), RUNNING_EVIDENCE_MAX_MS - 1)).toEqual([])
    expect(staleRunningEvidence(evidence, new Set(), RUNNING_EVIDENCE_MAX_MS)).toEqual(['s-ghost'])
  })
})
