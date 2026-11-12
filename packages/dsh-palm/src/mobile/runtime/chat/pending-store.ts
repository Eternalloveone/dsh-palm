/**
 * 会话级「待处理」账本（W3-2 第二步）：待批审批 + 待答问题。
 *
 * ## 为什么要有它
 *
 * 这两份事实原先住在 `ChatView` 的两个 `useState` 里，而写入方有三处：
 * `approval/requested` / `question/requested` 帧、弱网兜底轮询
 * (`use-pending-poll`)、以及审批/提问面板答完后的本地摘除。三处各写一份
 * 组件内状态，于是：
 *
 * - **换会话靠清空**挡住串写（`setPendingApprovals([])`），代价是 A 的待批卡片
 *   在你切到 B 再切回 A 时凭空消失，直到宿主重放；
 * - **换页面靠重订阅**恢复：进「审批详情」页时 ChatView 卸载，回来时组件状态
 *   已经没了，只能等宿主把待批项再重放一遍（弱网下就是"点了详情，回来卡片没了"）。
 *
 * 账本把"事实"搬到模块作用域、按 `sessionId` 分桶：进会话只是换一个桶，
 * 不需要清空；Chat 面板、审批详情页、问题面板读的是同一个对象。
 *
 * ## 边界
 *
 * - **纯对象 + 订阅**，不 import React（架构断言钉住 runtime/chat 里的纯性）；
 * - 只存"宿主还没答完"的待处理项；**写入规则**（重放去重、答过不再显示、
 *   轮询空结果不回滚）仍然留在既有纯函数里（`approval-batches.ts` /
 *   `question-batches.ts` / `frame-effects.ts`），本文件不复制第二份判断，
 *   否则规则会分叉成两套"谁先到谁赢"。
 * - 会话切换**不清空**：分桶即隔离。登出/换设备/测试用 `resetSessionPendingStores()`。
 *
 * @module dsh-palm/mobile/runtime/chat/pending-store
 */

import type { PendingApproval, PendingQuestionItem } from '../../api.ts'

/** 一条会话的待处理快照。 */
export interface SessionPendingState {
  /** 宿主还没被答复的审批（按到达顺序）。 */
  readonly approvals: PendingApproval[]
  /** 宿主还没被答复的问题批次。 */
  readonly questions: PendingQuestionItem[]
}

/**
 * 写入方：值或函数。函数式写法与 `useState` 一致，是为了让迁移只换"值存在哪"，
 * 不换调用点写法 —— 已有的去重/采纳逻辑能原样搬过来。
 */
export type PendingUpdate<T> = T[] | ((previous: T[]) => T[])

export type SessionPendingListener = (state: SessionPendingState) => void

export interface SessionPendingStore {
  readonly sessionId: string
  getState: () => SessionPendingState
  /** 替换/更新本条会话的待批审批。 */
  setApprovals: (update: PendingUpdate<PendingApproval>) => void
  /** 替换/更新本条会话的待答问题。 */
  setQuestions: (update: PendingUpdate<PendingQuestionItem>) => void
  /** 订阅本会话的快照；返回退订函数。 */
  subscribe: (listener: SessionPendingListener) => () => void
}

/** 会话桶：一个会话一个实例，跨组件/跨页面共享。 */
const stores = new Map<string, SessionPendingStore>()

function createStore(sessionId: string): SessionPendingStore {
  let state: SessionPendingState = { approvals: [], questions: [] }
  const listeners = new Set<SessionPendingListener>()

  const emit = (): void => {
    // 逐个通知并**隔离**：一个订阅者抛错不许让其他订阅者收不到这份事实；
    // 错误收集起来交给调用方（不静默吞）。
    let failure: unknown
    for (const listener of [...listeners]) {
      try {
        listener(state)
      } catch (error) {
        failure ??= error
      }
    }
    if (failure !== undefined) throw failure
  }

  const commit = (next: SessionPendingState): void => {
    // 引用没变 ＝ 这次更新没改变任何事实（例如重放去重后原样返回），不唤醒订阅者。
    if (next.approvals === state.approvals && next.questions === state.questions) return
    state = next
    emit()
  }

  const apply = <T,>(current: T[], update: PendingUpdate<T>): T[] =>
    typeof update === 'function' ? (update as (previous: T[]) => T[])(current) : update

  return {
    sessionId,
    getState: () => state,
    setApprovals: (update) => {
      const approvals = apply(state.approvals, update)
      commit({ ...state, approvals })
    },
    setQuestions: (update) => {
      const questions = apply(state.questions, update)
      commit({ ...state, questions })
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

/**
 * 取（必要时创建）一条会话的待处理账本。
 *
 * 同一个 `sessionId` 永远拿到同一个实例：Chat 面板与审批详情页因此读的是
 * 同一份事实，而不是各自在导航时抄走的快照。
 */
export function sessionPendingStore(sessionId: string): SessionPendingStore {
  const existing = stores.get(sessionId)
  if (existing !== undefined) return existing
  const created = createStore(sessionId)
  stores.set(sessionId, created)
  return created
}

/** 丢掉所有会话桶（登出、换设备、测试隔离）。 */
export function resetSessionPendingStores(): void {
  stores.clear()
}
