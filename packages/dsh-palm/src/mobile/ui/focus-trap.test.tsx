// @vitest-environment jsdom
import { useRef } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  it('focuses the first control when the panel opens', async () => {
    const view = render(<Harness open={false} />)
    view.rerender(<Harness open />)
    // 焦点在下一帧才落地（见 focus-trap.ts 的说明：focus() 本身要几十毫秒，
    // 放在提交那一帧会推迟「点下去有反应」的时刻）。
    await waitFor(() => { expect(document.activeElement?.textContent).toBe('第一个') })
  })

  it('wraps Tab inside the panel (forward and backward)', async () => {
    const view = render(<Harness open={false} />)
    view.rerender(<Harness open />)
    await waitFor(() => { expect(document.activeElement?.textContent).toBe('第一个') })
    // jsdom does not move focus natively; the trap's handler does.
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement?.textContent).toBe('第二个')
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement?.textContent).toBe('第一个')
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement?.textContent).toBe('第二个')
  })

  it('returns focus to the trigger when the panel closes', async () => {
    const view = render(<Harness open={false} />)
    const trigger = screen.getByText('trigger')
    trigger.focus()
    view.rerender(<Harness open />)
    await waitFor(() => { expect(document.activeElement?.textContent).toBe('第一个') })
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
  it('每次聚焦都带 preventScroll（否则安卓上会替我们把页面滚一下）', async () => {
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
      // 打开：聚焦面板内第一个控件（下一帧落地）
      await waitFor(() => { expect(calls.at(-1)).toEqual({ preventScroll: true }) })
      view.rerender(<Harness open={false} />)
      // 关闭：把焦点还给触发按钮
      await waitFor(() => { expect(calls.at(-1)).toEqual({ preventScroll: true }) })
      expect(calls.every(call => call?.preventScroll === true)).toBe(true)
    } finally {
      HTMLElement.prototype.focus = original
    }
  })
})

/**
 * 真机回归（2026-11-11）：「切换工作区」面板一打开，搜索框就获得焦点、键盘弹出来，
 * 把面板顶掉一半 —— 用户的原话是「为啥会直接进搜索框，这不合理」。
 *
 * 原因是 `useFocusTrap` 聚焦「第一个可聚焦元素」，而那个面板的第一个就是搜索输入框。
 */
function PanelWithSearch() {
  const ref = useRef<HTMLDivElement | null>(null)
  useFocusTrap(ref)
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="面板">
      <input aria-label="搜索" />
      <button type="button">新建</button>
      <button type="button">第一条</button>
    </div>
  )
}

describe('useFocusTrap：打开时不要抢输入框', () => {
  it('面板里第一个是输入框时，焦点落在下一个按钮上（不弹键盘）', async () => {
    render(<PanelWithSearch />)
    await waitFor(() => { expect(document.activeElement?.tagName).toBe('BUTTON') })
    expect(document.activeElement?.textContent).toBe('新建')
  })

  it('面板里只有输入框时，仍然聚焦输入框（纯输入对话框行为不变）', async () => {
    function OnlyInput() {
      const ref = useRef<HTMLDivElement | null>(null)
      useFocusTrap(ref)
      return (
        <div ref={ref} role="dialog" aria-modal="true" aria-label="只有输入">
          <input aria-label="名字" />
        </div>
      )
    }
    render(<OnlyInput />)
    await waitFor(() => { expect(document.activeElement?.tagName).toBe('INPUT') })
  })
})