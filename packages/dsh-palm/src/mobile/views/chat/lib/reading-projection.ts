/**
 * 阅读投影：把「这一屏现在算第几轮、有几轮、正在跑哪一轮」这一组派生量收敛成**一次纯计算**。
 *
 * 为什么要有它（S4-3）：这些量原来散在 `ChatView` 里 —— 两个 `turnEntries` 相关 `useMemo`、
 * 两个立即执行的 IIFE（`activeTurn` / `newestCardTurn`），各自从 `messages` 再扫一遍。
 * 同一条事实（"最新一轮是第几轮"）有三个实现、三份口径，改一个忘一个就是真机上
 * 「跑着的时候冒出交付卡」「滑条读数停在上一轮」这类现象的来源。
 *
 * 这里只做**投影**：输入是行与宿主大纲，输出是读数；不读 DOM、不写状态、不触发渲染。
 *
 * @module dsh-palm/mobile/views/chat/lib/reading-projection
 */
import type { RenderMessage } from '../../../render/messages.ts'
import { localTurnEntries, mergeTurnEntries, parseTurnOutline, type TurnEntry } from '../../../session/turn-outline.ts'

export interface ReadingProjectionInput {
  /** 当前已折叠的行。 */
  messages: readonly RenderMessage[]
  /** 宿主 `turnOutline` 投影的原始值（可能还没到）。 */
  turnOutlineRaw: unknown
  /** 读者当前停在第几轮（0 = 还不知道，用最新一轮兜底）。 */
  currentTurn: number
}

export interface ReadingProjection {
  /** 宿主大纲 + 本地已载入轮次合并后的列表（按轮号升序）。 */
  turnEntries: readonly TurnEntry[]
  /** 轮号最大值：「第 7 / **43**」的分母。用轮号不用条数，部分合并时读数才不跳。 */
  maxTurn: number
  /** 宿主大纲自己的最新轮号（0 = 还没到）。它是**全会话**的轮表，不随翻页增长。 */
  hostNewestTurn: number
  /** 滑条与标题上显示的轮号：读者停的那一轮，没有就用最新一轮。 */
  shownTurn: number
  /**
   * 本轮的轮号：**最后一条用户消息之后**出现的那一轮。
   *
   * 用它而不是 liveTurn：liveTurn 依赖实时帧/注册，手机偶尔拿不到；而"在跑的时候
   * 本轮的交付卡不该出现"这件事，只看位置就够了。
   */
  activeTurn: number | undefined
  /**
   * 列表里**轮号最大**的那一轮。
   *
   * 用途：只知道"会话在跑"、却不知道是哪一轮时（实时帧丢了、刚重连），拿它当保守的
   * "本轮"——宁可先把最新那张交付卡藏起来，也不要让"跑着的时候冒出交付卡"再发生一次。
   */
  newestCardTurn: number | undefined
  /** 最后一条用户消息的宿主时间（秒表的硬下界）。 */
  lastUserAt: number | undefined
}

/**
 * 算这一屏的阅读读数。
 *
 * @param input - 见 {@link ReadingProjectionInput}
 * @returns 见 {@link ReadingProjection}；输入为空时各项都是空值（不返回 undefined）
 */
export function projectReading(input: ReadingProjectionInput): ReadingProjection {
  const { messages, turnOutlineRaw, currentTurn } = input

  const turnEntries = mergeTurnEntries(parseTurnOutline(turnOutlineRaw), localTurnEntries(messages))
  const maxTurn = turnEntries[turnEntries.length - 1]?.turn ?? 0
  let hostNewestTurn = 0
  for (const entry of parseTurnOutline(turnOutlineRaw)) {
    if (entry.turn > hostNewestTurn) hostNewestTurn = entry.turn
  }

  let lastUserIndex = -1
  let lastUserAt: number | undefined
  let newestCardTurn: number | undefined
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message === undefined) continue
    if (message.kind === 'user') {
      lastUserIndex = index
      const at = message.time
      if (typeof at === 'number' && Number.isFinite(at) && (lastUserAt === undefined || at > lastUserAt)) lastUserAt = at
      continue
    }
    const turn = message.turn
    if (turn === undefined) continue
    if (newestCardTurn === undefined || turn > newestCardTurn) newestCardTurn = turn
  }

  let activeTurn: number | undefined
  for (let index = lastUserIndex + 1; index < messages.length; index += 1) {
    const turn = messages[index]?.turn
    if (turn === undefined) continue
    if (activeTurn === undefined || turn > activeTurn) activeTurn = turn
  }

  return {
    turnEntries,
    maxTurn,
    hostNewestTurn,
    shownTurn: currentTurn > 0 ? currentTurn : maxTurn,
    activeTurn,
    newestCardTurn,
    lastUserAt,
  }
}
