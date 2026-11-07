import { describe, expect, it, beforeEach } from 'vitest'
import {
  barsOf,
  dispatchStatusEvent,
  resetStatusStoreForTest,
  runningOf,
  statusOf,
  subscribeStatus,
} from './session-status-store.ts'

const at = 1_000_000
const session = 'session-x'

beforeEach(() => { resetStatusStoreForTest() })

describe('会话状态的跨页共享（单一生产者）', () => {
  it('聊天页发布「在跑」后，别的页面读得到', () => {
    dispatchStatusEvent(session, { type: 'turn', at, source: 'frame', running: true, turnNo: 3 })
    expect(runningOf(session, at + 100)).toBe(true)
    expect(statusOf(session)?.turn?.value.turnNo).toBe(3)
  })

  it('从没发布过的会话：返回 undefined（消费者退回自己的花名册，不假装知道）', () => {
    expect(runningOf('session-never-published', at)).toBeUndefined()
    expect(barsOf('session-never-published')).toBeUndefined()
  })

  it('租约过期后不再表态（跑完不会永远显示「运行中」）', () => {
    dispatchStatusEvent(session, { type: 'turn', at, source: 'frame', running: true })
    expect(runningOf(session, at + 5_000)).toBe(true)
    // 实时帧租约 30s
    expect(runningOf(session, at + 60_000)).toBeUndefined()
  })

  it('结论变化才通知订阅者（同一结论重复发布不打扰渲染）', () => {
    let calls = 0
    const off = subscribeStatus(() => { calls += 1 })
    dispatchStatusEvent(session, { type: 'queue', at, source: 'snapshot', items: [{ id: 'q1', placement: 'queued', text: 'a', editable: true }] })
    expect(calls).toBe(1)
    // 同样的队列再发一次：签名没变 → 不再通知
    dispatchStatusEvent(session, { type: 'queue', at: at + 10, source: 'snapshot', items: [{ id: 'q1', placement: 'queued', text: 'a', editable: true }] })
    expect(calls).toBe(1)
    // 队列清空：结论变了 → 通知
    dispatchStatusEvent(session, { type: 'queue', at: at + 20, source: 'snapshot', items: [] })
    expect(calls).toBe(2)
    off()
    dispatchStatusEvent(session, { type: 'queue', at: at + 30, source: 'snapshot', items: [{ id: 'q2', placement: 'queued', text: 'b', editable: true }] })
    expect(calls).toBe(2)
  })

  it('排队条结论按活着的租约算', () => {
    dispatchStatusEvent(session, { type: 'queue', at, source: 'snapshot', items: [
      { id: 'q1', placement: 'queued', text: 'a', editable: true },
      { id: 'q1', placement: 'queued', text: 'a2', editable: true },
    ] })
    // 同一 id 去重（单例不变量）
    expect(barsOf(session)?.queueBar).toBe(1)
  })
})
