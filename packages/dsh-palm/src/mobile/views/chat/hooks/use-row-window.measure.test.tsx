// @vitest-environment jsdom
/**
 * 「测量不能把自己顶跳」的接线测试。
 *
 * 账本（`row-metrics`）只负责算出"该补多少"；补不补、补到哪，由这一层交给滚动层。
 * 这条链路断掉的现场是：视口上方某行被量出更准的高度 → 内容整体下移 → 用户看到
 * 正文往上"跳"一下（真机上就是"滚动时内容突然跳半屏"）。
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRowWindow, WINDOW_MIN_ROWS } from './use-row-window.ts'

/** 假 ResizeObserver：记下实例，测试里手动触发一次回调。 */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  readonly targets: Element[] = []
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this)
  }
  observe(target: Element): void { this.targets.push(target) }
  unobserve(): void {}
  disconnect(): void {}
  fire(): void {
    const entries = this.targets.map(target => ({ target } as unknown as ResizeObserverEntry))
    this.callback(entries, this as unknown as ResizeObserver)
  }
}

const ROW = 100

function scrollerWith(rows: Array<{ key: string; height: number }>): HTMLDivElement {
  const element = document.createElement('div')
  let top = 0
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => { top = value },
  })
  for (const row of rows) {
    const node = document.createElement('div')
    node.setAttribute('data-row-key', row.key)
    Object.defineProperty(node, 'offsetHeight', { configurable: true, value: row.height })
    element.append(node)
  }
  document.body.appendChild(element)
  return element
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeResizeObserver.instances = []
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const noop = () => undefined

describe('虚拟窗口：实测高度的补偿接线', () => {
  it('视口上方的行被测高时，把差值交给滚动层（正数=要把 scrollTop 加上去）', () => {
    const scroller = scrollerWith([{ key: 'k0', height: ROW }])
    const shifts: number[] = []
    renderHook(() => useRowWindow({
      total: 60,
      focusIndex: -1,
      sessionKey: 's1',
      estimate: () => ROW,
      scroller,
      keyOf: index => `k${index}`,
      onGeometryShift: delta => { shifts.push(delta) },
    }), { initialProps: {} })
    // 贴尾态下锚点在 60-18-6=36 行，k0 在它上面。
    const node = scroller.querySelector('[data-row-key="k0"]') as HTMLElement
    Object.defineProperty(node, 'offsetHeight', { configurable: true, value: 600 })
    act(() => {
      for (const observer of FakeResizeObserver.instances) observer.fire()
    })
    expect(shifts).toEqual([500])
  })

  it('没接补偿回调时只记账、不动画面（单测/其它列表的老路径）', () => {
    const scroller = scrollerWith([{ key: 'k0', height: ROW }])
    renderHook(() => useRowWindow({
      total: 60,
      focusIndex: -1,
      sessionKey: 's1',
      estimate: () => ROW,
      scroller,
      keyOf: index => `k${index}`,
    }))
    const node = scroller.querySelector('[data-row-key="k0"]') as HTMLElement
    Object.defineProperty(node, 'offsetHeight', { configurable: true, value: 600 })
    expect(() => {
      act(() => {
        for (const observer of FakeResizeObserver.instances) observer.fire()
      })
    }).not.toThrow()
  })

  it('短会话不窗口化、也不量（维持既有行为）', () => {
    const scroller = scrollerWith([{ key: 'k0', height: ROW }])
    const shifts: number[] = []
    const { result } = renderHook(() => useRowWindow({
      total: WINDOW_MIN_ROWS - 1,
      focusIndex: -1,
      sessionKey: 's1',
      estimate: () => ROW,
      scroller,
      keyOf: index => `k${index}`,
      onGeometryShift: delta => { shifts.push(delta) },
    }))
    expect(result.current.start).toBe(0)
    expect(result.current.topSpacer).toBe(0)
    expect(shifts).toEqual([])
  })
})

it('占位高度来自账本：估 100 量到 600 后，顶部占位跟着变', () => {
  const scroller = scrollerWith([{ key: 'k0', height: ROW }])
  const { result } = renderHook(() => useRowWindow({
    total: 60,
    focusIndex: 30,
    sessionKey: 's1',
    estimate: () => ROW,
    scroller,
    keyOf: index => `k${index}`,
    onGeometryShift: noop,
  }))
  const before = result.current.topSpacer
  const node = scroller.querySelector('[data-row-key="k0"]') as HTMLElement
  Object.defineProperty(node, 'offsetHeight', { configurable: true, value: 600 })
  act(() => {
    for (const observer of FakeResizeObserver.instances) observer.fire()
  })
  expect(result.current.topSpacer).toBe(before + 500)
})
