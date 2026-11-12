/**
 * 落点判定：滚完之后，这一屏到底算不算"到位"。
 *
 * ## 为什么单独一个纯函数
 *
 * 这段判断原来埋在 ChatView 的落点 effect 里（`3439-3533`），和 `requestAnimationFrame`、
 * `setScrollTopProgrammatically`、收尾校准缠在一起，**一行都测不了**。而它恰恰是
 * 「定位到了但看不见」这类真机问题的判据所在：
 *
 * - 判据写宽（"锚点在屏内就行"）→ 容差一整屏，落点偏半屏也算过，偏了没人重试
 * - 判据写死（"锚点必须在视口顶附近"）→ 内容还没铺满一屏时 `scrollTop` 被 clamp，
 *   补多少次都是同一个数，白烧补偿次数然后判失败
 *
 * 抽出来之后两个极端都能写测试钉住。
 *
 * @module dsh-palm/mobile/views/chat/lib/locate-landing
 */

/** 一次落点测量需要的全部数字（都来自 `getBoundingClientRect` / 滚动容器）。 */
export interface LandingMetrics {
  /** 命中锚点的上沿（相对视口）。 */
  anchorTop: number
  /** 锚点自身高度：用来判断"整块在视口里"。 */
  anchorHeight: number
  /** 滚动容器上沿（相对视口）。 */
  containerTop: number
  /** 滚动容器可视高度。 */
  containerHeight: number
  /** 当前 scrollTop。 */
  scrollTop: number
  /** 容器内容总高。 */
  scrollHeight: number
  /** 落点希望离容器顶多少像素（阅读留白）。 */
  topGap: number
  /** 允许的偏差下限。 */
  tolerancePx: number
}

/** 判定结果。 */
export type LandingVerdict =
  /** 容器还没有可视高度：布局未稳（或 jsdom），应当相信滚动、不再重试。 */
  | 'unstable'
  /** 已经到位：可以收尾。 */
  | 'landed'
  /** 还偏：按差额补一次。 */
  | 'adjust'

/**
 * 判一次落点。
 *
 * 两个判据二选一，**且都只在各自成立的前提下生效**：
 *
 * 1. 正常情况：锚点上沿落在「容器顶 - 容差 … 容器顶 + slack」之间。
 * 2. 滚到头了（`scrollTop + clientHeight >= scrollHeight`）：此时"贴顶"是不可能
 *    达成的目标（再滚也不会动），改为要求**整块锚点都在视口里**。
 */
export function judgeLanding(metrics: LandingMetrics): LandingVerdict {
  const { anchorTop, anchorHeight, containerTop, containerHeight, scrollTop, scrollHeight, tolerancePx } = metrics
  if (containerHeight <= 0) return 'unstable'
  // slack 随视口高度伸缩，但夹在 16~48 之间：太小则永远"差一点"、太大则偏半屏也过。
  const slack = Math.min(48, Math.max(16, containerHeight * 0.25))
  const atScrollEnd = scrollTop + containerHeight >= scrollHeight - 2
  const nearTop = anchorTop >= containerTop - tolerancePx && anchorTop <= containerTop + slack
  const fullyVisible = anchorTop >= containerTop - tolerancePx && anchorTop + anchorHeight <= containerTop + containerHeight
  if (nearTop) return 'landed'
  if (atScrollEnd && fullyVisible) return 'landed'
  return 'adjust'
}

/**
 * 补偿要写的差额：正数向下滚，负数向上滚。
 *
 * **只补差额、不重算绝对位置** —— 重算正是老实现"越补越偏"的原因（每轮用估算值
 * 重新算一次目标，误差累积）。
 */
export function landingDelta(metrics: LandingMetrics): number {
  return metrics.anchorTop - metrics.containerTop - metrics.topGap
}

/** 收尾校准要不要动手：偏得比"半个留白"更多才补，免得每 220ms 都抖一下。 */
export function needsSettle(offset: number, topGap: number): boolean {
  return Math.abs(offset) > Math.max(24, topGap * 3)
}
