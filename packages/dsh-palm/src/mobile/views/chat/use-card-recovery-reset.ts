/**
 * **会话切换时重置「卡片补读」与「实时关闭回合」的记忆**（S2-I：从 `ChatView.tsx` 搬出）。
 *
 * 这两个记忆都是**按会话**成立的：
 *
 * | 记忆 | 内容 | 不重置的后果 |
 * |---|---|---|
 * | `cardRecoveryRef` | 补读状态 / 冷却表 / 已确认集合 | 上一会话的冷却会把这一会话的卡挡住，表现为"新会话里卡一直不出来" |
 * | `liveClosedTurnsRef` | 亲眼看过 `turn/end` 的回合号 | 轮号在会话间不唯一，会把这一会话的回合误判成"已经看过结束帧"，于是不再补读 |
 *
 * 重置必须是**整个对象换新**，而不是逐字段清零：逐字段清零是这套状态历史上反复出问题的地方
 * （漏一个字段就残留一次旧会话的记忆）。
 *
 * @module dsh-palm/mobile/views/chat/use-card-recovery-reset
 */
import { useEffect, type MutableRefObject } from 'react'

/** 补读状态。 */
export interface CardRecoveryState {
  busy: boolean
  pending: boolean
  cooling: Map<number, number>
  confirmed: Set<number>
}

/** 依赖。 */
export interface CardRecoveryResetDeps {
  /** 当前会话（换会话即重置）。 */
  sessionId: string
  /** 补读状态引用。 */
  cardRecoveryRef: MutableRefObject<CardRecoveryState>
  /** 「亲眼看过 turn/end」的回合号集合。 */
  liveClosedTurnsRef: MutableRefObject<Set<number>>
}

/** 换会话时重置两处记忆。 */
export function useCardRecoveryReset(deps: CardRecoveryResetDeps): void {
  const { sessionId, cardRecoveryRef, liveClosedTurnsRef } = deps
  useEffect(() => {
    // 整个对象换新，不逐字段清零（漏一个字段就残留一次旧会话的记忆）。
    cardRecoveryRef.current = { busy: false, pending: false, cooling: new Map(), confirmed: new Set() }
    liveClosedTurnsRef.current = new Set()
  }, [sessionId, cardRecoveryRef, liveClosedTurnsRef])
}
