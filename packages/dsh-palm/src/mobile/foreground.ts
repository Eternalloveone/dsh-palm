/**
 * Page-visibility state for the mobile surface.
 *
 * A backgrounded PWA is frozen by the browser: timers stop firing and a socket
 * can die without the page ever seeing an error. Every polling effect on this
 * surface therefore gates on visibility — nothing schedules work (and the host
 * is told to stop streaming) for a screen nobody is looking at. Returning to
 * the foreground resyncs the stream and re-asserts the host-side observation
 * (see App's visibility effect).
 */

import { useEffect, useState } from 'react'

/** Whether the page is currently visible (true when there is no DOM, e.g. tests). */
export function pageVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

/** Subscribe to visibility changes; returns the unsubscribe function. */
export function onVisibilityChange(listener: (visible: boolean) => void): () => void {
  if (typeof document === 'undefined') return () => { /* no DOM: never changes */ }
  const handler = (): void => { listener(pageVisible()) }
  document.addEventListener('visibilitychange', handler)
  return () => { document.removeEventListener('visibilitychange', handler) }
}

/** React binding for {@link pageVisible}. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(pageVisible)
  useEffect(() => onVisibilityChange(setVisible), [])
  return visible
}
