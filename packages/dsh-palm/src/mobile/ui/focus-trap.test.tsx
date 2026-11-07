// @vitest-environment jsdom
import { useRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useFocusTrap } from './focus-trap.ts'

afterEach(() => {
  cleanup()
})

/** The panel itself calls the hook — it mounts/unmounts with `open`, exactly
 *  like `Sheet` and the dialogs do. */
function Panel() {
  const ref = useRef<HTMLDivElement | null>(null)
  useFocusTrap(ref)
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="面板">
      <button type="button">第一个</button>
      <button type="button">第二个</button>
    </div>
  )
}

/** A page with a trigger button and a conditionally-rendered panel. */
function Harness({ open }: { open: boolean }) {
  return (
    <div>
      <button type="button">trigger</button>
      {open ? <Panel /> : null}
    </div>
  )
}

describe('useFocusTrap', () => {
  it('focuses the first control when the panel opens', () => {
    const view = render(<Harness open={false} />)
    view.rerender(<Harness open />)
    expect(document.activeElement?.textContent).toBe('第一个')
  })

  it('wraps Tab inside the panel (forward and backward)', () => {
    const view = render(<Harness open={false} />)
    view.rerender(<Harness open />)
    // jsdom does not move focus natively; the trap's handler does.
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement?.textContent).toBe('第二个')
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement?.textContent).toBe('第一个')
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement?.textContent).toBe('第二个')
  })

  it('returns focus to the trigger when the panel closes', () => {
    const view = render(<Harness open={false} />)
    const trigger = screen.getByText('trigger')
    trigger.focus()
    view.rerender(<Harness open />)
    expect(document.activeElement?.textContent).toBe('第一个')
    view.rerender(<Harness open={false} />)
    expect(document.activeElement).toBe(trigger)
  })

  /**
   * 真机「点 + / 会话区上翻一下又回来」的回归门。
   *
   * 浮层是滑上来的（`@keyframes sheet-up` 从 `translateY(100%)` 起），挂载瞬间第一个选项
   * 还在视口外；不带 `preventScroll` 的 focus() 会让浏览器去滚可视视口把"聚焦元素"露出来，
   * 整页就被往上推一下。这里直接钉住"每次聚焦都带 preventScroll"，比在 E2E 里观察
   * 平移可靠（桌面 headless 根本不产生那次平移，观察不到）。
   */
  it('每次聚焦都带 preventScroll（否则安卓上会替我们把页面滚一下）', () => {
    const calls: Array<Record<string, unknown> | undefined> = []
    const original = HTMLElement.prototype.focus
    HTMLElement.prototype.focus = function patched(this: HTMLElement, options?: FocusOptions) {
      calls.push(options as Record<string, unknown> | undefined)
      original.call(this, options)
    }
    try {
      const view = render(<Harness open={false} />)
      const trigger = screen.getByText('trigger')
      trigger.focus()
      calls.length = 0
      view.rerender(<Harness open />)
      // 打开：聚焦面板内第一个控件
      expect(calls.at(-1)).toEqual({ preventScroll: true })
      view.rerender(<Harness open={false} />)
      // 关闭：把焦点还给触发按钮
      expect(calls.at(-1)).toEqual({ preventScroll: true })
      expect(calls.every(call => call?.preventScroll === true)).toBe(true)
    } finally {
      HTMLElement.prototype.focus = original
    }
  })
})
