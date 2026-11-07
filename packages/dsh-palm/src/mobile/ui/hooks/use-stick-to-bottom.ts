/**
 * Scroll mechanics for the chat surface.
 *
 * This is the part of ChatView that talks to the browser: the scroll
 * container ref, the programmatic-scroll claim (so an echo of our own write is
 * never mistaken for a reader gesture), the scroll state machine's event
 * inbox, the settle burst after a turn lands, the re-pin when a message gets
 * shorter, the passive gesture listeners, and the viewport/content resize
 * watcher.
 *
 * Business decisions stay in ChatView (what a gesture means for unread counts
 * or whether to load older rows); this hook only owns "where the viewport is
 * and who moved it". Extracting it is step S2 of the refactor plan: ChatView
 * keeps the JSX and the feature wiring, the mechanics live here.
 *
 * @module dsh-palm/mobile/ui/hooks/use-stick-to-bottom
 */

import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import { createScrollState, mayAutoPin, maySettlePin, scrollReducer, type ScrollEvent, type ScrollState } from '../../scroll-machine.ts'
import { scheduleSettleBurst } from '../../settle-timers.ts'
import { shouldRepinAfterShrink } from '../../scroll-shrink.ts'

/** Everything ChatView needs from the scroll layer. */
export interface ChatScrollHandle {
  /** The scroll container (assigned by the JSX `ref`). */
  scrollRef: MutableRefObject<HTMLDivElement | undefined>
  /** Reader's last read position (also written by locate). */
  scrollTopRef: MutableRefObject<number>
  /**
   * True while a programmatic scroll is in flight. The FIRST scroll event
   * consumes the claim; while claimed the event must not count as a gesture.
   */
  programmaticScrollRef: MutableRefObject<boolean>
  /** scrollTop we wrote, and when 鈥?used to verify the claim on the echo. */
  programmaticValueRef: MutableRefObject<number>
  programmaticAtRef: MutableRefObject<number>
  /** Last finger/wheel contact time (decides "was this the reader?"). */
  lastTouchAtRef: MutableRefObject<number>
  /** The scroll state machine ("鍞竴鐪熸簮", see `scroll-machine.ts`). */
  scrollStateRef: MutableRefObject<ScrollState>
  /** Feed one event into the state machine. */
  scrollEvent(event: ScrollEvent): void
  /** Write scrollTop and arm the claim (only when it really moves). */
  setScrollTopProgrammatically(el: HTMLDivElement, value: number): void
  /** Pin to the real bottom (content is fully rendered; scrollHeight is truth). */
  pinToRealBottom(): void
  /** Pin to the bottom and tell the state machine the reader is at the tail. */
  scrollToBottom(): void
  /** Settle after a commit: rAF + a shrinking burst of re-pins, cancelled on unmount. */
  settleBottomRef: MutableRefObject<() => void>
  /** The settle routine itself (callers that want it synchronously). */
  settleBottomAfterCommit(): void
  /** Content height after the last follow (identity-unchanged height checks). */
  lastScrollHeightRef: MutableRefObject<number>
}

/**
 * Create the scroll layer for one chat view.
 * @returns refs and actions; stable for the lifetime of the component.
 */
