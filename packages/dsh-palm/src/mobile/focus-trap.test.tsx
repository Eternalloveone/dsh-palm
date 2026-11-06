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
})
