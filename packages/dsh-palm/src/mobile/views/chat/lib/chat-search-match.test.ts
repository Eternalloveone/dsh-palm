/**
 * 会话内搜索的行匹配判据（`ChatView` 拆出来的纯函数）。
 *
 * 每条用例都对应一次真机故障：计数在走画面不动、跳过去没有高亮、落在相邻短行上。
 */
import { describe, expect, it } from 'vitest'
import type { RenderMessage } from '../../../messages.ts'
import {
  alignHitIndex,
  normalizeSearchHits,
  richestRowOfSeq,
  rowCoversSeq,
  rowHasTerm,
  rowIndexOfHit,
  rowRendersAnyText,
  searchRowsOf,
} from './chat-search-match.ts'

/** 造一行（只填判据关心的字段）。 */
function row(overrides: Partial<RenderMessage> & { id: string }): RenderMessage {
  return {
    kind: 'assistant',
    text: '',
    seq: 0,
    time: 0,
    ...overrides,
  } as RenderMessage
}

describe('rowHasTerm', () => {
  it('空词一律算命中（没在搜的时候不该拦）', () => {
    expect(rowHasTerm(row({ id: 'a', text: '随便' }), '')).toBe(true)
  })

  it('正文、索引原文、flow 里的正文任一处有就算命中', () => {
    expect(rowHasTerm(row({ id: 'a', text: '缓存没命中' }), '缓存')).toBe(true)
    expect(rowHasTerm(row({ id: 'b', text: '', searchText: '索引里的原文' }), '索引')).toBe(true)
    expect(rowHasTerm(row({
      id: 'c',
      text: '',
      flow: [{ kind: 'text', text: '工具步骤里的正文', seq: 3 }],
    } as Partial<RenderMessage> & { id: string }), '工具步骤')).toBe(true)
  })

  it('都没有就没命中', () => {
    expect(rowHasTerm(row({ id: 'a', text: '别的内容' }), '缓存')).toBe(false)
  })
})

describe('rowCoversSeq', () => {
  it('优先认 flow 里正文段自己的 seq（合并行的水位 seq 不算）', () => {
    const merged = row({
      id: 'a',
      seq: 1057,                                  // 这一轮的水位
      flow: [{ kind: 'text', text: '第九轮答案', seq: 766 }],
    } as Partial<RenderMessage> & { id: string })
    expect(rowCoversSeq(merged, 766)).toBe(true)
    // 真机故障：命中 1057 被认成这张只有 766 正文的卡
    expect(rowCoversSeq(merged, 1057)).toBe(false)
  })

  it('没有 flow 正文段时退回 stepSeqs', () => {
    const r = row({ id: 'a', seq: 10, stepSeqs: [7, 8] } as Partial<RenderMessage> & { id: string })
    expect(rowCoversSeq(r, 7)).toBe(true)
    expect(rowCoversSeq(r, 9)).toBe(false)
  })

  it('两者都没有时用 startSeq..seq 区间', () => {
    const r = row({ id: 'a', seq: 10, startSeq: 5 } as Partial<RenderMessage> & { id: string })
    expect(rowCoversSeq(r, 6)).toBe(true)
    expect(rowCoversSeq(r, 11)).toBe(false)
  })
})

describe('rowRendersAnyText', () => {
  it('只有空白/只有工具调用、推理的行不能当落点', () => {
    expect(rowRendersAnyText(row({ id: 'a', text: '   ' }))).toBe(false)
    expect(rowRendersAnyText(row({
      id: 'b',
      text: '',
      flow: [{ kind: 'tool', text: '' }],
    } as unknown as Partial<RenderMessage> & { id: string }))).toBe(false)
    expect(rowRendersAnyText(row({ id: 'c', text: '有正文' }))).toBe(true)
  })
})

describe('richestRowOfSeq', () => {
  it('同 seq 多行时取正文最长的那行（短行跳过去等于跳空白）', () => {
    const list = [
      row({ id: 'short', seq: 5, text: '短' }),
      row({ id: 'long', seq: 5, text: '这一行明显更长一些的正文' }),
      row({ id: 'other', seq: 6, text: '别的行' }),
    ]
    expect(richestRowOfSeq(list, 5)).toBe(1)
    expect(richestRowOfSeq(list, 99)).toBe(-1)
  })
})

