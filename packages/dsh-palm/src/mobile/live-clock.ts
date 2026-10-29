/**
 * 秒表心跳：一个 1 Hz 的计数器，谁要"每秒重算一次"就订阅它。
 *
 * 以前每个正在跑的过程条各自挂一个 `setInterval`。PWA 进后台时浏览器把它们冻住，
 * 回到前台又没有谁重新起搏（`running` 没变、effect 不会重建），读数就定在最后一帧，
 * 非得重进一次会话（行重建）才恢复。心跳收到一处之后，回前台重建一次就够；更重要的
 * 是它每秒变一次、会出现在那一行的 props 里 —— 于是即使那一行自己的定时器没了，
 * `memo` 也挡不住它重渲染。
 *
 * 读数本身永远在渲染时取墙钟（`Date.now()`）：这个计数器只负责"踢一脚重渲染"，
 * 不参与任何时间运算。
 *
 * 回前台有三重保险，它们失效的方式各不相同（安卓 PWA 实测：定时器被冻结后不保证
 * 自己回来，连 `visibilitychange` 都不一定派发，于是秒表定在切走那一刻的值）：
 *  1. effect 重建 —— `active` 从 false 翻回 true 时立即 beat；
 *  2. `visibilitychange` 补拍；
 *  3. 动画帧探针 —— 屏幕亮着就一定有帧，前台每帧只比一次墙钟（不 setState），
 *     发现两拍没跳就补一拍。后台浏览器不派发帧，所以不费电。
 *
 * @module dsh-palm/mobile/live-clock
 */
import { useEffect, useState } from 'react'
import { onVisibilityChange } from './foreground.ts'

/** 心跳间隔（毫秒）。秒表读秒，1 秒刚好。 */
export const LIVE_CLOCK_TICK_MS = 1_000

/** 两拍没跳就算被冻住过：正常 1 秒一跳，超过这个间隔补拍一次。 */
const STALE_AFTER_MS = LIVE_CLOCK_TICK_MS * 2

/**
 * 订阅 1 Hz 心跳。
 *
 * @param active - 为假时不起搏（页面不可见、没有活跃回合）。
 * @returns 每秒加一的计数器；它只用来触发重渲染，不是时间。
 */
export function useLiveClock(active: boolean): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    let lastBeatAt = Date.now()
    const beat = (): void => {
      lastBeatAt = Date.now()
      setTick(previous => previous + 1)
    }
    beat()
    const id = setInterval(beat, LIVE_CLOCK_TICK_MS)
    // 动画帧探针：后台不派发帧，所以"下一次回调"天然就是"页面重新可见"的时刻。
    // 正常情况这里一次 setState 都不发，只有墙钟走了两拍以上才补一次。
    let frame = 0
    if (typeof requestAnimationFrame === 'function') {
      const probe = (): void => {
        if (Date.now() - lastBeatAt > STALE_AFTER_MS) beat()
        frame = requestAnimationFrame(probe)
      }
      frame = requestAnimationFrame(probe)
    }
    // 后台冻结会把定时器停掉，而且恢复时它不会自己回来：回到前台补一拍并重建。
    const stop = onVisibilityChange((visible) => { if (visible) beat() })
    return () => {
      clearInterval(id)
      if (frame !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
      stop()
    }
  }, [active])
  return tick
}
