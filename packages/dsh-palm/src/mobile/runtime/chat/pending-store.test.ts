/**
 * 会话级「待处理」账本（W3-2 第二步：待批审批 / 待答问题）。
 *
 * 病灶：这两份事实原先住在 ChatView 的两个 useState 里。于是同一份事实有三处
 * 写入方（SSE 帧、弱网轮询、审批详情页回来后的收尾），会话切换只能靠"进会话时
 * 把两张表清空"挡住串写 —— 清空既是补丁也是数据丢失：A 的待批卡片在你切到 B
 * 再切回 A 时消失，直到宿主重放。
 *
 * 这里钉住账本的契约，第一条就是**按会话隔离**：这是"串写"这个老大难问题的
 * 唯一判据，不能靠 UI 层的清空动作维持。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionPendingStores, sessionPendingStore } from './pending-store.ts'
import type { PendingApproval, PendingQuestionItem } from '../../api.ts'

const approval = (id: string): PendingApproval => ({
  rpcId: `rpc-${id}`,
  approvalId: id,
  toolName: 'Bash',
  callId: `call-${id}`,
  reason: '跑一下测试',
})

const question = (id: string): PendingQuestionItem => ({
  rpcId: `rpc-${id}`,
  id: `q-${id}`,
  question: '要继续吗？',
})

beforeEach(() => {
  resetSessionPendingStores()
})

describe('sessionPendingStore', () => {
  it('按会话隔离：A 的待批不会出现在 B（这就是"切换会话不串写"）', () => {
    const a = sessionPendingStore('s-a')
    const b = sessionPendingStore('s-b')
    a.setApprovals(prev => [...prev, approval('ap-1')])
    expect(a.getState().approvals.map(item => item.approvalId)).toEqual(['ap-1'])
    expect(b.getState().approvals).toEqual([])
  })

  it('同一会话两次取到同一个账本实例（跨入口共享同一份事实）', () => {
    expect(sessionPendingStore('s-a')).toBe(sessionPendingStore('s-a'))
    expect(sessionPendingStore('s-a')).not.toBe(sessionPendingStore('s-b'))
  })

  it('函数式更新看到的是本会话的当前值（重放去重靠它）', () => {
    const store = sessionPendingStore('s-a')
    store.setApprovals(() => [approval('ap-1')])
    // 宿主每次重订阅都会重放同一条：updater 必须看到已经存在的那份。
    store.setApprovals(prev => (prev.some(item => item.approvalId === 'ap-1') ? prev : [...prev, approval('ap-1')]))
    expect(store.getState().approvals).toHaveLength(1)
  })

  it('审批与问题互不覆盖（两个字段各自更新）', () => {
    const store = sessionPendingStore('s-a')
    store.setApprovals(() => [approval('ap-1')])
    store.setQuestions(() => [question('q-1')])
    expect(store.getState().approvals.map(item => item.approvalId)).toEqual(['ap-1'])
    expect(store.getState().questions.map(item => item.rpcId)).toEqual(['rpc-q-1'])
    store.setApprovals(() => [])
    expect(store.getState().questions.map(item => item.rpcId)).toEqual(['rpc-q-1'])
  })

  it('没有变化就不通知订阅者（幂等更新不制造重渲染）', () => {
    const store = sessionPendingStore('s-a')
    const listener = vi.fn()
    store.subscribe(listener)
    const before = store.getState()
    store.setApprovals(prev => prev)
    expect(listener).not.toHaveBeenCalled()
    expect(store.getState()).toBe(before)
  })

  it('有变化才通知，且通知里带新快照；退订后不再通知', () => {
    const store = sessionPendingStore('s-a')
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.setApprovals(() => [approval('ap-1')])
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0]?.[0]).toBe(store.getState())
    unsubscribe()
    store.setApprovals(() => [])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('一个订阅者抛错不影响其他订阅者，也不吞掉错误', () => {
    const store = sessionPendingStore('s-a')
    const second = vi.fn()
    store.subscribe(() => { throw new Error('boom') })
    store.subscribe(second)
    expect(() => { store.setQuestions(() => [question('q-1')]) }).toThrow('boom')
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('reset 清掉所有会话（测试隔离与登出用）', () => {
    sessionPendingStore('s-a').setApprovals(() => [approval('ap-1')])
    sessionPendingStore('s-b').setQuestions(() => [question('q-1')])
    resetSessionPendingStores()
    expect(sessionPendingStore('s-a').getState().approvals).toEqual([])
    expect(sessionPendingStore('s-b').getState().questions).toEqual([])
  })
})
