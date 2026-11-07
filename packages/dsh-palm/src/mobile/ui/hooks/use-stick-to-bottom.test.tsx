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
