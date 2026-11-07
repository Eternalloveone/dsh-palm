import { describe, expect, it } from 'vitest'
import {
  DUPLICATE_REPORT_GAP_MS,
  findDuplicateCards,
  reportDuplicateCards,
  resetDuplicateReporterForTest,
} from './duplicate-report.ts'

// 两行的 seq 必须不同：真机上每条消息的 seq 唯一，用同一个 seq 造数据会触发
// 「区间重叠」这条强判据，把无关用例也判成重复。
const row = (patch: Record<string, unknown>) => ({
  id: 'r-1',
  kind: 'assistant',
  seq: 10,
  time: 1,
  text: '',
  ...patch,
}) as never

const LONG_TEXT = '这一段正文足够长，用来判断「同一轮说了两次同样的话」这种情况。'

describe('同一轮多张过程卡的现场取证', () => {
  it('同轮同文算重复', () => {
    const pairs = findDuplicateCards([
      row({ id: 'a', turn: 7, step: 1, seq: 10, text: LONG_TEXT }),
      row({ id: 'b', turn: 7, step: 2, seq: 20, text: LONG_TEXT }),
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.reason).toBe('same-turn-same-text')
  })

  it('同一次工具调用出现在两行 —— 不管轮号，都算重复', () => {
    const pairs = findDuplicateCards([
      row({ id: 'a', turn: 7, step: 1, seq: 10, text: '甲', tools: [{ callId: 'c1' }] }),
      row({ id: 'b', turn: undefined, step: undefined, seq: 30, text: '乙', tools: [{ callId: 'c1' }] }),
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.reason).toBe('shared-tool')
  })

  it('seq 区间重叠 —— 页面快照行与实时流行各画一份，算重复', () => {
    const pairs = findDuplicateCards([
      row({ id: 'a', turn: 7, step: 3, seq: 40, startSeq: 38, text: '甲' }),
      row({ id: 'b', turn: undefined, step: undefined, seq: 42, startSeq: 38, text: '乙' }),
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.reason).toBe('overlapping-seq')
  })

  it('不同轮说同样的话不算重复（正常内容）', () => {
    const pairs = findDuplicateCards([
      row({ id: 'a', turn: 7, step: 1, seq: 10, text: LONG_TEXT }),
      row({ id: 'b', turn: 8, step: 1, seq: 20, text: LONG_TEXT }),
    ])
    expect(pairs).toHaveLength(0)
  })

  it('同轮、正文短、工具不同、seq 不重叠 → 不算重复（多步正常合并就是这形状）', () => {
    const pairs = findDuplicateCards([
      row({ id: 'a', turn: 7, step: 1, seq: 10, text: '好', tools: [{ callId: 'c1' }] }),
      row({ id: 'b', turn: 7, step: 2, seq: 20, text: '继续', tools: [{ callId: 'c2' }] }),
    ])
    expect(pairs).toHaveLength(0)
  })

  it('同一会话 1 分钟内只上报一次', () => {
    resetDuplicateReporterForTest()
    const sent: unknown[] = []
    const rows = [
      row({ id: 'a', turn: 7, step: 1, seq: 10, text: LONG_TEXT }),
      row({ id: 'b', turn: 7, step: 2, seq: 20, text: LONG_TEXT }),
    ]
    const sink = (report: unknown): void => { sent.push(report) }
    reportDuplicateCards('s-1', rows, sink, 100_000)
    reportDuplicateCards('s-1', rows, sink, 100_000 + DUPLICATE_REPORT_GAP_MS - 1)
    expect(sent).toHaveLength(1)
    reportDuplicateCards('s-1', rows, sink, 100_000 + DUPLICATE_REPORT_GAP_MS + 1)
    expect(sent).toHaveLength(2)
  })
})
