/**
 * 输入框占位符的词池。
 *
 * 背景（2026-11-12 用户：「都改成说点什么会不会单调，要不要上词池」）：
 *
 * 状态条（`ui/turn-header.tsx` 的 `STRIP_POOL`）已经有一套成熟做法：同一族里换词、
 * 关键档一律不随机、每族最后一条是最保守的兜底。这里沿用同样的判断，但**收紧一条**：
 *
 * **所有候选都必须短到一行**。
 *
 * 为什么：占位符参与 `fitComposer` 的高度测量（空框时量的是 placeholder，不是 value）。
 * 一旦某条候选长到换行，输入框高度就会随它跳 —— 打字时框忽高忽低，比"单调"难看得多。
 * 所以池子只收 ≤ 7 个字的短句，并且测量时一律按**最长那条**量（见 composer-section），
 * 将来就算有人往里加长句，也不会让框抖起来。
 *
 * 另一条：**只在进入会话时随机一次**，不在打字过程中换。正打着字占位符变了一遍，
 * 会让人怀疑是不是自己输入错了。
 *
 * @module dsh-palm/mobile/views/chat/components/composer-placeholder
 */

/**
 * 空闲态的候选（运行中不用这套，固定一条中性文案）。
 *
 * 第一条是基准：最保守、最常见的那句，任何时候被人看到都不会觉得奇怪。
 */
export const IDLE_PLACEHOLDERS: readonly string[] = [
  '说点什么...',
  '接着说点什么',
  '有什么要改的',
  '让它做点什么',
  '换个说法...',
  '还要补充吗',
  '继续说...',
  '说个新活',
]

/** 单条候选的字数上限（含标点）：超过它就可能在窄框里换行，把输入框撑高。 */
export const PLACEHOLDER_MAX_CHARS = 10

/**
 * 取一条空闲态占位符。
 *
 * @param random - 0≤x<1 的随机数（测试注入，默认 Math.random）
 * @returns 池中的一条
 */
export function pickIdlePlaceholder(random: () => number = Math.random): string {
  if (IDLE_PLACEHOLDERS.length === 0) return '说点什么...'
  const value = random()
  const safe = Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.999_999) : 0
  const index = Math.floor(safe * IDLE_PLACEHOLDERS.length)
  return IDLE_PLACEHOLDERS[Math.min(index, IDLE_PLACEHOLDERS.length - 1)] ?? '说点什么...'
}

/**
 * 池里最长的那条：量高度用它，这样换到任何一条都不会改变框高。
 *
 * @returns 最长候选（空池时回落到基准）
 */
export function longestIdlePlaceholder(): string {
  let longest = '说点什么...'
  for (const candidate of IDLE_PLACEHOLDERS) {
    if (candidate.length > longest.length) longest = candidate
  }
  return longest
}
