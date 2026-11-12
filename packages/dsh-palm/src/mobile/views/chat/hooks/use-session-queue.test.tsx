// @vitest-environment jsdom
/**
 * 队列视图＝会话仓的只读投影（W3-6 第一步）。
 *
 * 以前 ChatView 用 `useState<QueueItemView[]>` 存一份队列，再靠订阅把仓里的
 * `queueView()` 抄过来 —— 同一份事实两个所有者：任何一处漏抄就出现"删了还在 /
 * 已发送还挂着"的老毛病。现在视图只订阅仓的**版本号**，版本变了才重算
 * `queueView()`，视图里没有可以漂移的第二份。
 *
 * 这里钉住视图侧的四条：跟着仓变、按会话隔离、冷启动回退、重订阅清空。
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useSessionQueue } from './use-session-queue.ts'
import {
  applyQueueItems,
  rebaselineQueueView,
  resetSessionStoreForTest,
  type queueView,
} from '../../../stream/session-store.ts'

const SESSION = 's-1'

/** 排队项的最小形状（从 queueView 的返回值取，避免 views→api 的配额）。 */
type QueueItem = ReturnType<typeof queueView>[number]

function item(id: string, text: string): QueueItem {
  return { id, placement: 'queued', text, editable: true }
}

beforeEach(() => {
  resetSessionStoreForTest()
})

afterEach(() => {
  cleanup()
})

describe('useSessionQueue', () => {
  it('读的是仓里的权威队列', () => {
    applyQueueItems(SESSION, [item('q1', '第一条')])
    const { result } = renderHook(() => useSessionQueue(SESSION))
    expect(result.current.map(row => row.id)).toEqual(['q1'])
  })

  it('仓变了视图跟着变（视图里没有第二份副本）', () => {
    const { result } = renderHook(() => useSessionQueue(SESSION))
    expect(result.current).toEqual([])
    act(() => { applyQueueItems(SESSION, [item('q1', '第一条')]) })
    expect(result.current.map(row => row.id)).toEqual(['q1'])
    act(() => { applyQueueItems(SESSION, []) })
    expect(result.current).toEqual([])
  })

  it('按会话隔离：别的会话写队列不影响这里', () => {
    applyQueueItems('s-2', [item('q9', '别处的')])
    const { result } = renderHook(() => useSessionQueue(SESSION))
    expect(result.current).toEqual([])
  })

  it('冷启动回退：仓里还没有这一场时用 mux 缓存，仓一有数据就换掉它', () => {
    const fallback = (): QueueItem[] => [item('m1', '缓存里的一条')]
    const { result } = renderHook(() => useSessionQueue(SESSION, fallback))
    expect(result.current.map(row => row.id)).toEqual(['m1'])
    act(() => { applyQueueItems(SESSION, [item('q1', '宿主的')]) })
    expect(result.current.map(row => row.id)).toEqual(['q1'])
  })

  it('重订阅基线：旧队列立刻不画，新帧到了再回来', () => {
    applyQueueItems(SESSION, [item('q1', '旧连接里的')])
    const { result } = renderHook(() => useSessionQueue(SESSION))
    expect(result.current.map(row => row.id)).toEqual(['q1'])
    act(() => { rebaselineQueueView(SESSION) })
    expect(result.current).toEqual([])
    act(() => { applyQueueItems(SESSION, [item('q2', '新连接里的')]) })
    expect(result.current.map(row => row.id)).toEqual(['q2'])
  })
})