describe('rowIndexOfHit', () => {
  it('索引给了 messageId 且屏幕上有这一行：按身份落', () => {
    const list = [row({ id: 'a', seq: 1 }), row({ id: 'target', seq: 2, text: '这一行就是命中' })]
    expect(rowIndexOfHit(list, { seq: 2, messageId: 'target' })).toBe(1)
  })

  it('没有 id 时用 8 字短锚点找（markdown 剥掉符号也不怕）', () => {
    const text = '这是一段会被 markdown 剥掉符号的长正文，中间夹着关键短语'
    const list = [row({ id: 'a', seq: 1, text: '无关' }), row({ id: 'b', seq: 2, text })]
    expect(rowIndexOfHit(list, { seq: 2, snippet: `…${text.slice(4, 20)}…` })).toBe(1)
  })

  it('都认不到时退回"正文最长的那行"，而不是 -1', () => {
    const list = [
      row({ id: 'short', seq: 5, text: '短' }),
      row({ id: 'long', seq: 5, text: '长得多的一行正文' }),
    ]
    expect(rowIndexOfHit(list, { seq: 5 })).toBe(1)
  })
})

describe('searchRowsOf', () => {
  it('把 flow 里的正文拼进可搜文本（工具步骤行的 text 是空的）', () => {
    const [view] = searchRowsOf([row({
      id: 'a',
      seq: 3,
      text: '',
      flow: [{ kind: 'text', text: '步骤正文', seq: 3 }],
    } as Partial<RenderMessage> & { id: string })])
    // 原文行为是 `text + '\n' + flowText`：text 空串时开头会多一个换行，
    // 对匹配没有影响，但它确实是现有口径，先照着钉住（要改就显式改）。
    expect(view?.text).toBe('\n步骤正文')
  })

  it('宿主给了 searchText 就用它（与索引同一份口径）', () => {
    const [view] = searchRowsOf([row({ id: 'a', seq: 1, text: '渲染后的', searchText: '索引里的原文' } as Partial<RenderMessage> & { id: string })])
    expect(view?.text).toBe('索引里的原文')
  })
})
describe('normalizeSearchHits', () => {
  it('丢掉没有 seq 的条目，并按 seq 升序', () => {
    expect(normalizeSearchHits([{ seq: 5, snippet: 'b' }, { snippet: '无 seq' }, { seq: 2, snippet: 'a' }]))
      .toEqual([{ seq: 2, snippet: 'a' }, { seq: 5, snippet: 'b' }])
  })

  it('同一条消息同一段只留一处（否则计数器在走、位置不动）', () => {
    const hits = normalizeSearchHits([
      { seq: 3, messageId: 'm1', partId: 'p1', snippet: '第一处' },
      { seq: 3, messageId: 'm1', partId: 'p1', snippet: '重复行' },
      { seq: 4, messageId: 'm1', partId: 'p2', snippet: '另一段' },
    ])
    expect(hits.map(hit => hit.snippet)).toEqual(['第一处', '另一段'])
  })

  it('没有 messageId 时按 seq 认同一处', () => {
    const hits = normalizeSearchHits([{ seq: 7, snippet: 'a' }, { seq: 7, snippet: 'b' }])
    expect(hits).toHaveLength(1)
  })

  it('空输入给空数组', () => {
    expect(normalizeSearchHits([])).toEqual([])
  })
})

describe('alignHitIndex', () => {
  const hits = [
    { seq: 10, snippet: 'a', messageId: 'm1' },
    { seq: 20, snippet: 'b', messageId: 'm2' },
    { seq: 30, snippet: 'c', messageId: 'm3' },
  ]

  it('按 messageId 精确对齐（不能把用户从他点的那处拽走）', () => {
    expect(alignHitIndex(hits, { query: '词', messageId: 'm2' }, '词')).toBe(1)
  })

  it('没有 messageId 时按 seq 往后找第一处', () => {
    expect(alignHitIndex(hits, { query: '词', seq: 21 }, '词')).toBe(2)
  })

  it('意图与当前查询词无关时返回 -1（调用方自己归 0）', () => {
    expect(alignHitIndex(hits, { query: '别的词', messageId: 'm2' }, '词')).toBe(-1)
    expect(alignHitIndex(hits, undefined, '词')).toBe(-1)
  })

  it('有意图但没有命中时返回 -1', () => {
    expect(alignHitIndex([], { query: '词', seq: 1 }, '词')).toBe(-1)
  })
})
