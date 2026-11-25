// @vitest-environment jsdom
/**
 * 虚拟窗口（`useRowWindow`）的契约 —— 2026-11-18「整屏空白」之后的形状。
 *
 * 旧形状是"窗口停在历史中段 + 上下两个估值占位"，于是滚动条总高是算出来的，读者能
 * 滚进一段没有行元素的虚空；判据又靠这份估值，一错就永远出不来。新形状只有一条铁律：
 *
 *   **下方永远是真实内容**（`end === total`、`bottomSpacer === 0`），没挂载的历史只在
 *   上方；挂载按"一屏一次"补齐，并按**浏览器算出的真实高差**补偿滚动条。
 *
 * 这里的假滚动条据此建模：`scrollHeight = 已挂载行数 × 真实行高 + 上方占位`，且真实
 * 行高(120)与估值(100)故意不同 —— 估值与实测有差，补偿才测得出来。
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WINDOW_MIN_ROWS, WINDOW_RENDER_ROWS, useRowWindow } from './use-row-window.ts'

/** 估值：一行 100px。 */
const ROW_ESTIMATE = 100
/** 真实行高：120px（估值偏小 20px，正好检验补偿）。 */
const ROW_REAL = 120
const VIEWPORT = 600

interface FakeScroller extends HTMLDivElement {
  __derive: () => { rows: number; spacer: number }
}

/** 假滚动条：几何由"这一帧挂了哪些行 + 上方占位"推出来，和真浏览器同构。 */
function fakeScroller(): FakeScroller {
  const element = document.createElement('div') as FakeScroller
  element.__derive = () => ({ rows: 0, spacer: 0 })
  Object.defineProperty(element, 'clientHeight', { get: () => VIEWPORT })
  Object.defineProperty(element, 'scrollHeight', {
    get: () => {
      const { rows, spacer } = element.__derive()
      return rows * ROW_REAL + spacer
    },
  })
  element.scrollTop = 0
  return element
}

interface Props {
  total: number
  scroller: HTMLElement | null
  focusIndex?: number
}

const renderWindow = (initial: Props) =>
  renderHook(
    (props: Props) => {
      const value = useRowWindow({
        total: props.total,
        focusIndex: props.focusIndex ?? -1,
        sessionKey: 'session-a',
        estimate: () => ROW_ESTIMATE,
        scroller: props.scroller,
        keyOf: index => `row-${index}`,
        // 与线上一致：补偿交给滚动所有者（`scrollHandle.scrollBy`）。
        onGeometryShift: delta => {
          if (props.scroller !== null) props.scroller.scrollTop += delta
        },
      })
      // 渲染期把这一帧的几何交给假滚动条：layout effect 里读到的就是真几何。
      if (props.scroller !== null) {
        ;(props.scroller as FakeScroller).__derive = () => ({
          rows: value.end - value.start,
          spacer: value.topSpacer,
        })
      }
      return value
    },
    { initialProps: initial },
  )

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('虚拟窗口：下方永远是真实内容', () => {
  it('短会话整份渲染，不留任何占位', () => {
    const scroller = fakeScroller()
    const { result } = renderWindow({ total: 10, scroller })
    expect(result.current).toEqual({ start: 0, end: 10, topSpacer: 0, bottomSpacer: 0 })
  })

  it('长会话首帧只挂尾部一屏，占位只在上方', () => {
    const { result } = renderWindow({ total: 90, scroller: fakeScroller() })
    expect(result.current.end).toBe(90)
    expect(result.current.bottomSpacer).toBe(0)
    expect(result.current.start).toBe(90 - WINDOW_MIN_ROWS)
    expect(result.current.topSpacer).toBe((90 - WINDOW_MIN_ROWS) * ROW_ESTIMATE)
  })

  it('新增行只往下长：end 跟着 total 走，下方始终零占位', () => {
    const scroller = fakeScroller()
    const { result, rerender } = renderWindow({ total: 60, scroller })
    act(() => rerender({ total: 61, scroller }))
    expect(result.current.end).toBe(61)
    expect(result.current.bottomSpacer).toBe(0)
  })

  it('空闲时一屏一屏补齐，最后整份渲染（占位归零）', () => {
    const scroller = fakeScroller()
    const { result } = renderWindow({ total: 60, scroller })
    const first = result.current.start
    act(() => { vi.advanceTimersByTime(150) })
    expect(result.current.start).toBe(first - WINDOW_RENDER_ROWS)
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(result.current.start).toBe(0)
    expect(result.current.topSpacer).toBe(0)
    expect(result.current.end).toBe(60)
  })

  it('焦点行（搜索定位）在挂载范围外时整份挂上', () => {
    const { result } = renderWindow({ total: 90, scroller: fakeScroller(), focusIndex: 5 })
    expect(result.current.start).toBe(0)
    expect(result.current.topSpacer).toBe(0)
  })
})

describe('虚拟窗口：读者不会被拽走', () => {
  it('往上滑到上沿就当场再挂一屏（不等他滑进虚空）', () => {
    const scroller = fakeScroller()
    const { result } = renderWindow({ total: 90, scroller })
    const before = result.current.start
    scroller.scrollTop = 100
    act(() => { scroller.dispatchEvent(new Event('scroll')) })
    expect(result.current.start).toBe(before - WINDOW_RENDER_ROWS)
  })

  it('挂载更多行时按真实高差补偿：读者眼中的画面不动', () => {
    const scroller = fakeScroller()
    const { result } = renderWindow({ total: 60, scroller })
    // 停在历史中段（离底远 > WINDOW_FOLLOW_PX），此时上方还有 28 行没挂。
    scroller.scrollTop = 1_000
    const heightBefore = scroller.scrollHeight
    act(() => { vi.advanceTimersByTime(150) })
    const heightAfter = scroller.scrollHeight
    expect(heightAfter).toBeGreaterThan(heightBefore)
    expect(result.current.start).toBe(60 - WINDOW_MIN_ROWS - WINDOW_RENDER_ROWS)
    // 上方新插进来的那几行占的真实高度，全部补进 scrollTop。
    expect(scroller.scrollTop).toBe(1_000 + (heightAfter - heightBefore))
  })

  it('贴底时补齐只保持贴底，不把读者推到中间', () => {
    const scroller = fakeScroller()
    renderWindow({ total: 60, scroller })
    scroller.scrollTop = scroller.scrollHeight - VIEWPORT
    act(() => { vi.advanceTimersByTime(150) })
    expect(scroller.scrollTop).toBe(scroller.scrollHeight - VIEWPORT)
  })
})
