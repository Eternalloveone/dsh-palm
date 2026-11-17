/**
 * 程序化滚动的**认领**（claim）：这次 scroll 事件是不是我们自己造成的。
 *
 * 只有一个判定入口 {@link isClaimedEcho}，因为认错一次的代价不对称：
 *
 * - 把自己的回声认成手势 → 关掉跟随锁、`userMoved` 置真，补钉从此不再工作
 *   （`maySettlePin` 第一条就是 `if (state.userMoved) return false`）；
 * - 把真手势认成回声 → 读者往上翻，界面还继续拽到底部。
 *
 * 认领有两种形状，差别只在**时间**还是**区间**：
 *
 * | 形状 | 触发 | 判据 |
 * |---|---|---|
 * | 点（point） | `scrollTop = N` 一次写完 | 值对得上（±{@link CLAIM_TOLERANCE_PX}）+ 在 {@link CLAIM_WINDOW_MS} 内 |
 * | 区间（span） | `scrollTo({behavior:'smooth'})` | `now < until`，**不问值** —— 平滑动画的中间位置本来就对不上任何固定值 |
 *
 * 区间这一条是 2026-11-17 补的：搜索定位用 smooth 滚动会连发几十个事件，
 * 旧的点判据只能认领第一个，剩下全被算成读者手势。
 *
 * @module dsh-palm/mobile/stream/scroll-claim
 */

/** 一次写入的回声认领窗口（毫秒）。 */
export const CLAIM_WINDOW_MS = 250
/** 值容差（像素）：再大会把读者的微小手势吃掉。 */
export const CLAIM_TOLERANCE_PX = 2

/** 认领快照。由调用方从 ref 组装，本模块不持有状态。 */
export interface ClaimSnapshot {
  /** 有没有一次「点」写入待认领。 */
  armed: boolean
  /** 那次写入的 scrollTop。 */
  value: number
  /** 那次写入的时刻。 */
  at: number
  /** 「区间」认领的截止时刻；0 = 没有区间认领。 */
  until: number
}

/**
 * 这个 scroll 事件是不是我们自己的回声？
 *
 * @param claim - 当前认领快照。
 * @param scrollTop - 事件里量到的位置。
 * @param now - 现在（毫秒）。测试注入。
 */
export function isClaimedEcho(claim: ClaimSnapshot, scrollTop: number, now: number): boolean {
  // 区间优先：平滑滚动期间位置每帧都在变，逐帧对值必然对不上。
  if (claim.until > now) return true
  if (!claim.armed) return false
  if (now - claim.at >= CLAIM_WINDOW_MS) return false
  return Math.abs(scrollTop - claim.value) <= CLAIM_TOLERANCE_PX
}
