/**
 * **目标条与计划条的状态落地**（W3：从 \`ChatView.tsx\` 组件体内抽出的第四个 hook）。
 *
 * 两条投影、两种规则：
 *
 * - **目标**：已完成 / 已清除 / 空目标一律落成 \`null\`（条子消失），与桌面端 GoalBar 同一规则。
 *   打开会话时问一次就够——目标只在手机上点动作时改变（老宿主靠这一次兜底）。
 * - **待办**：**last-write-wins by seq**。历史翻页与实时帧会抢同一个投影，旧页绝不能盖掉
 *   更新的实时快照；\`turn/start\` 时清空（宿主就在那里清投影）。
 *
 * @module dsh-palm/mobile/views/chat/use-chat-goal
 */
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'

import { goalOf } from '../../../data/session.ts'
import { parseGoalProjection } from '../../../goal-projection.ts'
import { parseTodoList, type TodoSnapshot, type WireEvent } from '../../../messages.ts'
import type { MobileGoal } from '../../../goal-projection.ts'

/** 目标条 / 计划条依赖。 */
export interface ChatGoalDeps {
  sessionId: string
  mountedRef: MutableRefObject<boolean>
  setGoal: (next: MobileGoal | null) => void
  setTodo: (update: (previous: TodoSnapshot | undefined) => TodoSnapshot | undefined) => void
  startTransition: (run: () => void) => void
  applyGoalRef: MutableRefObject<(value: unknown, activation?: 'armed' | 'disarmed') => void>
  adoptTodoRef: MutableRefObject<(next: TodoSnapshot) => void>
}

/** @returns 目标的三个入口：落地、主动刷新、待办采纳。 */
export function useChatGoal(deps: ChatGoalDeps): {
  applyGoal: (value: unknown, activation?: 'armed' | 'disarmed') => void
  refreshGoal: (options?: { fresh?: boolean }) => void
  adoptTodo: (next: TodoSnapshot | undefined) => void
  adoptTodoLatest: (event: WireEvent) => void
} {
  const { sessionId, mountedRef, setGoal, setTodo, startTransition, applyGoalRef, adoptTodoRef } = deps

  const applyGoal = useCallback((value: unknown, activation?: 'armed' | 'disarmed'): void => {
    const parsed = parseGoalProjection(value, activation)
    startTransition(() => { setGoal(parsed) })
  }, [setGoal, startTransition])
  applyGoalRef.current = applyGoal

  /**
   * 打开会话先问一次。目标只在手机上点动作时改变，所以不带 fresh：读花名册快照就够，
   * 省掉一次现开 follow（那条路会和聊天读抢宿主）。
   */
  const refreshGoal = useCallback((options: { fresh?: boolean } = {}): void => {
    void goalOf(sessionId, options).then(
      (value) => { if (mountedRef.current) applyGoal(value.goal, value.activation) },
      () => undefined,
    )
  }, [sessionId, mountedRef, applyGoal])

  useEffect(() => {
    // 只兜这一次：目标现在随 `mobile.sessionState` 的原子快照一起回来（和回合状态同一时刻），
    // 不再自己开 15/20 秒轮询 —— 那既慢又与回合状态不同步。留着是为了**老宿主**。
    refreshGoal()
  }, [refreshGoal])

  const adoptTodo = useCallback((next: TodoSnapshot): void => {
    setTodo(previous => (previous !== undefined && next.seq <= previous.seq ? previous : next))
  }, [setTodo])
  adoptTodoRef.current = adoptTodo

  /** 采纳一条实时 \`todo/write\`（畸形数据 → 保持原样）。 */
  const adoptTodoLatest = useCallback((event: WireEvent): void => {
    const items = parseTodoList(event.data)
    if (items === undefined) return
    adoptTodo({ seq: event.seq, items })
  }, [adoptTodo])

  return { applyGoal, refreshGoal, adoptTodo: adoptTodo as (next: TodoSnapshot | undefined) => void, adoptTodoLatest }
}
