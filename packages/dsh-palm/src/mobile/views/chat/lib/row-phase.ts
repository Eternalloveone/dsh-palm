/**
 * 「这一行收工了没有」—— 交付卡与秒表的**唯一判据**。
 *
 * 为什么单独成函数（T1）：这段判据原来写在 `ChatView` 里，一句话里同时管三件事，
 * 每一条都对应一次真机事故：
 *
 * | 判据 | 防的现象 |
 * |---|---|
 * | `!turnLive` → 全收工 | 会话没在跑时不该有任何一行顶着秒表 |
 * | 被放弃的那一轮 → 收工 | 用户点了停止，卡不该继续数秒 |
 * | 最新轮 = max(帧里的 runningTurn, 行里最新轮) | 只看 runningTurn 时它比屏幕旧，会同时出现两张顶着秒表的卡 |
 * | 缺轮号的行按 `pending` 判 | 缺轮号默认"在跑"会让上一轮残留的卡顶着秒表（两张卡用时一模一样） |
 *
 * @module dsh-palm/mobile/views/chat/lib/row-phase
 */
import type { RenderMessage } from '../../../render/messages.ts'
import { newestFoldTurn } from '../state/stream-state.ts'

export interface SettledContext {
  /** 这一场是否还有在跑的轮（`running || turnStartAt !== null`）。 */
  turnLive: boolean
  /** 被用户放弃的那一轮。 */
  abandonedTurn: number | undefined
  /** 实时帧报告的正在跑的轮号（可能比屏幕旧）。 */
  runningTurn: number | undefined
  /** 屏幕上已载入行里最新的轮号。 */
  newestLoadedTurn: number | undefined
}

/**
 * 这一行是否已经收工。
 *
 * @param message - 任意一条渲染行
 * @param context - 见 {@link SettledContext}
 * @returns true = 收工（可以画卡、停秒表）
 */
export function isRowSettled(message: RenderMessage, context: SettledContext): boolean {
  const { turnLive, abandonedTurn, runningTurn, newestLoadedTurn } = context
  if (!turnLive) return true
  if (abandonedTurn !== undefined && message.turn === abandonedTurn) return true
  // 两边取更大的：runningTurn 可能是旧值（帧延迟 / 断线重连），只看它会把最新一轮
  // 判成已停、把旧一轮判成在跑 —— 屏幕上就是两张顶着秒表的卡。
  const newest = Math.max(runningTurn ?? -1, newestLoadedTurn ?? -1)
  // 缺轮号的行不能默认为「正在跑」：判据用 pending（"还在流"的唯一可靠信号），
  // 比"是不是最后一行"稳（最后一行也可能是刚落地的收工行）。
  if (message.turn === undefined) return message.pending !== true
  return message.turn !== newest
}

/**
 * 便捷入口：从行列表里现取"最新轮"再按 {@link isRowSettled} 判。
 *
 * @param messages - 当前载入的行
 * @param message - 要判的那一行
 * @param context - 除 `newestLoadedTurn` 外的上下文
 * @returns true = 收工
 */
export function isRowSettledIn(
  messages: readonly RenderMessage[],
  message: RenderMessage,
  context: Omit<SettledContext, 'newestLoadedTurn'>,
): boolean {
  return isRowSettled(message, { ...context, newestLoadedTurn: newestFoldTurn(messages) })
}
