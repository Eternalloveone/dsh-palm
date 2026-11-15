/**
 * 回合秒表的**显示层**：锚点定死 + 每帧重算。
 *
 * 2026-11-13 用户第 N 次反馈：「计时还是显示不准确，有的时候还是会跳变」。
 *
 * 老实现（追涨）的病：数据层每修一次（锚点变早 / 宿主时钟收敛），显示层就按 2 倍速
 * 追上去 —— 数字在屏幕上以两倍速滚动几秒到几十秒，用户看到的就是「跳变」。
 *
 * 业界共识（react-timer-hook / synced-countdown / MDN `Performance.now`）：
 * **锚点 + 差值、每帧重算、绝不累加、绝不让数据层修正影响已经显示出来的过程值。**
 *
 * 新口径：
 *   - 首帧：`anchor = now − target`，把"这一轮从哪算起"固定下来；
 *   - 之后：`显示值 = max(上次, now − anchor)` —— 重算（不是累加），
 *     单调时钟推进 ⇒ 天然匀速、天然不回退；
 *   - 数据层后来的 `target` **完全不参与** ⇒ 屏幕上绝对不动；
 *   - 唯一例外：刚上屏 1.5s 内、差 > 10s（用户还没记住这个数字）→ 重定锚一次；
 *   - 收工：`settleElapsed` 用宿主 `durationMs` 整体替换。
 *
 * @module dsh-palm/mobile/message-row/turn-clock
 */

/**
 * "刚上屏"窗口：这段时间内如果目标差得多，允许**重定锚一次**（一次性，不是追涨）。
 *
 * 会话刚打开时首帧常先拿到一个偏小的读数（行上还没有自己的 turnStartAt，用的是
 * 页面级锚点或 firstSeen 兜底），几十毫秒后真锚点到齐 —— 首帧的正确性优先于平滑。
 */
const FRESH_WINDOW_MS = 1_500
/** 差距超过这个数才算"明显错了"（只有首帧允许重定锚）。 */
const LARGE_GAP_MS = 10_000

/** 收工定格允许的对齐误差：超过就认 `durationMs`。 */
export const SETTLE_TOLERANCE_MS = 5_000

interface Sample {
  /** **首帧**时刻（宿主时钟域）。只用来判断"还在不在首帧窗口"，之后不再更新。 */
  first: number
  /** 上一次显示的值（毫秒）。 */
  value: number
  /** **定死的起点**（宿主时钟域）。之后所有读数都从它重算，不再改。 */
  anchor: number
  /** 是否已经用**权威锚点**对齐过（对齐只许发生一次）。 */
  aligned: boolean
  /**
   * 数据层这一次给的起点（宿主时钟域）。
   *
   * 真机 2026-11-14：一轮刚发出去时数据层给的是**上一轮**的起点（显示 43 分，实际 8 分），
   * 修正后起点整体后移。起点定死意味着"修正到不了屏幕"——所以这里留一份来源锚点，
   * 只在**它本身被纠正**时才重定锚；普通的心跳帧不动它。
   */
  sourceAnchor?: number
}

const samples = new Map<string, Sample>()

/**
 * 把"数据层算出来的读数"变成"这一帧该显示的数"。
 *
 * @param key - 回合标识（`sessionId:turn`）
 * @param target - 数据层算出的读数（毫秒）；**只在首帧、首帧窗口内、或起点被纠正时被采纳**
 * @param nowMs - 当前宿主时间（与 target 同源，单调推进）
 * @param settleAnchor - 这次给的 target 是否来自权威锚点（允许重定锚一次）
 * @param anchorMs - 数据层本次使用的**起点**（宿主时钟域）。给了才能识别"起点被纠正"。
 * @returns 这一帧要显示的值
 */
