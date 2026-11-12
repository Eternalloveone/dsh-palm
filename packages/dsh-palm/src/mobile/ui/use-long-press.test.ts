// @vitest-environment jsdom
/**
 * 长按 hook 的测试。
 *
 * 重点是三条容易做错的：滑动要取消、松手要取消、长按之后的 click 要被吞掉。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { LONG_PRESS_MS, LONG_PRESS_SLOP_PX, LONG_PRESS_SWALLOW_MS, useLongPress } from './use-long-press.ts'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

const pointer = (x = 0, y = 0) => ({ clientX: x, clientY: y }) as unknown as React.PointerEvent
const click = () => {
  const stopPropagation = vi.fn()
  const preventDefault = vi.fn()
  return { event: { preventDefault, stopPropagation } as unknown as React.MouseEvent, stopPropagation, preventDefault }
}

describe('长按触发', () => {
  it('按住够久才触发', () => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress))
    result.current.onPointerDown(pointer())
    expect(onLongPress).not.toHaveBeenCalled()
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it('提前松手不触发', () => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress))
    result.current.onPointerDown(pointer())
    vi.advanceTimersByTime(LONG_PRESS_MS - 50)
    result.current.onPointerUp(pointer())
    vi.advanceTimersByTime(200)
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('滑出阈值当滚动，取消长按', () => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress))
    result.current.onPointerDown(pointer(0, 0))
    result.current.onPointerMove(pointer(LONG_PRESS_SLOP_PX + 5, 0))
    vi.advanceTimersByTime(LONG_PRESS_MS + 50)
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('小幅抖动不算滑动', () => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress))
    result.current.onPointerDown(pointer(0, 0))
    result.current.onPointerMove(pointer(3, 4))
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it('离开/取消也清定时器', () => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress))
    result.current.onPointerDown(pointer())
    result.current.onPointerLeave()
    vi.advanceTimersByTime(LONG_PRESS_MS + 50)
    expect(onLongPress).not.toHaveBeenCalled()
  })
})

describe('长按之后的 click 要吞掉', () => {
  it('触发过就 preventDefault + stopPropagation', () => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress))
    result.current.onPointerDown(pointer())
    vi.advanceTimersByTime(LONG_PRESS_MS)
    const { event, stopPropagation, preventDefault } = click()
    result.current.onClickCapture(event)
    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()
  })

  it('只吞一次（下一次正常点击放行）', () => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress))
    result.current.onPointerDown(pointer())
    vi.advanceTimersByTime(LONG_PRESS_MS)
    result.current.onClickCapture(click().event)
    const second = click()
    result.current.onClickCapture(second.event)
    expect(second.stopPropagation).not.toHaveBeenCalled()
  })

  it('没长按过就放行', () => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress))
    const { event, stopPropagation } = click()
    result.current.onClickCapture(event)
    expect(stopPropagation).not.toHaveBeenCalled()
  })

  it('长按之后超过时间窗的 click 要放行（动作条里的按钮靠这条能用）', () => {
    // 真机踩过：无限期吞掉的版本，长按展开动作条后点「删除」第一下没反应。
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress))
    result.current.onPointerDown(pointer())
    vi.advanceTimersByTime(LONG_PRESS_MS)
    vi.advanceTimersByTime(LONG_PRESS_SWALLOW_MS + 50)
    const { event, stopPropagation } = click()
    result.current.onClickCapture(event)
    expect(stopPropagation).not.toHaveBeenCalled()
  })
})

describe('关闭时不做事', () => {
  it('onLongPress 为空 → handler 全空转', () => {
    const { result } = renderHook(() => useLongPress(undefined))
    result.current.onPointerDown(pointer())
    vi.advanceTimersByTime(LONG_PRESS_MS + 50)
    const { event, stopPropagation } = click()
    result.current.onClickCapture(event)
    expect(stopPropagation).not.toHaveBeenCalled()
  })

  it('enabled=false → 即使有回调也不触发', () => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress, false))
    result.current.onPointerDown(pointer())
    vi.advanceTimersByTime(LONG_PRESS_MS + 50)
    expect(onLongPress).not.toHaveBeenCalled()
  })
})
