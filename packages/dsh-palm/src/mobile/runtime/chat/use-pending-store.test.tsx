// @vitest-environment jsdom
/**
 * 待处理账本的 React 绑定（W3-2 第二步）。
 *
 * 账本本身的行为在 `pending-store.test.ts` 里证；这里证的是**视图看到什么**：
 * 换会话换桶、切回来事实还在、写入方（帧/轮询/面板）走同一个入口。
 *
 * 为什么要单独测：这两条正是用户能感觉到的差别 —— 以前换会话靠"进会话清空"
 * 挡串写，代价是 A 的待批卡片切回来就没了。
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useSessionPending } from './use-pending-store.ts'
import { resetSessionPendingStores } from './pending-store.ts'
import type { PendingApproval } from '../../api.ts'

const approval = (id: string): PendingApproval => ({
  rpcId: `rpc-${id}`,
  approvalId: id,
  toolName: 'Bash',
  reason: '跑一下测试',
})

beforeEach(() => {
  resetSessionPendingStores()
})

afterEach(() => {
  cleanup()
})

describe('useSessionPending', () => {
  it('换会话换桶：A 的待批不会画进 B', () => {
    const { result, rerender } = renderHook(({ sessionId }: { sessionId: string }) => useSessionPending(sessionId), {
      initialProps: { sessionId: 's-a' },
    })
    act(() => { result.current.setApprovals(() => [approval('ap-a')]) })
    expect(result.current.approvals.map(item => item.approvalId)).toEqual(['ap-a'])

    rerender({ sessionId: 's-b' })
    expect(result.current.approvals).toEqual([])

    rerender({ sessionId: 's-a' })
    // 关键差异：切回来事实还在（不需要等宿主重放），因为账本按会话分桶。
    expect(result.current.approvals.map(item => item.approvalId)).toEqual(['ap-a'])
  })

  it('setter 与 useState 同签名：函数式更新看到当前值', () => {
    const { result } = renderHook(() => useSessionPending('s-a'))
    act(() => { result.current.setQuestions(() => [{ rpcId: 'rpc-q1', id: 'q1', question: '继续？' }]) })
    act(() => {
      // 帧重放：同一 rpcId 不重复追加（与 frame-effects 的去重写法一致）。
      result.current.setQuestions(prev => (prev.some(item => item.rpcId === 'rpc-q1') ? prev : [...prev, { rpcId: 'rpc-q1', id: 'q1', question: '继续？' }]))
    })
    expect(result.current.questions).toHaveLength(1)
  })

  it('同一会话的两个订阅方看到同一份事实（Chat 面板与详情页共读）', () => {
    const chat = renderHook(() => useSessionPending('s-a'))
    const page = renderHook(() => useSessionPending('s-a'))
    act(() => { chat.result.current.setApprovals(() => [approval('ap-a')]) })
    expect(page.result.current.approvals.map(item => item.approvalId)).toEqual(['ap-a'])
  })
})