export function useStickToBottom(): ChatScrollHandle {
  const scrollRef = useRef<HTMLDivElement | undefined>(undefined)
  const scrollTopRef = useRef(0)
  const programmaticScrollRef = useRef(false)
  const lastTouchAtRef = useRef(0)
  const programmaticValueRef = useRef(-1)
  const programmaticAtRef = useRef(0)
  const scrollStateRef = useRef<ScrollState>(createScrollState())
  const lastScrollHeightRef = useRef(0)

  const scrollEvent = useCallback((event: ScrollEvent): void => {
    scrollStateRef.current = scrollReducer(scrollStateRef.current, event)
  }, [])

  /**
   * Write a programmatic scroll position.
   * Armed only when the write really moves the container: an unchanged
   * scrollTop fires no scroll event, and a stale claim would swallow the
   * reader's next genuine gesture.
   */
  const setScrollTopProgrammatically = useCallback((el: HTMLDivElement, value: number): void => {
    if (el.scrollTop !== value) {
      programmaticScrollRef.current = true
      programmaticValueRef.current = value
      programmaticAtRef.current = Date.now()
    }
    el.scrollTop = value
    scrollTopRef.current = el.scrollTop
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el === undefined) return
    setScrollTopProgrammatically(el, el.scrollHeight)
    // This write means "I am at the newest message": hand it to the machine.
    scrollEvent({ type: 'pin' })
  }, [setScrollTopProgrammatically, scrollEvent])

  const pinToRealBottom = useCallback(() => {
    const el = scrollRef.current
    if (el === undefined) return
    setScrollTopProgrammatically(el, el.scrollHeight)
  }, [setScrollTopProgrammatically])

  /**
   * Settle the bottom after a commit: heights keep growing after the first
   * frame (cards, images, fonts), so one rAF is never enough. Ticks shrink in
   * density up to 4 s; a reader who moved (state machine) or a pinned list
   * cancels the rest so they do not force one layout read per stale timer.
   */
  const settleBurstRef = useRef<{ cancel(): void } | null>(null)
  const settleBottomRef = useRef<() => void>(() => {})
  const settleBottomAfterCommit = useCallback(() => {
    const pinIfShort = (): boolean => {
      const el = scrollRef.current
      if (el === undefined) return true
      if (!maySettlePin(scrollStateRef.current, Date.now())) return true
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight
      if (gap <= 2) return true
      setScrollTopProgrammatically(el, el.scrollHeight)
      lastScrollHeightRef.current = el.scrollHeight
      return false
    }
    requestAnimationFrame(() => { pinIfShort() })
    settleBurstRef.current?.cancel()
    settleBurstRef.current = scheduleSettleBurst([60, 180, 400, 800, 1_500, 2_500, 3_500, 4_000], () => pinIfShort())
  }, [setScrollTopProgrammatically])

  // Unmount (switching sessions / back to the roster): stale timers read layout
  // for nothing.
  useEffect(() => () => {
    settleBurstRef.current?.cancel()
    settleBurstRef.current = null
  }, [])

  // Content got shorter (collapsed long answer, settled parse smaller): re-pin
  // only a reader who was already at the bottom.
  useEffect(() => {
    const onShrunk = (event: Event): void => {
      const detail = (event as CustomEvent<{ delta?: number }>).detail
      const delta = typeof detail?.delta === 'number' ? detail.delta : 0
      requestAnimationFrame(() => {
        const el = scrollRef.current
        if (el === undefined) return
        if (!maySettlePin(scrollStateRef.current, Date.now())) return
        const after = el.scrollHeight
        if (!shouldRepinAfterShrink({ before: after + delta, after })) return
        setScrollTopProgrammatically(el, after)
        lastScrollHeightRef.current = after
      })
    }
    window.addEventListener('palm:content-shrunk', onShrunk)
    return () => { window.removeEventListener('palm:content-shrunk', onShrunk) }
  }, [setScrollTopProgrammatically])

  // Finger down/up: never steal the scroll during that window. Native passive
  // listeners instead of JSX props 鈥?the container already has zoom/long-press
  // handlers, and a non-passive listener on a scroll container slows it down.
  // Attached to window because the chat is "loading state first, list later".
  useEffect(() => {
    const inChat = (target: EventTarget | null): boolean =>
      target instanceof Element && target.closest('.chat-scroll') !== null
    const start = (event: Event): void => {
      if (!inChat(event.target)) return
      lastTouchAtRef.current = Date.now()
      scrollEvent({ type: 'touch-start', at: Date.now() })
    }
    const end = (event: Event): void => {
      if (!inChat(event.target)) return
      lastTouchAtRef.current = Date.now()
      scrollEvent({ type: 'touch-end', at: Date.now() })
    }
    // Wheel counts as reader intent too (desktop / wide screen).
    const wheel = (event: Event): void => {
      if (!inChat(event.target)) return
      lastTouchAtRef.current = Date.now()
    }
    window.addEventListener('touchstart', start, { passive: true })
    window.addEventListener('touchend', end, { passive: true })
    window.addEventListener('touchcancel', end, { passive: true })
    window.addEventListener('wheel', wheel, { passive: true })
    return () => {
      window.removeEventListener('touchstart', start)
      window.removeEventListener('touchend', end)
      window.removeEventListener('touchcancel', end)
      window.removeEventListener('wheel', wheel)
    }
  }, [scrollEvent])

  // Viewport or content height changed: keep following only a bottom-pinned
  // reader. Watching both the container and its content matters 鈥?content can
  // grow without any message change (card expanded, image decoded, font wrap).
  useEffect(() => {
    const el = scrollRef.current
    if (el === undefined) return
    if (typeof ResizeObserver === 'undefined') return
    const pin = (): void => {
      if (!mayAutoPin(scrollStateRef.current, Date.now())) return
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight
      if (gap <= 2) return
      setScrollTopProgrammatically(el, el.scrollHeight)
      lastScrollHeightRef.current = el.scrollHeight
    }
    const observer = new ResizeObserver(pin)
    observer.observe(el)
    const content = el.firstElementChild
    if (content !== null) observer.observe(content)
    return () => { observer.disconnect() }
  }, [setScrollTopProgrammatically])

  settleBottomRef.current = settleBottomAfterCommit

  return {
    scrollRef,
    scrollTopRef,
    programmaticScrollRef,
    programmaticValueRef,
    programmaticAtRef,
    lastTouchAtRef,
    scrollStateRef,
    scrollEvent,
    setScrollTopProgrammatically,
    pinToRealBottom,
    scrollToBottom,
    settleBottomRef,
    settleBottomAfterCommit,
    lastScrollHeightRef,
  }
}
