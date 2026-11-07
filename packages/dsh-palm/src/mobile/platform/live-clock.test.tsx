// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { LIVE_CLOCK_TICK_MS, useLiveClock } from './live-clock.ts'

describe('live clock ticker', () => {
  it('每秒加一，回到前台时立刻补一拍', () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useLiveClock(true))
      const mounted = result.current
      act(() => { vi.advanceTimersByTime(3 * LIVE_CLOCK_TICK_MS) })
      expect(result.current).toBe(mounted + 3)

      // 后台冻结：定时器停了。回到前台（visibilitychange → visible）补一拍，
      // 让"这一秒该重算了"这件事不依赖那个可能已经死掉的定时器。
      const beforeWake = result.current
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
      expect(result.current).toBe(beforeWake + 1)

      // 重建出来的定时器接着走。
      act(() => { vi.advanceTimersByTime(LIVE_CLOCK_TICK_MS) })
      expect(result.current).toBe(beforeWake + 2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('回前台时连 visibilitychange 都不派发，动画帧探针也会补一拍', () => {
    // 安卓 PWA 实测：定时器被冻结后不保证自己回来，visibilitychange 也可能不派发，
    // 于是秒表定在切走那一刻。动画帧是"屏幕亮着就一定有"的信号，靠它自愈。
    vi.useFakeTimers()
    const callbacks: FrameRequestCallback[] = []
    const realRaf = globalThis.requestAnimationFrame
    const realCaf = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
      callbacks.push(callback)
      return callbacks.length
    }) as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = ((): void => {}) as typeof cancelAnimationFrame
    try {
      const { result } = renderHook(() => useLiveClock(true))
      const before = result.current
      // 后台：定时器一次都没跑、visibilitychange 也没来，墙钟却走了两分钟。
      vi.setSystemTime(Date.now() + 120_000)
      // 回前台：浏览器画出第一帧。
      act(() => {
        for (const callback of callbacks.splice(0)) callback(0)
      })
      expect(result.current).toBe(before + 1)
    } finally {
      globalThis.requestAnimationFrame = realRaf
      globalThis.cancelAnimationFrame = realCaf
      vi.useRealTimers()
    }
  })
  it('不活跃时不动（页面不可见 / 没有活跃回合）', () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useLiveClock(false))
      const mounted = result.current
      act(() => { vi.advanceTimersByTime(5 * LIVE_CLOCK_TICK_MS) })
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
      expect(result.current).toBe(mounted)
    } finally {
      vi.useRealTimers()
    }
  })
})
