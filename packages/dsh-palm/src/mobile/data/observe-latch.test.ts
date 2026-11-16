/**
 * 观测断言去重状态。
 *
 * 背景：`mobile.observe` 每发一次宿主就新建一个 follow 注册，而 App 的 effect 在路由
 * 变化时会重跑——实测启动阶段同一组参数连发两次。这份状态就是给那个 3 秒窗口用的。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { lastObserveAt, setLastObserveAt } from './observe-latch.ts'

describe('观测断言去重', () => {
  beforeEach(() => {
    setLastObserveAt(undefined)
  })

  it('初始没有记录（第一次观测一定发得出去）', () => {
    expect(lastObserveAt()).toBeUndefined()
  })

  it('写入后能读回 key 与时间戳', () => {
    setLastObserveAt({ key: '{"workspace":"w-1"}', at: 1234 })
    expect(lastObserveAt()).toEqual({ key: '{"workspace":"w-1"}', at: 1234 })
  })

  it('显式清空后回到未记录状态', () => {
    setLastObserveAt({ key: 'a', at: 1 })
    setLastObserveAt(undefined)
    expect(lastObserveAt()).toBeUndefined()
  })
})
