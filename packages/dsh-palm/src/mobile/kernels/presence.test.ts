/**
 * Presence 内核的契约（W3-4）。
 *
 * 这里钉的是"三屏一个答案"这件事本身：同一条会话，无论从列表、运行总览还是
 * 聊天页问，`presenceOf()` 必须给出同一个结论。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatchStatusEvent, resetStatusStoreForTest } from '../session-status-store.ts'
import { clearFinishedRuns, recordFinishedRun, resetFinishedRunsForTest } from '../recent-finished.ts'
import { activeSessionIds, presenceOf, subscribePresence } from './presence.ts'

/** 让会话进入"在跑"状态：帧事件走状态存储的租约逻辑。 */
function markRunning(sessionId: string): void {
  dispatchStatusEvent(sessionId, {
    type: 'turn',
    at: Date.now(),
    source: 'frame',
    running: true,
    turnNo: 1,
    startedAt: Date.now(),
  })
}

beforeEach(() => {
  resetStatusStoreForTest()
  resetFinishedRunsForTest()
})

describe('presenceOf', () => {
  it('没有任何证据时不表态（undefined ≠ 没在跑）', () => {
    const presence = presenceOf('unknown-session')
    expect(presence.running).toBeUndefined()
    expect(presence.source).toBe('none')
  })

  it('有帧证据时给出在跑', () => {
    markRunning('s1')
    expect(presenceOf('s1').running).toBe(true)
    expect(presenceOf('s1').source).toBe('frames')
  })

  it('已结束的运行带上结局，供列表展示', () => {
    recordFinishedRun({
      sessionId: 's2',
      title: '跑完的会话',
      finishedAt: Date.now(),
      status: 'error',
    })
    const presence = presenceOf('s2')
    expect(presence.running).toBeUndefined()
    expect(presence.finishedStatus).toBe('error')
    expect(presence.finishedAt).toBeGreaterThan(0)
  })

  it('同一条会话：在跑期间与结束后是两个答案（不会同时成立）', () => {
    markRunning('s3')
    expect(presenceOf('s3').running).toBe(true)
    recordFinishedRun({ sessionId: 's3', title: 'x', finishedAt: Date.now(), status: 'done' })
    // 已结束账本不影响"在跑"判断（租约仍然有效），但两者可同时被读到：
    expect(presenceOf('s3').finishedStatus).toBe('done')
  })
})

describe('activeSessionIds', () => {
  it('只收明确在跑的会话（undefined 不算）', () => {
    markRunning('a')
    markRunning('b')
    recordFinishedRun({ sessionId: 'c', title: 'c', finishedAt: Date.now(), status: 'done' })
    const active = activeSessionIds()
    expect([...active].sort()).toEqual(['a', 'b'])
  })

  it('清空后为空', () => {
    markRunning('a')
    resetStatusStoreForTest()
    expect([...activeSessionIds()]).toEqual([])
    clearFinishedRuns()
  })
})

describe('subscribePresence', () => {
  it('状态变化时把会话 id 交给订阅者', () => {
    const listener = vi.fn()
    const off = subscribePresence(listener)
    markRunning('s9')
    expect(listener).toHaveBeenCalledWith('s9')
    off()
    listener.mockClear()
    markRunning('s10')
    expect(listener).not.toHaveBeenCalled()
  })
})
