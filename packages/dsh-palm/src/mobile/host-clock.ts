/**
 * 宿主时钟（架构层修法）：秒表读数只许在**宿主时间域**里做减法。
 *
 * 老口径（2026-11-07 之前）：
 *   `读数 = Date.now() + clockOffsetMs − 宿主锚点`
 * 其中 `clockOffsetMs` 是「宿主帧时间 − 收帧时的 Date.now()」在 24 个样本里取最大值。
 * 这条式子有三个躲不开的坑，最终都表现成用户说的"计时变到一个莫名其妙的时间，
 * 得重进会话才恢复"：
 *
 *   1. `Date.now()` 是手机**墙钟**。NTP 校时、跨时区、系统把时间往前/后拨一下，
 *      读数当场跳变；而锚点是宿主时间，不跟着动 ⇒ 误差直接叠到显示值上。
 *   2. 偏移是**过去某一刻**估出来的。锚点用旧偏移、现在用新偏移，两者不同源，
 *      差值就是误差 —— 而"重进会话"会重新估一次偏移，于是"重进就好了"。
 *   3. `Math.max` 取最"快"的样本，一旦某个快包出现就把偏移永久顶高，读数偏大；
 *      后面真值追上来时要一口气跨过去，屏幕上就是突然跳几秒。
 *
 * 新口径：用一个**单调本地时钟**（`performance.now()`）把宿主时间往前推：
 *
 *   `hostNow = 基准宿主时间 + (performance.now() − 基准时刻)`
 *   `读数 = hostNow − 宿主锚点`
 *
 * 减法的两头都在宿主时间域里，手机墙钟**完全不参与** ⇒ 墙钟怎么跳都不影响读数；
 * 每收到一帧就用它的宿主时间戳校准一次，偏差只做小幅收敛、不做大跳，乱序/陈旧帧丢弃。
 *
 * @module dsh-palm/mobile/host-clock
 */

/** 单调时钟来源（测试里可注入）。 */
export type MonoSource = () => number

/** 单次校准最多吸收多少偏差的比例（越大收敛越快、越容易看出跳；0.2 = 5 帧基本对齐）。 */
const CONVERGE_RATIO = 0.2

/** 超过这个偏差的"过去帧"直接丢弃：多半是乱序或重放，不该把读数往回拽。 */
const STALE_TOLERANCE_MS = 1_500

export interface HostClock {
  /** 用一帧的宿主时间戳校准（`event.time`）。非有限值忽略。 */
  sync(hostMs: number): void
  /**
   * 当前宿主时间（毫秒）。**还没校准过时返回 undefined** —— 调用方该退回
   * "不显示秒表"，而不是拿 0 算出个荒唐的数（旧代码正是这么显示 0 的）。
   */
  now(): number | undefined
  /** 是否已校准。 */
  readonly synced: boolean
}

/**
 * 造一个宿主时钟。
 *
 * @param mono - 单调时钟（默认 `performance.now()`；不可用时退回 `Date.now()`，
 *   但会打一次 warning，因为那就退化成老行为了）。
 * @param convergeRatio - 每次校准吸收偏差的比例。
 */
export function createHostClock(mono?: MonoSource, convergeRatio = CONVERGE_RATIO): HostClock {
  const source: MonoSource = mono ?? (() => {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now()
    return Date.now()
  })
  let baseHost = 0
  let baseMono = 0
  let synced = false

  const nowAt = (monoNow: number): number => baseHost + (monoNow - baseMono)

  return {
    get synced(): boolean {
      return synced
    },
    now(): number | undefined {
      if (!synced) return undefined
      return nowAt(source())
    },
    sync(hostMs: number): void {
      if (typeof hostMs !== 'number' || !Number.isFinite(hostMs)) return
      const monoNow = source()
      if (!synced) {
        baseHost = hostMs
        baseMono = monoNow
        synced = true
        return
      }
      const estimate = nowAt(monoNow)
      const delta = hostMs - estimate
      // 帧说宿主比我们估计的更新：以帧为准（我们漂了，或这一帧更新）。这是正向修正，
      // 直接贴合，不制造"往回跳"。
      if (delta > 0) {
        baseHost = hostMs
        baseMono = monoNow
        return
      }
      // 落后太多：乱序/重放/陈旧帧，丢掉。让读数保持单调。
      if (delta < -STALE_TOLERANCE_MS) return
      // 容差内：多半是这一帧慢到了（网络抖动）。按比例吸收，不跳。
      baseHost = estimate + delta * convergeRatio
      baseMono = monoNow
    },
  }
}
