// @vitest-environment jsdom
import { render } from '@testing-library/react'
import type { Ref } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStickToBottom, type ChatScrollHandle } from './use-stick-to-bottom.ts'

/** Expose the hook to the test through a mutable slot. */
let handle: ChatScrollHandle | undefined

function Harness() {
  handle = useStickToBottom()
  return <div ref={handle.scrollRef as Ref<HTMLDivElement>} className="chat-scroll" />
}

afterEach(() => {
  handle = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useStickToBottom', () => {
  it('pins the state machine when scrolling to the bottom', () => {
    render(<Harness />)
    if (handle === undefined) throw new Error('hook did not run')
    handle.scrollToBottom()
    // `pin` marks the reader as following the tail (scroll-machine contract).
    expect(handle.scrollStateRef.current.followed).toBe(true)
  })

  it('claims a programmatic write only when it actually moves', () => {
    render(<Harness />)
    if (handle === undefined) throw new Error('hook did not run')
    const el = handle.scrollRef.current
    if (el === undefined) throw new Error('container missing')
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 500 })
    el.scrollTop = 100
    handle.setScrollTopProgrammatically(el, 400)
    expect(el.scrollTop).toBe(400)
    expect(handle.programmaticScrollRef.current).toBe(true)
    expect(handle.programmaticValueRef.current).toBe(400)
    expect(handle.scrollTopRef.current).toBe(400)

    // No movement: no claim (a stale claim would eat the reader's next gesture).
    handle.programmaticScrollRef.current = false
    handle.setScrollTopProgrammatically(el, 400)
    expect(handle.programmaticScrollRef.current).toBe(false)
  })

  it('scrollToTarget 走即时写入：只认领这一次、不留区间', () => {
    render(<Harness />)
    if (handle === undefined) throw new Error('hook did not run')
    const el = handle.scrollRef.current
    if (el === undefined) throw new Error('container missing')
    Object.defineProperties(el, {
      scrollHeight: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 500 },
    })
    handle.scrollToTarget(200)
    expect(el.scrollTop).toBe(200)
    expect(handle.programmaticScrollRef.current).toBe(true)
    expect(handle.programmaticUntilRef.current).toBe(0)
    expect(handle.scrollTopRef.current).toBe(200)
  })

  it('scrollToTarget 平滑动画中途：区间认领在，中途位置也算回声', () => {
    // rAF 不执行：模拟动画还没走完
    vi.stubGlobal('requestAnimationFrame', () => 0)
    render(<Harness />)
    if (handle === undefined) throw new Error('hook did not run')
    const el = handle.scrollRef.current
    if (el === undefined) throw new Error('container missing')
    Object.defineProperties(el, {
      scrollHeight: { configurable: true, value: 4_000 },
      clientHeight: { configurable: true, value: 500 },
    })
    el.scrollTo = ((options: ScrollToOptions) => { el.scrollTop = options.top ?? 0 }) as typeof el.scrollTo
    handle.scrollToTarget(3_000, { smooth: true })
    expect(el.scrollTop).toBe(3_000)
    // 动画期间：区间覆盖任意中间位置
    expect(handle.programmaticUntilRef.current).toBeGreaterThan(Date.now() - 1)
  })

  it('scrollToTarget 落点后交回点认领', () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0 })
    render(<Harness />)
    if (handle === undefined) throw new Error('hook did not run')
    const el = handle.scrollRef.current
    if (el === undefined) throw new Error('container missing')
    Object.defineProperties(el, {
      scrollHeight: { configurable: true, value: 4_000 },
      clientHeight: { configurable: true, value: 500 },
    })
    el.scrollTo = ((options: ScrollToOptions) => { el.scrollTop = options.top ?? 0 }) as typeof el.scrollTo
    handle.scrollToTarget(3_000, { smooth: true })
    expect(handle.programmaticUntilRef.current).toBe(0)
    expect(handle.programmaticScrollRef.current).toBe(true)
    expect(handle.programmaticValueRef.current).toBe(3_000)
    expect(handle.scrollTopRef.current).toBe(3_000)
  })

  it('scrollBy 相对挪动，并把这一写认领成程序化（补偿不会被当成读者手势）', () => {
    render(<Harness />)
    if (handle === undefined) throw new Error('hook did not run')
    const el = handle.scrollRef.current
    if (el === undefined) throw new Error('container missing')
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 1_000 })
    el.scrollTop = 100
    handle.scrollBy(40)
    expect(el.scrollTop).toBe(140)
    expect(handle.programmaticScrollRef.current).toBe(true)
    expect(handle.programmaticValueRef.current).toBe(140)
    expect(handle.scrollTopRef.current).toBe(140)
  })

  it('gapPx / noteContentHeight / firstRowIdAbove：几何判据留在所有者里', () => {
    render(<Harness />)
    if (handle === undefined) throw new Error('hook did not run')
    const el = handle.scrollRef.current
    if (el === undefined) throw new Error('container missing')
    Object.defineProperties(el, {
      scrollHeight: { configurable: true, value: 2_000 },
      clientHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, value: 1_000 },
    })
    expect(handle.gapPx()).toBe(500)

    handle.lastScrollHeightRef.current = 0
    handle.noteContentHeight()
    expect(handle.lastScrollHeightRef.current).toBe(2_000)

    // 「正在读哪一行」：第一条底边越过视口顶（+inset）的行。
    const mk = (mid: string, top: number, bottom: number): void => {
      const row = document.createElement('div')
      row.setAttribute('data-mid', mid)
      row.getBoundingClientRect = () => ({ top, bottom, left: 0, right: 0, height: bottom - top }) as DOMRect
      el.append(row)
    }
    Object.defineProperty(el, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 300, bottom: 800, left: 0, right: 0, height: 500 }) as DOMRect,
    })
    mk('a', 100, 240)   // 底边 240 < 308：已经滚过去
    mk('b', 260, 400)   // 底边 400 >= 308：正在读的是这一行
    mk('c', 420, 560)
    expect(handle.firstRowIdAbove(8)).toBe('b')
    expect(handle.firstRowIdAbove(10_000)).toBeUndefined()
  })

  it('cancels the pending settle burst on unmount', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0 })
    const view = render(<Harness />)
    if (handle === undefined) throw new Error('hook did not run')
    handle.settleBottomAfterCommit()
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
