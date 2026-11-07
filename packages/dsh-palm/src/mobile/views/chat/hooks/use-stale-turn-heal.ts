/**
 * **过期轮号的失帧自愈**（S2-E：从 `ChatView.tsx` 搬出）。
 *
 * `turn/end` 与 `turn/start` 是两帧。手机在弱网/切后台时经常漏掉其中一帧：
 * 漏了 `turn/end`，`runningTurn` 和计时锚点就永远停在上一轮——上一轮的卡片一直
 * 「正在回答」并继续数秒，而新一轮的秒表从上一轮的起点开始算（真机截图里 46 秒就是这么来的）。
 *
 * **判据只用一条不会误伤的证据：出现了轮号更大的 assistant 行。** 那说明更晚的一轮已经在
 * 写回复了，手上这个轮号必然是过期的。
 *
 * 不能拿「更新的用户消息」当判据——插话（steer）和排队消息被认领都是在**同一轮里**追加
 * 用户消息，那样会把正在跑的这一轮误清零。
 *
 * 计时锚点的另一条规则（在 ChatView 里）：**锚点只许变早**。一轮的起点是既成事实，后来的
 * 更晚锚点一律不采信，否则会出现「5分10秒」跳回「1分20秒」再从小往大长。
 *
 * @module dsh-palm/mobile/views/chat/use-stale-turn-heal
 */
import { useEffect } from 'react'

import type { RenderMessage } from '../../../render/messages.ts'
import { turnNumberIsStale } from '../../../stream/turn-liveness.ts'

/** 依赖。 */
export interface StaleTurnHealDeps {
  /** 宿主说正在跑的轮号（可能因为漏帧而过期）。 */
  runningTurn: number | undefined
  /** 已折叠出来的行。 */
  messages: readonly RenderMessage[]
  /** 清掉「当前活跃轮」的外部状态。 */
  clearActiveTurn: () => void
}

/** 发现轮号过期就自愈。 */
export function useStaleTurnHeal(deps: StaleTurnHealDeps): void {
  const { runningTurn, messages, clearActiveTurn } = deps
  useEffect(() => {
    if (runningTurn === undefined) return
    if (!turnNumberIsStale(runningTurn, messages)) return
    clearActiveTurn()
  }, [messages, runningTurn, clearActiveTurn])
}
