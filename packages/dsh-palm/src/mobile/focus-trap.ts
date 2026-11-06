/**
 * Modal focus management for sheets and dialogs.
 *
 * A phone sheet is a `role="dialog" aria-modal="true"` panel, but without focus
 * handling the browser leaves focus on the page behind: a screen reader keeps
 * reading the list, and a hardware-keyboard tab lands inside the hidden page.
 * Closing also drops focus to `<body>`, so the next Tab starts from the top.
 *
 * This hook does the three things the audit asked for: focus something inside
 * on open, keep Tab inside while open, and return focus to the trigger on close.
 *
 * @module dsh-palm/mobile/focus-trap
 */

import { useEffect, type RefObject } from 'react'

/** Elements that participate in the Tab order inside a modal panel. */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/** All tabbable elements inside `container`, in DOM order. */
export function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
}

/**
 * Trap focus inside `containerRef` while it is mounted.
 *
 * The container must exist on mount (the sheet/dialog is conditionally
 * rendered), and closing unmounts it — which is what restores the previous
 * focus.
 *
 * @param containerRef - ref to the modal panel.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const first = focusableWithin(container)[0]
    if (first !== undefined) {
      first.focus()
    } else {
      container.setAttribute('tabindex', '-1')
      container.focus()
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const items = focusableWithin(container)
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const index = items.indexOf(document.activeElement as HTMLElement)
      const shift = event.shiftKey
      const next = index === -1
        ? (shift ? items.length - 1 : 0)
        : (index + (shift ? -1 : 1) + items.length) % items.length
      event.preventDefault()
      items[next]?.focus()
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (previous !== null && previous.isConnected) previous.focus()
    }
  }, [containerRef])
}
