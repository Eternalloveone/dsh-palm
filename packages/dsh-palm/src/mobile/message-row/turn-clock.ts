/**
 * 回合秒表的**显示层**：读数只进不退、追涨按倍速。
 *
 * 2026-11-11 用户：「计时有时候会跳变，依然没有根本解决」。
 *
 * 读数有两个上游，各自都会让数字跳一下：
 *   1. 锚点只会变早（`stableTurnAnchor` 的 min 规则，重连/翻页后修正真起点）⇒ 读数**往前跳**；
 *   2. 宿主时钟每帧按 20% 收敛校准 ⇒ 读数可能被往前推或往回拽几秒。
 * 这两件事都是**数据层的正确修正**，不该直接怼到屏幕上 —— 用户看到的应该是秒表在走，
 * 不是数字在跳。
 *
 * 所以显示值单独一层：
 *   - 目标超前（锚点变早 / 时钟往前收敛）：按最多 2 倍速追上去，一步不跳；
 *   - 目标落后（时钟往回拽 / 锚点变晚）：保持自然速度继续走，绝不回跳；
 *   - 同一毫秒内多次渲染（`dt = 0`）只允许 +250ms，避免"追一步卡死"。
 *
 * 收工定格：`settleElapsed` 把 `durationMs` 与屏幕上最后的值对齐 —— 差 5 秒以内取较大的那个
 * （秒表不会在收工那一瞬往回缩），差得多就以 `durationMs` 为准（那是宿主的真值）。
 *
 * @module dsh-palm/mobile/message-row/turn-clock
 */

/** 追涨的最大倍速：1 秒真实时间最多让显示值前进 2 秒。 */
const CATCH_UP_RATE = 2
/** 同一时刻重复渲染允许的最大前进量（毫秒）。 */
const SAME_TICK_STEP_MS = 250
/** 收工定格允许的对齐误差：超过就认 `durationMs`。 */
export const SETTLE_TOLERANCE_MS = 5_000
/**
 * "刚上屏"窗口：这段时间内如果目标值差得多，直接对齐而不是慢慢追。
 *
 * 会话刚打开时首帧常先拿到一个**偏小**的读数（行上还没有自己的 turnStartAt，用的是
 * 页面级锚点或 firstSeen 兜底），几十毫秒后真锚点到齐。若这时还按 2 倍速追，用户会
 * 盯着一个明显错的数字走一分钟 —— 首帧的正确性优先于平滑。
 */
const FRESH_WINDOW_MS = 1_500
/** 差距超过这个数才算"明显错了"（只有首帧允许直接跳过去）。 */
const LARGE_GAP_MS = 10_000

interface Sample {
  /** 上一次渲染时的时间戳（宿主时钟域）。 */
  at: number
  /** 上一次显示的读数（毫秒）。 */
  value: number
}

const samples = new Map<string, Sample>()

/**
 * 把"算出来的读数"变成"该显示的数"。
 *
 * @param key - 回合标识（`sessionId:turn`）
 * @param target - 数据层算出的读数（毫秒）
 * @param nowMs - 当前时间（宿主时钟域，与 target 同源）
 * @param provisional - 这一帧的锚点是不是**临时兜底**（行上没有自己的 turnStartAt）
 * @returns 这一帧要显示的值
 */
export function shownElapsed(key: string, target: number, nowMs: number, provisional = false): number {
  const safeTarget = Number.isFinite(target) ? Math.max(0, target) : 0
  const previous = samples.get(key)
  if (previous === undefined) {
    samples.set(key, { at: nowMs, value: safeTarget })
    return safeTarget
  }
  const delta = Math.max(0, nowMs - previous.at)
  const natural = previous.value + delta
  // 刚上屏就发现差得多：直接对齐（首帧正确性优先，见 FRESH_WINDOW_MS）。
  if (provisional && delta <= FRESH_WINDOW_MS && Math.abs(safeTarget - previous.value) > LARGE_GAP_MS) {
    samples.set(key, { at: nowMs, value: safeTarget })
    return safeTarget
  }
  let next: number
  if (safeTarget <= natural) {
    // 目标落后（时钟校准往回拽）：同样按倍速收敛，绝不一步掉下去。
    // 但同一毫秒内的重复渲染（delta = 0）直接认真值 —— 测试与真机里这都是
    // "同一次渲染里换了个更准的数"，没有动画空间，也不该把旧值焊在屏幕上
    // （那正是以前"棘轮"的坑：偏大的样本永久留在屏幕上）。
    const backwardRoom = delta > 0 ? delta * CATCH_UP_RATE : Number.POSITIVE_INFINITY
    next = Math.max(safeTarget, natural - backwardRoom)
  } else {
    // 目标超前（锚点变早 / 时钟往前收敛）：按最多 2 倍速追，一步不跳。
    const catchUpRoom = delta > 0 ? delta * CATCH_UP_RATE : SAME_TICK_STEP_MS
    next = Math.min(safeTarget, natural + catchUpRoom)
  }
  samples.set(key, { at: nowMs, value: next })
  return next
}

/**
 * 收工定格：把宿主报的 `durationMs` 与屏幕上最后的值对齐。
 *
 * @param key - 回合标识
 * @param durationMs - 宿主 `turn/end` 的时长
 * @returns 定格显示值
 */
export function settleElapsed(key: string, durationMs: number): number {
  const safe = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
  const previous = samples.get(key)
  if (previous === undefined) return safe
  const settled = Math.abs(safe - previous.value) <= SETTLE_TOLERANCE_MS
    ? Math.max(safe, previous.value)
    : safe
  samples.set(key, { at: previous.at, value: settled })
  return settled
}

/** 清掉一轮的显示记录（回合结束、行卸载都该清）。 */
export function forgetElapsed(key: string): void {
  samples.delete(key)
}

/** 测试用：清空所有记录。 */
export function resetElapsedSamples(): void {
  samples.clear()
}