export function shownElapsed(
  key: string,
  target: number,
  nowMs: number,
  settleAnchor = false,
  anchorMs?: number,
): number {
  const safeTarget = Number.isFinite(target) ? Math.max(0, target) : 0
  const source = anchorMs !== undefined && Number.isFinite(anchorMs) ? anchorMs : undefined
  const sample = samples.get(key)
  if (sample === undefined) {
    samples.set(key, {
      first: nowMs,
      value: safeTarget,
      anchor: nowMs - safeTarget,
      aligned: settleAnchor,
      ...(source === undefined ? {} : { sourceAnchor: source }),
    })
    return safeTarget
  }
  // 数据层把起点改了（且改得多）：这不是追涨，是**纠正错值** —— 重定锚一次。
  // 两个方向都认：
  //   - 变晚（起点后移）：之前读到的是上一轮残留，显示偏大（真机 2026-11-14「43分34秒」）；
  //   - 变早（起点前移）：探针从日志尾巴取回了真正的 turn/start，显示偏小（真机「只有 10 秒、
  //     其实已经跑了 1 分 40 秒」）。
  // 两者都是"屏幕上不是真正的时间"，都必须改；只有几秒级的校准才保持匀速不动。
  if (source !== undefined && sample.sourceAnchor !== undefined && Math.abs(source - sample.sourceAnchor) > LARGE_GAP_MS) {
    samples.set(key, { ...sample, value: safeTarget, anchor: nowMs - safeTarget, aligned: true, sourceAnchor: source })
    return safeTarget
  }
  // 第一次拿到权威锚点：允许重定锚**一次**（修正错误起点，不是追涨）。
  if (settleAnchor && !sample.aligned) {
    samples.set(key, { ...sample, value: safeTarget, anchor: nowMs - safeTarget, aligned: true, ...(source === undefined ? {} : { sourceAnchor: source }) })
    return safeTarget
  }
  // 刚上屏且差得离谱：重定锚一次（用户还没记住这个数字）。
  if (nowMs - sample.first <= FRESH_WINDOW_MS && Math.abs(safeTarget - Math.max(0, nowMs - sample.anchor)) > LARGE_GAP_MS) {
    samples.set(key, { ...sample, value: safeTarget, anchor: nowMs - safeTarget, ...(source === undefined ? {} : { sourceAnchor: source }) })
    return safeTarget
  }
  // 只进不退：锚点定死之后 natural 本来就不会退，这里再兜一层（乱序帧 / 时钟回收）。
  //
  // 例外是**小回落**（≤ 5 秒）：那通常是宿主时钟收敛，真值就是 natural ——
  // 显示的必须是"现在 − 起点"，不许为了让数字好看而冻在偏大的值上（用户 2026-11-14：
  // 「这个时间明显不是真正的时间」）。回落超过 5 秒当作乱序/时钟异常，顶住不回退。
  const natural = Math.max(0, nowMs - sample.anchor)
  const drop = sample.value - natural
  const next = drop > 0 && drop <= SETTLE_TOLERANCE_MS ? natural : Math.max(sample.value, natural)
  samples.set(key, {
    ...sample,
    value: next,
    ...(sample.sourceAnchor === undefined && source !== undefined ? { sourceAnchor: source } : {}),
  })
  return next
}

/**
 * 收工定格：把宿主报的 `durationMs` 与屏幕上最后的值对齐。
 *
 * - 差 5 秒以内：取较大的（秒表不会在收工那一瞬往回缩）
 * - 差得多：**以 `durationMs` 为准**（那是宿主的真值）
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
  samples.set(key, { first: previous.first, value: settled, anchor: previous.anchor, aligned: previous.aligned })
  return settled
}

/** 清掉一轮的显示记录（回合结束、行卸载都该清）。 */
export function forgetElapsed(key: string): void {
  samples.delete(key)
}

/**
 * 清空所有记录（测试用；**也是切会话时必须调用的**）。
 *
 * 定锚记录是模块级全局：切会话不清就会沿用上一场的锚点，
 * 秒表读数变成上一场的时间（真机："不同会话计时一样"）。
 */
export function resetElapsedSamples(): void {
  samples.clear()
}
