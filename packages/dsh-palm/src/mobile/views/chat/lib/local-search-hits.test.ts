/**
 * 会话内搜索的本地口径（屏幕上有几处就数几处）。
 *
 * 每条用例都对应一次真机偏差：「1/2 却有 4 个高亮」「代码里的词也算进来」
 * 「思考/过程里的词进了计数，数字在动画面不跳」「自动跳回最早一处」。
 */
import { describe, expect, it } from 'vitest'
import type { RenderMessage } from '../../../render/messages.ts'
import {
  alignLocalHitIndex,
  countTermIn,
  localSearchHits,
  nearestLocalHitIndex,
  olderHitIndex,
} from './local-search-hits.ts'
import { searchTermPattern } from '../../../render/markdown-text.tsx'

function row(overrides: Partial<RenderMessage> & { id: string }): RenderMessage {
  return {
    kind: 'assistant',
    text: '',
    seq: 0,
    time: 0,
    ...overrides,
  } as RenderMessage
}

describe('localSearchHits', () => {
  it('一段里出现 4 次就数 4 处（宿主只回 1 条消息，屏幕上是 4 个高亮）', () => {
    const report = row({ id: 'a-10', seq: 10, text: '版本号写在标题里\n\n仓库与版本\n\n| 版本 | 状态 |\n\n最终版本：2.0.0' })
    const hits = localSearchHits([report], '版本')
    expect(hits).toHaveLength(4)
    expect(hits.map(hit => hit.occurrence)).toEqual([0, 1, 2, 3])
    expect(hits.every(hit => hit.rowId === 'a-10')).toBe(true)
  })

  it('按屏幕顺序：先按行、行内按正文先后', () => {
    const list = [
      row({ id: 'u-1', kind: 'user', seq: 1, text: '第一处支付' }),
      row({ id: 'a-2', seq: 2, text: '第二处支付，还有第三处支付' }),
    ]
    const hits = localSearchHits(list, '支付')
    expect(hits.map(hit => `${hit.rowId}:${hit.occurrence}`)).toEqual(['u-1:0', 'a-2:0', 'a-2:1'])
  })

  it('代码围栏里的词不算（渲染器不标它，算了序号就会错位）', () => {
    const list = [row({ id: 'a-1', seq: 1, text: '可见支付\n\n```txt\n支付\n支付\n```\n\n结尾支付' })]
    const hits = localSearchHits(list, '支付')
    expect(hits).toHaveLength(2)
  })

  it('思考链里的词不算（索引不入库、屏幕也不高亮）', () => {
    const list = [row({
      id: 'a-2',
      seq: 2,
      text: '已完成修改',
      reasoning: '先看支付这段要不要改',
    })]
    expect(localSearchHits(list, '支付')).toEqual([])
  })

  it('多步回合：只数最后一步（答案），前面各步的过程正文不算', () => {
    const list = [row({
      id: 'a-3',
      seq: 30,
      text: '',
      stepSeqs: [10, 30],
      stepTexts: ['过程里提到支付一次', '最终结论提到支付两次'],
    })]
    const hits = localSearchHits(list, '支付')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.rowSeq).toBe(30)
  })

  it('过程行（工具/系统/无答案助手）整行不算', () => {
    const list = [
      row({ id: 't-1', kind: 'turn', seq: 1, text: '工具输出里写着支付' }),
      row({ id: 'c-1', kind: 'command', seq: 2, text: '/run 支付脚本' }),
      // 多步回合但最后一步没有正文：只有过程，没有结论 → 不算（屏幕上也没有答案区）。
      row({ id: 'a-4', seq: 3, text: '', stepSeqs: [1, 3], stepTexts: ['过程里提到支付', ''] }),
    ]
    expect(localSearchHits(list, '支付')).toEqual([])
  })

  it('空词 / 空列表给空数组', () => {
    expect(localSearchHits([row({ id: 'a', seq: 1, text: '支付' })], '   ')).toEqual([])
    expect(localSearchHits([], '支付')).toEqual([])
  })

  it('计数用和高亮同一份规则：大小写不敏感、按空白拆词', () => {
    const pattern = searchTermPattern('DP534 支付')!
    expect(countTermIn('dp534 与 支付 都算', pattern)).toBe(2)
    expect(countTermIn('没有那个词', pattern)).toBe(0)
  })
})

describe('nearestLocalHitIndex', () => {
  const hits = [
    { rowId: 'a-1', rowSeq: 1, rowIndex: 0, occurrence: 0 },
    { rowId: 'a-2', rowSeq: 2, rowIndex: 1, occurrence: 0 },
    { rowId: 'a-3', rowSeq: 3, rowIndex: 2, occurrence: 0 },
  ]

  it('没有几何信息时取第一处（jsdom / 刚渲染）', () => {
    expect(nearestLocalHitIndex(hits)).toBe(0)
  })

  it('几何退化（所有 top 相同）时也取第一处，不落到最后一处', () => {
    expect(nearestLocalHitIndex(hits, { topOf: () => 0, anchor: 300 })).toBe(0)
  })

  it('优先落在视口锚点下方的最近一处（不再回最早一处）', () => {
    const tops: Record<string, number> = { 'a-1': -800, 'a-2': 100, 'a-3': 900 }
    expect(nearestLocalHitIndex(hits, { topOf: id => tops[id], anchor: 300 })).toBe(2)
  })

  it('锚点下方没有命中时取最后一处（上方最近）', () => {
    const tops: Record<string, number> = { 'a-1': -800, 'a-2': 100, 'a-3': 200 }
    expect(nearestLocalHitIndex(hits, { topOf: id => tops[id], anchor: 300 })).toBe(2)
  })

  it('没有命中给 -1', () => {
    expect(nearestLocalHitIndex([], {})).toBe(-1)
  })
})

describe('olderHitIndex', () => {
  it('取比首行更早、且 seq 最大的那一处（翻一页就能到）', () => {
    const rows = [row({ id: 'a-9', seq: 90, text: '窗口首行' })]
    const hits = [{ seq: 10 }, { seq: 70 }, { seq: 50 }, { seq: 90 }]
    expect(olderHitIndex(hits, rows)).toBe(1)
  })

  it('没有更早的命中给 -1', () => {
    expect(olderHitIndex([{ seq: 90 }], [row({ id: 'a-9', seq: 90 })])).toBe(-1)
  })
})

describe('alignLocalHitIndex', () => {
  const hits = [
    { rowId: 'a-10', rowSeq: 10, rowIndex: 0, occurrence: 0 },
    { rowId: 'a-20', rowSeq: 20, rowIndex: 1, occurrence: 0 },
  ]

  it('按 intent 的 messageId 精确对齐（不能把用户从他点的那处拽走）', () => {
    expect(alignLocalHitIndex(hits, { query: '支付', messageId: 'a-20' }, '支付')).toBe(1)
  })

  it('没有 messageId 时按 seq 往后找第一处', () => {
    expect(alignLocalHitIndex(hits, { query: '支付', seq: 11 }, '支付')).toBe(1)
  })

  it('词不一致 / 没有命中时给 -1', () => {
    expect(alignLocalHitIndex(hits, { query: '别的词' }, '支付')).toBe(-1)
    expect(alignLocalHitIndex([], { query: '支付' }, '支付')).toBe(-1)
  })
})
