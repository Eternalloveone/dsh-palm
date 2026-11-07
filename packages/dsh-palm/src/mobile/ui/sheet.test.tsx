// @vitest-environment jsdom
/** Sheet chrome: drag-down dismisses, drag-up expands, body stays scrollable. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Sheet } from './sheet.tsx'

// No global auto-cleanup (globals: false): unmount between tests.
afterEach(() => { cleanup() })

/** Drag the grab header from `from` to `to` client Y, then release. */
function dragGrab(container: HTMLElement, from: number, to: number): void {
  const grab = container.querySelector('.sheet-grab') as HTMLElement
  fireEvent.touchStart(grab, { touches: [{ clientY: from }] })
  fireEvent.touchMove(grab, { touches: [{ clientY: to }] })
  fireEvent.touchEnd(grab)
}

describe('Sheet', () => {
  it('renders the dialog with title and children', () => {
    render(<Sheet title="运行状态" onClose={() => {}}><p>内容</p></Sheet>)
    expect(screen.getByRole('dialog', { name: '运行状态' })).toBeTruthy()
    expect(screen.getByText('内容')).toBeTruthy()
  })

  it('dismisses when pulled down past the threshold', () => {
    const onClose = vi.fn()
    const { container } = render(<Sheet title="运行状态" onClose={onClose}><p>内容</p></Sheet>)
    dragGrab(container, 100, 200) // +100 > 80
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stays open on a small downward pull', () => {
    const onClose = vi.fn()
    const { container } = render(<Sheet title="运行状态" onClose={onClose}><p>内容</p></Sheet>)
    dragGrab(container, 100, 140) // +40 < 80
    expect(onClose).not.toHaveBeenCalled()
  })

  it('expands to full height when pulled up past the threshold', () => {
    const onClose = vi.fn()
    const { container } = render(<Sheet title="运行状态" onClose={onClose}><p>内容</p></Sheet>)
    dragGrab(container, 200, 120) // -80 < -40
    expect(container.querySelector('.sheet-full')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ignores a small upward pull (no expand, still open)', () => {
    const onClose = vi.fn()
    const { container } = render(<Sheet title="运行状态" onClose={onClose}><p>内容</p></Sheet>)
    dragGrab(container, 200, 170) // -30 > -40
    expect(container.querySelector('.sheet-full')).toBeNull()
  })

  it('closes when the backdrop is tapped and keeps taps inside the sheet', () => {
    const onClose = vi.fn()
    const { container } = render(<Sheet title="运行状态" onClose={onClose}><button type="button">行内按钮</button></Sheet>)
    // A tap inside the sheet must not bubble to the backdrop.
    fireEvent.click(screen.getByText('行内按钮'))
    expect(onClose).not.toHaveBeenCalled()
    // The backdrop area itself closes.
    fireEvent.click(container.querySelector('.sheet-backdrop') as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
