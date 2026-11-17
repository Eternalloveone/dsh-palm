/**
 * 卡与正文成对保留（2026-11-16 真机：冷启动后一屏 6 张过程条，其中 4 张没有正文）。
 *
 * 现场证据：那 4 行 DOM 文本只有「成了 7分57秒 51 次工具调用 改 10 个文件 · 运行命令 …」，
 * 而宿主侧同一轮最后一行有 1500+ 字正文。也就是说 `keepTurnReports` 只把卡带了过来，
 * 正文行留在了窗口外 —— 屏幕上一摞孤卡。
 */
import { describe, expect, it } from 'vitest'
import { KEEP_ORPHAN_REPORT_TURNS, keepTurnReports } from './messages.ts'
import type { RenderMessage } from '../projections/types.ts'

/** 一轮的过程行（正文可选）。 */
function assistant(turn: number, text: string, seq = turn * 100): RenderMessage {
  return { kind: 'assistant', id: `a-${turn}-${seq}`, turn, step: 1, text, seq, startSeq: turn * 100, tools: [] } as unknown as RenderMessage
}

/** 一轮的过程条 / 交付卡。 */
function card(turn: number, seq = turn * 100 + 99): RenderMessage {
  return {
    kind: 'turn',
    id: `turn-tail:${turn}`,
    turn,
    seq,
    text: '',
    deliverables: [{ path: 'x.md', title: 'x' }],
  } as unknown as RenderMessage
}

describe('keepTurnReports：卡必须和正文成对', () => {
  it('页里该轮有正文 → 卡留下，并紧跟正文那一行', () => {
    const next = [assistant(7, '第七轮的正文'), assistant(8, '第八轮的正文')]
    const out = keepTurnReports([card(7), card(8)], next)
    const ids = out.map(row => row.id)
    expect(ids).toContain('turn-tail:7')
    expect(ids.indexOf('turn-tail:7')).toBe(ids.indexOf('a-7-700') + 1)
  })

  it('页里该轮只有空正文的过程行 → 卡不留下（这就是孤卡来源）', () => {
    // 入口页只给十几个事件：该轮只剩一条 text 为空的过程行。
    const next = [assistant(7, ''), assistant(8, '第八轮的正文')]
    const out = keepTurnReports([card(7)], next)
    expect(out.some(row => row.id === 'turn-tail:7')).toBe(false)
    expect(out.filter(row => row.id.startsWith('turn-tail:'))).toHaveLength(0)
  })

  it('页里完全没该轮、上一帧有正文 → 卡和正文一起回来，正文在列表最前', () => {
    const previous = [assistant(6, '第六轮的正文'), card(6), assistant(7, '第七轮的正文')]
    const next = [assistant(7, '第七轮的正文')]
    const out = keepTurnReports(previous, next)
    const ids = out.map(row => row.id)
    expect(ids[0]).toBe('a-6-600')
    expect(ids).toContain('turn-tail:6')
    expect(ids.indexOf('turn-tail:6')).toBe(1)
  })

  it('上一帧也只有卡（正文哪一帧都没有）→ 卡不留', () => {
    const out = keepTurnReports([card(6)], [assistant(7, '第七轮的正文')])
    expect(out.some(row => row.id === 'turn-tail:6')).toBe(false)
  })

  it('超出最近 N 轮的更早卡不回来', () => {
    const far = 7 - KEEP_ORPHAN_REPORT_TURNS - 1
    const previous = [assistant(far, '很早的正文'), card(far)]
    const out = keepTurnReports(previous, [assistant(7, '第七轮的正文')])
    expect(out.some(row => row.id === `turn-tail:${far}`)).toBe(false)
    expect(out.some(row => row.id === `a-${far}-${far * 100}`)).toBe(false)
  })

  it('没有可带的卡时原样返回（不额外插正文行）', () => {
    const next = [assistant(7, '第七轮的正文')]
    expect(keepTurnReports([], next).map(row => row.id)).toEqual(['a-7-700'])
  })
})
