/**
 * 会话待处理账本的 React 绑定（W3-2 第二步）。
 *
 * 账本本身是纯对象 + 订阅（`pending-store.ts`，不 import React）；这个文件是
 * **唯一**把它接进 React 的地方。用 `useSyncExternalStore` 而不是
 * "useEffect + setState"，是为了让"快照"在并发渲染下也不会撕裂——审批面板
 * 与问题面板读同一份快照，不能一半新一半旧。
 *
 * 返回的 setter 与 `useState` 的签名一致（`Dispatch<SetStateAction<T>>`）：
 * 迁移只换"事实存在哪"，不换调用点的写法，已有的重放去重/轮询采纳逻辑
 * 才能原样搬过来而不是再造一套。
 *
 * @module dsh-palm/mobile/runtime/chat/use-pending-store
 */

import { useCallback, useMemo, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react'
import { sessionPendingStore } from './pending-store.ts'
import type { PendingApproval, PendingQuestionItem } from '../../api.ts'

export interface SessionPendingBinding {
  /** 本条会话待答的审批。 */
  approvals: PendingApproval[]
  /** 本条会话待答的问题批次。 */
  questions: PendingQuestionItem[]
  /** 写入方：SSE 帧、轮询、面板答完后摘除，都走这一处。 */
  setApprovals: Dispatch<SetStateAction<PendingApproval[]>>
  setQuestions: Dispatch<SetStateAction<PendingQuestionItem[]>>
}

/**
 * 订阅一条会话的待处理事实。
 *
 * `sessionId` 变了就换桶（账本按会话隔离），不会把上一条会话的卡片带过来；
 * 也不需要"进会话先清空"那种补丁，切回原会话时卡片还在。
 *
 * @param sessionId - 当前会话 id
 * @returns 快照与写入方
 */
export function useSessionPending(sessionId: string): SessionPendingBinding {
  const store = useMemo(() => sessionPendingStore(sessionId), [sessionId])
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)

  const setApprovals = useCallback<Dispatch<SetStateAction<PendingApproval[]>>>(
    (update) => { store.setApprovals(update) },
    [store],
  )
  const setQuestions = useCallback<Dispatch<SetStateAction<PendingQuestionItem[]>>>(
    (update) => { store.setQuestions(update) },
    [store],
  )

  return { approvals: state.approvals, questions: state.questions, setApprovals, setQuestions }
}
