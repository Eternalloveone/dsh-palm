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
import { createScrollState, mayAutoPin, maySettlePin, scrollReducer, type ScrollEvent, type ScrollState } from '../../stream/scroll-machine.ts'
import { scheduleSettleBurst } from '../../stream/settle-timers.ts'
import { shouldRepinAfterShrink } from '../../stream/scroll-shrink.ts'

/** 平滑滚动的认领上界（毫秒）：再久就不再续期，免得一次卡死的动画把读者的手势吃掉。 */
export const SMOOTH_CLAIM_MS = 800
/** 区间认领的逐帧续期窗口：比一帧长，比一次惯性滚动短。 */
const SMOOTH_RENEW_MS = 120

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
  /**
   * 「区间认领」截止时刻（ms）：平滑滚动期间每帧续期，期间所有回声都算自己人。
   *
   * 见 `stream/scroll-claim.ts`：点判据只能认领第一个事件，`scrollTo({behavior:'smooth'})`
   * 会连发几十个，剩下的被当成读者手势 → `userMoved` 置真 → 本轮补钉永久失效。
   */
  programmaticUntilRef: MutableRefObject<number>
  /** Last finger/wheel contact time (decides "was this the reader?"). */
  lastTouchAtRef: MutableRefObject<number>
  /** The scroll state machine ("鍞竴鐪熸簮", see `scroll-machine.ts`). */
  scrollStateRef: MutableRefObject<ScrollState>
  /** Feed one event into the state machine. */
  scrollEvent(event: ScrollEvent): void
  /** Write scrollTop and arm the claim (only when it really moves). */
  setScrollTopProgrammatically(el: HTMLDivElement, value: number): void
  /**
   * 滚到指定位置（**聊天容器唯一的滚动入口**）。
   *
   * @param target - 目标 scrollTop（内部再夹到 [0, scrollHeight-clientHeight]）。
   * @param options.smooth - 走 `scrollTo({behavior:'smooth'})` 并开区间认领。
   */
  scrollToTarget(target: number, options?: { smooth?: boolean }): void
  /**
   * 相对当前位置挪 `delta` 像素（**行高账本补偿专用**）。
   *
   * 视口上方某行被测出更准的高度时，画面会整体位移；补偿就靠这一条，而不是让
   * 测量层自己去写 `scrollTop`（K4：写点只有这里）。
   */
  scrollBy(delta: number): void
  /**
   * 当前离底距离（px）。**实时读**，不用 scroll 事件里那份快照 ——
   * 贴底补钉要在"这一帧提交完"之后立刻判断，事件快照还停在上一帧。
   */
  gapPx(): number
  /** 记一次内容高度基线（补钉/落底之后调用，避免下次把"已经补过"当成"还没补"）。 */
  noteContentHeight(): void
  /**
   * 视口顶（加 `insetPx` 偏移）往下第一条 `[data-mid]` 行的 id。
   *
   * "读者正在看哪一行"的判据：第一个**底边越过**这条线的行。以前每个调用点自己
   * 拿 `getBoundingClientRect` 循环一遍，读布局的模块就多一个。找不到返回 undefined。
   */
  firstRowIdAbove(insetPx: number): string | undefined
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
export function useStickToBottom(scope?: string): ChatScrollHandle {
  const scrollRef = useRef<HTMLDivElement | undefined>(undefined)
  const scrollTopRef = useRef(0)
  const programmaticScrollRef = useRef(false)
  const lastTouchAtRef = useRef(0)
  const programmaticValueRef = useRef(-1)
  const programmaticAtRef = useRef(0)
  const programmaticUntilRef = useRef(0)
  /** 平滑滚动的代次：换会话/再次定位/卸载都会 +1，旧循环看见代次变了就自己退出。 */
  const smoothSeqRef = useRef(0)
  const scrollStateRef = useRef<ScrollState>(createScrollState())
  const lastScrollHeightRef = useRef(0)
  // 换会话（P4：聊天页实例跨会话复用）：状态机由 `scrollEvent({type:'open'})` 归零，
  // 但"上一个位置/上一份高度/程序化认领"这几个判据还留着上一场数 —— 不一起清，
  // 新会话第一拍会按旧读数判断"读者在哪"，落点就停在上一场的位置上。
  const scopeRef = useRef(scope)
  if (scope !== undefined && scopeRef.current !== scope) {
    scopeRef.current = scope
    scrollTopRef.current = 0
    lastScrollHeightRef.current = 0
    programmaticScrollRef.current = false
    programmaticValueRef.current = -1
    programmaticAtRef.current = 0
    programmaticUntilRef.current = 0
    smoothSeqRef.current += 1
  }

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

  /**
   * 滚到指定位置。**聊天容器只有这一个入口**（K4：锚点单写者）。
   *
   * 平滑滚动的回声是一串（实测一次定位几十个事件），点判据只能认领第一个，
   * 所以这里开**区间认领**并逐帧续期；落点后交回一次点认领，让最后一个回声也算自己的。
   */
  const scrollToTarget = useCallback((target: number, options?: { smooth?: boolean }): void => {
    const el = scrollRef.current
    if (el === undefined) return
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    const top = Math.min(Math.max(0, Math.round(target)), max)
    const smooth = options?.smooth === true && typeof el.scrollTo === 'function'
    if (!smooth) {
      setScrollTopProgrammatically(el, top)
      return
    }
    const startedAt = Date.now()
    const seq = (smoothSeqRef.current += 1)
    programmaticScrollRef.current = true
    programmaticValueRef.current = el.scrollTop
    programmaticAtRef.current = startedAt
    programmaticUntilRef.current = startedAt + SMOOTH_RENEW_MS
    el.scrollTo({ top, behavior: 'smooth' })
    const renew = (): void => {
      // 换会话 / 又一次定位 / 卸载：旧循环立刻退出，别再改别人那一次的认领。
      if (seq !== smoothSeqRef.current) return
      const now = Date.now()
      if (Math.abs(el.scrollTop - top) <= 2 || now - startedAt > SMOOTH_CLAIM_MS) {
        // 落点：区间收回，改发一次点认领，最后一个回声仍然算程序化。
        programmaticScrollRef.current = true
        programmaticValueRef.current = el.scrollTop
        programmaticAtRef.current = now
        programmaticUntilRef.current = 0
        scrollTopRef.current = el.scrollTop
        return
      }
      programmaticUntilRef.current = now + SMOOTH_RENEW_MS
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(renew)
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(renew)
  }, [setScrollTopProgrammatically])

  /**
   * 相对当前位置挪 `delta`：行高账本的补偿专用（见 `stream/scroll-claim.ts` 同级的 K4）。
   *
   * 走 `setScrollTopProgrammatically`，所以回声照样被认领 —— 补偿不会被误读成读者手势。
   */
  const scrollBy = useCallback((delta: number): void => {
    const el = scrollRef.current
    if (el === undefined || delta === 0) return
    setScrollTopProgrammatically(el, el.scrollTop + delta)
  }, [setScrollTopProgrammatically])

  /** 实时离底距离（见接口注释：不能用 scroll 事件里的快照）。 */
  const gapPx = useCallback((): number => {
    const el = scrollRef.current
    if (el === undefined) return 0
    return el.scrollHeight - el.scrollTop - el.clientHeight
  }, [])

  /** 记一次内容高度基线。 */
  const noteContentHeight = useCallback((): void => {
    const el = scrollRef.current
    if (el !== undefined) lastScrollHeightRef.current = el.scrollHeight
  }, [lastScrollHeightRef])

  /** 视口顶（加偏移）往下第一条 `[data-mid]` 行 —— "读者正在看哪一行"。 */
  const firstRowIdAbove = useCallback((insetPx: number): string | undefined => {
    const el = scrollRef.current
    if (el === undefined || typeof el.querySelectorAll !== 'function') return undefined
    const anchorTop = el.getBoundingClientRect().top + insetPx
    for (const row of el.querySelectorAll<HTMLElement>('[data-mid]')) {
      const mid = row.dataset['mid']
      if (mid === undefined) continue
      if (row.getBoundingClientRect().bottom >= anchorTop) return mid
    }
    return undefined
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
    // 卸载后 rAF 循环还在读一个脱离文档的节点：代次一改，它下一帧就退出。
    smoothSeqRef.current += 1
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
    /**
     * ResizeObserver 一次布局会**连发很多条**（进会话时 40 行逐行上屏、图片解码、
     * 卡片展开都算一次），而 `pin` 每次都读 `scrollHeight` —— 那是强制回流。
     *
     * 2026-11-14 真机采样（4x CPU）：切一次会话主线程在 `get scrollHeight` 上
     * 花掉 213~470ms（同类问题里的第二个热点，第一个是 markdown 的 offsetHeight）。
     * 合并到每帧一次：同一帧里十几次尺寸变化只算一次差值、最多写一次 scrollTop。
     */
    let scheduled = 0
    const pin = (): void => {
      if (scheduled !== 0) return
      scheduled = requestAnimationFrame(() => {
        scheduled = 0
        if (!mayAutoPin(scrollStateRef.current, Date.now())) return
        const gap = el.scrollHeight - el.scrollTop - el.clientHeight
        if (gap <= 2) return
        setScrollTopProgrammatically(el, el.scrollHeight)
        lastScrollHeightRef.current = el.scrollHeight
      })
    }
    const observer = new ResizeObserver(pin)
    observer.observe(el)
    const content = el.firstElementChild
    if (content !== null) observer.observe(content)
    return () => {
      if (scheduled !== 0) cancelAnimationFrame(scheduled)
      observer.disconnect()
    }
  }, [setScrollTopProgrammatically])

  settleBottomRef.current = settleBottomAfterCommit

  return {
    scrollRef,
    scrollTopRef,
    programmaticScrollRef,
    programmaticValueRef,
    programmaticAtRef,
    programmaticUntilRef,
    lastTouchAtRef,
    scrollStateRef,
    scrollEvent,
    setScrollTopProgrammatically,
    scrollToTarget,
    scrollBy,
    gapPx,
    noteContentHeight,
    firstRowIdAbove,
    pinToRealBottom,
    scrollToBottom,
    settleBottomRef,
    settleBottomAfterCommit,
    lastScrollHeightRef,
  }
}

/*
 * ── 补页锚点（S4-3a：从 history/chat-scroll-anchor.ts 搬进来）─────────────
 *
 * 为什么放进这个文件：K4 说"几何只有一个所有者"。补页要按**屏幕位置**校准（不是高度差），
 * 它读的是同一批几何属性；留在 history/ 里就是第二个读点、第二套锚定口径。
 * 搬进来之后，整个仓库里读布局的地方只有这里和行高账本两处。
 */

export interface PrependAnchor {
  top: number
  height?: number
  rowId?: string
  rowTop?: number
  rowSeq?: number
}

export function restorePrependScrollTop(scroller: HTMLElement, anchor: PrependAnchor): number | undefined {
  if (anchor.rowId === undefined || anchor.rowTop === undefined) {
    const grown = scroller.scrollHeight - (anchor.height ?? scroller.scrollHeight)
    return grown > 0 ? Math.max(0, anchor.top + grown) : undefined
  }
  const rows = [...scroller.querySelectorAll('[data-message-id]')]
  const row = rows.find(item => item.getAttribute('data-message-id') === anchor.rowId)
    ?? (anchor.rowSeq === undefined || anchor.rowSeq <= 0 ? null : [...scroller.querySelectorAll('[data-row-seq]')]
      .find(item => Number(item.getAttribute('data-row-seq') ?? '0') === anchor.rowSeq) ?? null)
  if (row === null) return undefined
  const delta = Math.round(row.getBoundingClientRect().top) - anchor.rowTop
  if (Math.abs(delta) <= 2 || Math.abs(delta) > scroller.clientHeight * 2) return undefined
  return Math.max(0, scroller.scrollTop + delta)
}

export function capturePrependAnchor(scroll: ChatScrollHandle | undefined, silent: boolean): PrependAnchor | undefined {
  const scroller = scroll?.scrollRef.current
  if (scroll === undefined || scroller === undefined) return undefined
  const row = silent ? undefined : [...scroller.querySelectorAll('[data-message-id]')]
    .find(item => item.getBoundingClientRect().bottom > 80)
  return {
    top: scroll.scrollTopRef.current,
    height: scroller.scrollHeight,
    ...(row === undefined ? {} : {
      rowId: row.getAttribute('data-message-id') ?? '',
      rowTop: Math.round(row.getBoundingClientRect().top),
      rowSeq: Number(row.getAttribute('data-row-seq') ?? '0'),
    }),
  }
}
