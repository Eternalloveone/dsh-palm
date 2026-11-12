/**
 * 定位锚点解析的测试。
 *
 * 这里钉住的是**优先级契约**：messageId 命中后不许被 seq/关键词否决；
 * turn/step 是合并后的第二道锚点；关键词只在最后兜底。
 */
import { describe, expect, it } from 'vitest'
import { buildRowIndex, findRow, findRowByQuery, intentToAnchor, type IndexableRow } from './locate-anchor.ts'

const rows = (specs: Array<Partial<IndexableRow> & { id: string; text: string }>): IndexableRow[] =>
  specs.map(spec => ({ ...spec }))

describe('intentToAnchor：用什么去找', () => {
  it('有 messageId 就用它，即使同时有 seq/turn', () => {
    expect(intentToAnchor({ messageId: 'm-1', seq: 42, turn: 3 })).toEqual({ kind: 'message', id: 'm-1' })
  })

  it('没有 messageId 时用 turn/step（合并后唯一还站得住的坐标）', () => {
    expect(intentToAnchor({ seq: 42, turn: 12, step: 3 })).toEqual({ kind: 'turn-step', turn: 12, step: 3 })
  })

  it('只有轮、没有步：仍按轮找', () => {
    expect(intentToAnchor({ turn: 7 })).toEqual({ kind: 'turn-step', turn: 7 })
  })

  it('只有 seq 时用 seq', () => {
    expect(intentToAnchor({ seq: 99 })).toEqual({ kind: 'seq', seq: 99 })
  })

  it('什么坐标都没有、只有关键词：退到 query', () => {
    expect(intentToAnchor({ query: ' 排队 ' })).toEqual({ kind: 'query', term: '排队' })
  })

  it('空意图返回 undefined（调用方按普通打开处理）', () => {
    expect(intentToAnchor({})).toBeUndefined()
    expect(intentToAnchor({ messageId: '', query: '   ' })).toBeUndefined()
  })
})

describe('buildRowIndex / findRow：查表寻路', () => {
  const list = rows([
    { id: 'u-1', text: '第一条', turn: 1, step: 1 },
    { id: 'a-1', text: '回答一', turn: 1, step: 2 },
    { id: 'u-2', text: '第二条 排队', turn: 2, step: 1 },
    { id: 'a-2', text: '回答二', turn: 2, step: 2 },
  ])

  it('messageId 直接命中', () => {
    expect(findRow(buildRowIndex(list), { kind: 'message', id: 'u-2' })).toBe(2)
  })

  it('turn:step 命中（messageId 对不上时靠它）', () => {
    expect(findRow(buildRowIndex(list), { kind: 'turn-step', turn: 2, step: 2 })).toBe(3)
  })

  it('有轮无步：落到该轮第一行', () => {
    expect(findRow(buildRowIndex(list), { kind: 'turn-step', turn: 2 })).toBe(2)
  })

  it('步对不上时退回该轮第一行，不返回 -1', () => {
    expect(findRow(buildRowIndex(list), { kind: 'turn-step', turn: 1, step: 9 })).toBe(0)
  })

  it('查不到返回 -1（调用方要当「继续找」，不是「失败」）', () => {
    expect(findRow(buildRowIndex(list), { kind: 'message', id: 'nope' })).toBe(-1)
    expect(findRow(buildRowIndex(list), { kind: 'turn-step', turn: 99 })).toBe(-1)
  })

  it('重复 id 取第一次出现（折叠行可能重复携带同一 id）', () => {
    const dup = rows([
      { id: 'x', text: 'a' },
      { id: 'x', text: 'b' },
    ])
    expect(findRow(buildRowIndex(dup), { kind: 'message', id: 'x' })).toBe(0)
  })
})

describe('findRowByQuery：只作最后兜底', () => {
  const list = rows([
    { id: 'a', text: '无关内容' },
    { id: 'b', text: '这里有排队消息' },
  ])

  it('按关键词找到行', () => {
    expect(findRowByQuery(list, '排队')).toBe(1)
  })

  it('大小写不敏感', () => {
    expect(findRowByQuery(rows([{ id: 'a', text: 'Queue is full' }]), 'queue')).toBe(0)
  })

  it('空词或找不到都返回 -1', () => {
    expect(findRowByQuery(list, '  ')).toBe(-1)
    expect(findRowByQuery(list, '不存在')).toBe(-1)
  })
})
