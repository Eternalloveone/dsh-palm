/**
 * 回合秒表的锚点：这一轮到底从什么时候开始算。
 *
 * 从 `ChatView` 搬出来（S4-2b）：三个纯函数，只认 `RenderMessage` 的形状，不碰 DOM、
 * 不读 state —— 搬出来才能单测，也才能让"秒表口径"只有一份。
 *
 * @module dsh-palm/mobile/views/chat/lib/turn-anchor
 */
import type { RenderMessage } from '../../../render/messages.ts'
import { newestFoldTurn } from '../state/stream-state.ts'

/**
 * 最新一轮的起点，按可信度从高到低取：
 *
 *   1. 行上的 `turnStartAt` —— 折叠盖上去的 turn/start 时间，最准；
 *   2. 行上的 `firstSeenAt` —— 这一行**首个**事件的宿主时间。长回合里 turn/start
 *      会被挤出折叠窗口和边界回读窗口（跑十几分钟、几十步就到），此时这是唯一还
 *      带着"这一轮从什么时候开始"的证据；
 *   3. 这一轮发起它的那条用户消息 —— assistant 行还没落地时（刚发完、模型还没吐
 *      第一个字）只有它在。
 *
 * 兜底绝不能退到挂载时刻：那会让打开一个已经跑了十分钟的会话从 0 秒开始数，
 * 与桌面端对不上（真机返工过的现象）。
 *
 * 特别注意别用 `message.time`：它是这一行**最后一次**被事件碰到的时刻，活跃行上
 * 就等于"现在"，拿它当锚点秒表永远从 0 数。
 */
export function newestTurnAnchor(messages: readonly RenderMessage[]): number | undefined {
  const turn = newestFoldTurn(messages)
  let own: number | undefined
  let firstSeen: number | undefined
  let lastUser: number | undefined
  for (const message of messages) {
    if (message.kind === 'user') {
      // 用户行不带 turn 字段（见 newestFoldTurn 的注释），所以只能拿"最后一条"。
      const at = typeof message.time === 'number' && Number.isFinite(message.time) ? message.time : undefined
      if (at !== undefined && (lastUser === undefined || at > lastUser)) lastUser = at
      continue
    }
    if (message.kind !== 'assistant') continue
    if (turn !== undefined && message.turn !== turn) continue
    const startAt = typeof message.turnStartAt === 'number' && Number.isFinite(message.turnStartAt)
      ? message.turnStartAt
      : undefined
    if (startAt !== undefined && (own === undefined || startAt < own)) own = startAt
    const seenAt = typeof message.firstSeenAt === 'number' && Number.isFinite(message.firstSeenAt)
      ? message.firstSeenAt
      : undefined
    if (seenAt !== undefined && (firstSeen === undefined || seenAt < firstSeen)) firstSeen = seenAt
  }
  return own ?? firstSeen ?? lastUser
}

/**
 * 最后一条用户消息的宿主时间（毫秒）—— 一轮秒表的**硬下界**。
 *
 * 真机 2026-11-14（用户第四次报计时不准，截图「等回话 43分34秒」，实际只跑了 8 分钟）：
 * 新一轮刚发出去时，宿主快照还停在上一轮、折叠里也还没有本轮的 assistant 行，
 * 于是 {@link newestTurnAnchor} 顺着 `own` 把**上一轮**的 turnStartAt 当成了本轮起点。
 * 上面那层「只许变早」的 min 记忆又把这个错值锁死 —— 早的永远赢，错得越早越稳。
 *
 * 所以锚点必须先过一道物理约束：**本轮不可能在本轮用户开口之前开始**。
 *
 * @param messages - 当前窗口里的渲染行
 * @returns 最后一条用户消息的时间；没有用户行时 undefined
 */
export function lastUserMessageAt(messages: readonly RenderMessage[]): number | undefined {
  let at: number | undefined
  for (const message of messages) {
    if (message.kind !== 'user') continue
    if (typeof message.time !== 'number' || !Number.isFinite(message.time)) continue
    if (at === undefined || message.time > at) at = message.time
  }
  return at
}

/**
 * 把锚点夹到「不早于最后一条用户消息」。
 *
 * 只抬下界、不压上界：晚于用户消息的候选原样返回（行上更精确的 turn/start 不该被打扰），
 * 早于它的一律视为上一轮的残留。
 *
 * @param anchor - 候选锚点（`null` = 没有开着的轮）
 * @param floor - 下界（见 {@link lastUserMessageAt}）
 * @returns 夹过的锚点
 */
export function clampAnchorToOwnTurn(
  anchor: number | null | undefined,
  floor: number | undefined,
): number | null | undefined {
  if (anchor === null || anchor === undefined) return anchor
  if (floor === undefined || !Number.isFinite(floor) || !Number.isFinite(anchor)) return anchor
  return Math.max(anchor, floor)
}
