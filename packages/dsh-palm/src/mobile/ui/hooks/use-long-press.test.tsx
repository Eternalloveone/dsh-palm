// @vitest-environment jsdom
/**
 * useLongPress 的行为契约（W2-5）。
 *
 * 这些用例是抽 hook 的真正收益：ChatView 里那 50 行以前只能靠真机手动点，
 * 现在「500ms 后触发一次」「移动作废」「卸载清计时器」都是可断言的。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useLongPress } from './use-long-press.ts'

/** 造一个可当作 Element 用的目标。 */
function target(): Element {
  return document.createElement('div')
}

describe('useLongPress', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('按住 delayMs 后触发一次，并带回目标与坐标', () => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress }))
    const element = target()

    result.current.start(element, 12, 34)
    expect(onLongPress).not.toHaveBeenCalled()

    vi.advanceTimersByTime(500)
    expect(onLongPress).toHaveBeenCalledTimes(1)
    expect(onLongPress).toHaveBeenCalledWith(element, 12, 34)

    // 触发后不再重复
    vi.advanceTimersByTime(1_000)
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it('提前 cancel 就不触发（移动 / 抬起都走这条路）', () => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress }))

    result.current.start(target(), 0, 0)
    vi.advanceTimersByTime(499)
    result.current.cancel()
    vi.advanceTimersByTime(2_000)

    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('重复 start 只保留最后一次（顺手修掉旧的计时器泄漏）', () => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress }))
    const first = target()
    const second = target()

    result.current.start(first, 1, 1)
    vi.advanceTimersByTime(300)
    result.current.start(second, 2, 2)
    vi.advanceTimersByTime(500)

    expect(onLongPress).toHaveBeenCalledTimes(1)
    expect(onLongPress).toHaveBeenCalledWith(second, 2, 2)
  })

  it('卸载后计时器不再触发', () => {
    const onLongPress = vi.fn()
    const { result, unmount } = renderHook(() => useLongPress({ onLongPress }))

    result.current.start(target(), 5, 5)
    unmount()
    vi.advanceTimersByTime(2_000)

    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('回调换了新引用也不会丢失（ref 保存）', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result, rerender } = renderHook(
      ({ handler }) => useLongPress({ onLongPress: handler }),
      { initialProps: { handler: first } },
    )

    result.current.start(target(), 0, 0)
    rerender({ handler: second })
    vi.advanceTimersByTime(500)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
