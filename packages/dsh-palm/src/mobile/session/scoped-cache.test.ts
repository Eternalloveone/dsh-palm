// @vitest-environment node
/**
 * 会话分槽仓库（`createScopedStore`）的契约。
 *
 * 这张表是"进会话第一帧直接用上次画面"的基础设施，同时是**跨会话串味**的第一道门：
 * 一旦淘汰/覆盖写错，上一场的数据就会在下一场被读到（真机 2026-11-14 的幽灵交付卡）。
 * 所以它的语义要单独钉住，而不是只靠上层用例间接覆盖。
 */
import { describe, expect, it } from 'vitest'
import { createScopedStore } from './chat-snapshot.ts'

describe('createScopedStore', () => {
  it('按会话各存一格，互不覆盖', () => {
    const store = createScopedStore<number[]>(4)
    store.set('a', [1])
    store.set('b', [2])
    expect(store.get('a')).toEqual([1])
    expect(store.get('b')).toEqual([2])
    expect(store.get('c')).toBeUndefined()
  })

  it('超过上限淘汰最久没写过的，而不是刚写的那个', () => {
    const store = createScopedStore<number>(2)
    store.set('a', 1)
    store.set('b', 2)
    store.set('c', 3)
    expect(store.get('a')).toBeUndefined()
    expect(store.get('b')).toBe(2)
    expect(store.get('c')).toBe(3)
    expect(store.size()).toBe(2)
  })

  it('重写同一个会话会把它挪到最近使用（不会被下一次淘汰带走）', () => {
    const store = createScopedStore<number>(2)
    store.set('a', 1)
    store.set('b', 2)
    store.set('a', 10)
    store.set('c', 3)
    expect(store.get('a')).toBe(10)
    expect(store.get('b')).toBeUndefined()
    expect(store.get('c')).toBe(3)
  })

  it('delete / clear 之后读不到旧值', () => {
    const store = createScopedStore<string>(4)
    store.set('a', 'x')
    store.delete('a')
    expect(store.get('a')).toBeUndefined()
    store.set('a', 'x')
    store.clear()
    expect(store.get('a')).toBeUndefined()
    expect(store.size()).toBe(0)
  })
})
