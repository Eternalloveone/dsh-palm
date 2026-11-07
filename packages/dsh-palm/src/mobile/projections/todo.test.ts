/**
 * 计划折线的契约（W3-3 从 `messages.ts` 搬出来的一层）。
 *
 * 判据的核心是**宁可不动，也不要显示错的**：坏快照返回 undefined，调用方保留上一版；
 * 只有拿到能读懂的快照才更新计划条。
 */
import { describe, expect, it } from 'vitest'
import {
  foldTodoEvent,
  foldTodoSnapshot,
  latestTodoSnapshot,
  parseTodoList,
} from './todo.ts'
import type { WireEvent } from './types.ts'

/** 造一条最小事件（只填折线关心的字段）。 */
function event(type: string, data: unknown, seq = 1): WireEvent {
  return { type, data, seq, time: 1_700_000_000_000, id: `e${seq}` } as unknown as WireEvent
}

describe('parseTodoList', () => {
  it('读出条目与状态', () => {
    expect(parseTodoList({ todos: [{ content: '甲', status: 'pending' }, { content: '乙', status: 'completed' }] }))
      .toEqual([{ content: '甲', status: 'pending' }, { content: '乙', status: 'completed' }])
  })

  it('坏形状一律 undefined（不抛、不半截）', () => {
    expect(parseTodoList(undefined)).toBeUndefined()
    expect(parseTodoList('不是对象')).toBeUndefined()
    expect(parseTodoList({ todos: '不是数组' })).toBeUndefined()
    expect(parseTodoList({ todos: [null] })).toBeUndefined()
    expect(parseTodoList({ todos: [{ content: '甲' }] })).toBeUndefined()
  })

  it('不认识的状态算坏快照', () => {
    expect(parseTodoList({ todos: [{ content: '甲', status: 'doing' }] })).toBeUndefined()
  })

  it('空列表是合法快照（计划被清空）', () => {
    expect(parseTodoList({ todos: [] })).toEqual([])
  })
})

describe('foldTodoEvent / latestTodoSnapshot', () => {
  it('只有 plan 类事件参与折叠，其他事件不影响当前计划', () => {
    let state = foldTodoEvent(undefined, event('todo/write', { todos: [{ content: '甲', status: 'pending' }] }, 1))
    expect(state?.items).toHaveLength(1)
    state = foldTodoEvent(state, event('assistant/message', { text: '无关' }, 2))
    expect(state?.items).toHaveLength(1)
  })

  it('后面的快照覆盖前面的', () => {
    const events = [
      event('todo/write', { todos: [{ content: '甲', status: 'pending' }] }, 1),
      event('todo/write', { todos: [{ content: '甲', status: 'completed' }] }, 2),
    ]
    expect(latestTodoSnapshot(events)?.items[0]).toEqual({ content: '甲', status: 'completed' })
  })

  it('坏快照不覆盖上一版（这是这条折线存在的理由）', () => {
    const events = [
      event('todo/write', { todos: [{ content: '甲', status: 'pending' }] }, 1),
      event('todo/write', { todos: 'bad' }, 2),
    ]
    expect(latestTodoSnapshot(events)?.items[0]).toEqual({ content: '甲', status: 'pending' })
  })

  it('一条快照都没有时返回 undefined', () => {
    expect(latestTodoSnapshot([])).toBeUndefined()
    expect(foldTodoSnapshot([event('assistant/message', {}, 1)])).toBeUndefined()
  })
})
