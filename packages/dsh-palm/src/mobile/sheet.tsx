/**
 * Shared bottom-sheet chrome: backdrop + slide-up panel with a drag handle
 * (pull down past ~80px to dismiss; pulling up past ~40px expands the panel
 * to full height — drag gestures live on the grab header, so the scrollable
 * body below gets every vertical gesture for itself). Escape closes for
 * keyboard users. Used by the chat pickers, the settings pickers, and the
 * workspace long-press menu.
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
/** Pull-up distance past which release expands the sheet to full height. */
const EXPAND_THRESHOLD_PX = 40

/** Render one bottom sheet with backdrop, drag handle, and centered title. */
export function Sheet({ title, onClose, children }: SheetProps) {
  const [dragY, setDragY] = useState(0)
  const [full, setFull] = useState(false)
  const dragging = useRef(false)
  const startY = useRef(0)
  // Total drag distance, tracked synchronously: a fast flick ends (touchend)
  // in the same frame as its last move, before the move's setState flushes,
  // so the end handler reads the distance from a ref, never from state.
  const dragDy = useRef(0)

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
        className={'sheet' + (full ? ' sheet-full' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
        onClick={(event) => { event.stopPropagation() }}
      >
        {/*
          * Grab header: drag gestures live here (touch-action: none), so the
          * scrollable body below gets every vertical gesture for itself.
          * Down past DISMISS_THRESHOLD closes; up past EXPAND_THRESHOLD
          * expands the panel to full height (a long task list needs both).
          */}
        <div
          className="sheet-grab"
          onTouchStart={(event) => {
            dragging.current = true
            dragDy.current = 0
            startY.current = event.touches[0]?.clientY ?? 0
          }}
          onTouchMove={(event) => {
            if (!dragging.current) return
            const dy = (event.touches[0]?.clientY ?? 0) - startY.current
            dragDy.current = dy
            // Upward drag is only recorded (the panel transform applies below
            // zero only), so the expand check sees the real distance; in the
            // expanded state the panel cannot rise above full height.
            setDragY(full ? Math.max(0, dy) : dy)
          }}
          onTouchEnd={() => {
            if (!dragging.current) return
            dragging.current = false
            const dy = dragDy.current
            dragDy.current = 0
            if (dy > DISMISS_THRESHOLD_PX) {
              onClose()
            } else if (!full && dy < -EXPAND_THRESHOLD_PX) {
              setFull(true)
            }
            setDragY(0)
          }}
        >
          <div className="sheet-handle" aria-hidden onClick={() => { onClose() }} />
          <div className="sheet-title">{title}</div>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}
