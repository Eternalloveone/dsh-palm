/**
 * Shared bottom-sheet chrome: backdrop + slide-up panel with a draggable
 * handle (pull down past ~80px to dismiss). Escape closes for keyboard
 * users. Used by the chat pickers, the settings pickers, and the workspace
 * long-press menu.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Shared bottom-sheet props. */
export interface SheetProps {
  title: string
  onClose(): void
  children: ReactNode
}

/** Pull-down distance past which release dismisses the sheet. */
const DISMISS_THRESHOLD_PX = 80

/** Render one bottom sheet with backdrop, drag handle, and centered title. */
export function Sheet({ title, onClose, children }: SheetProps) {
  const [dragY, setDragY] = useState(0)
  const dragging = useRef(false)
  const startY = useRef(0)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

  // Lock the page scroll while the sheet is open (scroll chaining on the
  // message list behind the backdrop is disorienting on a phone).
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [])

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
        onTouchStart={(event) => {
          dragging.current = true
          startY.current = event.touches[0]?.clientY ?? 0
        }}
        onTouchMove={(event) => {
          if (!dragging.current) return
          const dy = (event.touches[0]?.clientY ?? 0) - startY.current
          setDragY(Math.max(0, dy))
        }}
        onTouchEnd={() => {
          dragging.current = false
          if (dragY > DISMISS_THRESHOLD_PX) onClose()
          else setDragY(0)
        }}
        onClick={(event) => { event.stopPropagation() }}
      >
        <div
          className="sheet-handle"
          aria-hidden
          onClick={() => { onClose() }}
        />
        <div className="sheet-title">{title}</div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}
