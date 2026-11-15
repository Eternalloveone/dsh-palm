// @vitest-environment jsdom
/**
 * 虚拟窗口的两条不变量（2026-11-15 真机回归）：
 *
 * 1. **贴底必跟随尾部**：读者在底部时新增的行必须自动进窗口 —— 锚死在一个数字上
 *    时，后续新增行落到窗口外、DOM 里干脆没有它们，用户看到的是"正文不出来"。
 * 2. **定锚不被渲染打断**：调用点每次渲染都会传一个新的 `estimate`；它若在依赖里，
 *    效果就会重建并清掉 80ms 的定锚计时器，流式期间（每 16ms 一次渲染）永远等不到
 *    空闲，锚点从此冻住 —— 这正是第 1 条被破坏的实际路径。
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WINDOW_BUFFER_ROWS, WINDOW_RENDER_ROWS, useRowWindow } from './use-row-window.ts'

/** 一屏 600px、每行 100px 的假滚动容器（jsdom 没有布局，scrollTop 自己实现）。 */
function fakeScroller(): HTMLDivElement {
  const element = document.createElement('div')
  let top = 0
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => { top = value },
  })
  document.body.appendChild(element)
  return element
}

const ROW_HEIGHT = 100
const VIEWPORT = 600

/** 滚到 `rows` 行的内容底部（视口底边贴住内容底边）。 */
function scrollToBottom(scroller: HTMLElement, rows: number): void {
  scroller.scrollTop = rows * ROW_HEIGHT - VIEWPORT
}

interface Props {
  total: number
  scroller: HTMLElement | null
  sessionKey: string
  focusIndex: number
}

const renderWindow = (initial: Props) =>
  renderHook(
    // estimate 身份每次渲染都换（与真实调用点一致：chat-rows 传内联箭头）。
    (props: Props) => useRowWindow({ ...props, estimate: () => ROW_HEIGHT }),
    { initialProps: initial },
  )

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('虚拟窗口：贴底必跟随尾部', () => {
  it('贴底后新增 30 行，窗口仍然渲染到最后一行', () => {
    const scroller = fakeScroller()
    const { rerender, result } = renderWindow({ total: 60, scroller, sessionKey: 's1', focusIndex: -1 })
    // 先滚到底：定锚把读者读成"在尾部"。
    act(() => { scrollToBottom(scroller, 60) })
    act(() => { scroller.dispatchEvent(new Event('scroll')) })
    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current.end).toBe(60)
    // 流式增长 30 行：没有新的滚动事件，只有渲染。
    for (let total = 61; total <= 90; total += 1) {
      act(() => { rerender({ total, scroller, sessionKey: 's1', focusIndex: -1 }) })
    }
    act(() => { vi.advanceTimersByTime(200) })
    // 最后一行必须在窗口里（DOM 里才有它）。
    expect(result.current.end).toBe(90)
    // 底部不需要占位：没有一行被挡在窗口外。
    expect(result.current.bottomSpacer).toBe(0)
  })

  it('连续渲染不会取消定锚：滚到中段后 80ms 仍能定到那一行', () => {
    const scroller = fakeScroller()
    const { rerender, result } = renderWindow({ total: 60, scroller, sessionKey: 's1', focusIndex: -1 })
    act(() => { scroller.scrollTop = 2_001 }) // 落在第 20 行
    act(() => { scroller.dispatchEvent(new Event('scroll')) })
    // 定锚窗口内连着重渲染三次（流式形态）。
    for (let i = 0; i < 3; i += 1) {
      act(() => { rerender({ total: 60, scroller, sessionKey: 's1', focusIndex: -1 }) })
    }
    act(() => { vi.advanceTimersByTime(200) })
    const expectedStart = 20 - WINDOW_BUFFER_ROWS
    expect(result.current.start).toBe(expectedStart)
    expect(result.current.end).toBe(expectedStart + WINDOW_RENDER_ROWS + WINDOW_BUFFER_ROWS * 2)
  })
})
