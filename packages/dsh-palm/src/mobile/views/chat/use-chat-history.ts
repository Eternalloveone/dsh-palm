/**
 * Paginated history loading for one chat.
 *
 * Owns the bookkeeping (in-flight latch, coalesced queue, page cache, timeout,
 * `hasOlder`, silent auto-extend) **and** the scroll anchoring that goes with a
 * prepend:
 *
 * - `captureAnchor()` before the request (scrollTop + height + the row at the
 *   viewport top);
 * - a layout effect after the commit that restores the reader's position by
 *   height delta, then by that row's real movement (windowed rendering makes
 *   the height delta unreliable);
 * - the silent auto-extend's re-follow, deferred to commit time for the same
 *   reason.
 *
 * The page content itself stays with the caller: `preparePage` renders + card-
 * recovers a host page and `adoptPage` folds it into the row model. ChatView
 * supplies those because it owns the fold.
 *
 * @module dsh-palm/mobile/views/chat/use-chat-history
 */

import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { loadChatPage, type ChatPageResult } from '../../data/chat-page.ts'
import type { RenderMessage } from '../../messages.ts'
import { recallChatSnapshot } from '../../chat-snapshot.ts'
import { FOLLOW_THRESHOLD_PX } from '../../scroll-machine.ts'
import type { ChatScrollHandle } from './use-chat-scroll.ts'

/** Abort an older-page request that never answers (weak links hang, not fail). */
export const LOAD_OLDER_TIMEOUT_MS = 90_000
/** How many silent pages the open-time auto-extend may load. */
export const OPEN_HISTORY_MAX_PAGES = 4
/** Target row count for the open-time auto-extend. */
export const OPEN_HISTORY_TARGET_ROWS = 120

/** Context handed to `adoptPage` for one fetched page. */
export interface OlderPageContext {
  silent: boolean
  maxRows: number | undefined
  beforeSeq: number
  /** First row already in the fold when the request went out. */
  first: RenderMessage
}

/** Scroll-dependent actions owned by ChatView. */
export interface HistoryActions {
  scrollToBottom(): void
  settleBottomAfterCommit(): void
}

/** Everything the pager needs from ChatView. */
export interface ChatHistoryOptions {
  sessionId: string
  /** Rows currently rendered; the commit-time anchor effect runs per change. */
  messages: RenderMessage[]
  /** First row currently in the fold (authoritative at call time). */
  getFirstRow(): RenderMessage | undefined
  /** Row count currently loaded (stops the auto-extend chain). */
  loadedRowCount(): number
  /** Render + card-recover one page (ChatView keeps this because it owns the fold). */
  preparePage(page: ChatPageResult): Promise<RenderMessage[]>
  /** Merge the rendered page into the row model (fold/prepend/reseed). */
  adoptPage(older: RenderMessage[], page: ChatPageResult, context: OlderPageContext): void
  /** The scroll layer (used for anchor capture/restore). */
  getScroll(): ChatScrollHandle | undefined
  /** Scroll actions used by the commit-time follow. */
  actions: HistoryActions
  /** Toggle the "加载中…" state (silent loads do not flash it). */
  onLoading(loading: boolean): void
  /** Surface a non-silent failure. */
  onError(reason: unknown): void
}

/** First-paint rows from the in-memory session snapshot (sync; used by useState). */
export function initialSnapshotRows(sessionId: string): { rows: RenderMessage[]; hasOlder: boolean } | undefined {
  return recallChatSnapshot(sessionId)
}

/** Anchor captured before a prepend, restored after the commit. */
interface PrependAnchor {
  top: number
  height?: number
  rowId?: string
  rowTop?: number
  rowSeq?: number
}

/** Pager state + entry points. */
export interface ChatHistoryHandle {
  /** Whether more history exists (kept in sync with adopted pages). */
  hasOlder: boolean
  setHasOlder: Dispatch<SetStateAction<boolean>>
  /** True while a page is in flight (also gates the near-top auto-load). */
  pendingRef: MutableRefObject<boolean>
  /** Prefetched pages by cursor (search "next" hit fetches ahead of time). */
  pageCacheRef: MutableRefObject<Map<number, ChatPageResult>>
  /**
   * Load one older page.
   * @param silent - auto-extend (no "加载中…" flash, failures stay quiet).
   * @param beforeSeq - explicit cursor (search locate); defaults to the first row.
   * @param chain - keep loading while under the open-time target.
   * @param maxRows - cap for a locate page (different window, no anchor shift).
   */
  loadOlder(silent?: boolean, beforeSeq?: number, chain?: boolean, maxRows?: number): void
  /** Ask the next commit to re-follow the tail (silent auto-extend). */
  markFollowAfterPrepend(): void
  /** The in-memory snapshot for this session (open-time seeding). */
  recallSnapshot(): { rows: RenderMessage[]; hasOlder: boolean } | undefined
}

/** Row at the top of the viewport: its screen position survives a prepend. */
function captureRow(scroller: HTMLElement): { id: string; top: number; seq: number } | undefined {
  const rows = scroller.querySelectorAll('[data-message-id]')
  for (const row of rows) {
    const rect = row.getBoundingClientRect()
    if (rect.bottom > 80) {
      return {
        id: row.getAttribute('data-message-id') ?? '',
        top: Math.round(rect.top),
        seq: Number(row.getAttribute('data-row-seq') ?? '0'),
      }
    }
  }
  return undefined
}

/**
 * Create the history pager for one chat view.
 * @param options - session id, fold callbacks, scroll access, actions.
 * @returns pager state and the `loadOlder` entry point.
 */
export function useChatHistory(options: ChatHistoryOptions): ChatHistoryHandle {
  const { sessionId, messages, getFirstRow, loadedRowCount, preparePage, adoptPage, getScroll, actions, onLoading, onError } = options
  const [hasOlder, setHasOlder] = useState(false)
  const pendingRef = useRef(false)
  const queuedRef = useRef<{ beforeSeq?: number } | undefined>(undefined)
  const pageCacheRef = useRef(new Map<number, ChatPageResult>())
  const chainPagesRef = useRef(0)
  const followAfterPrependRef = useRef(false)
  const prependAnchorRef = useRef<PrependAnchor | undefined>(undefined)
  const loadOlderRef = useRef<(silent?: boolean, beforeSeq?: number, chain?: boolean, maxRows?: number) => void>(() => {})
  // Latest closures without making the layout effect re-run on every render.
  const getScrollRef = useRef(getScroll)
  getScrollRef.current = getScroll
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  const captureAnchor = (silent: boolean): PrependAnchor | undefined => {
    const scroll = getScrollRef.current()
    const scroller = scroll?.scrollRef.current
    if (scroll === undefined || scroller === undefined) return undefined
    const row = silent ? undefined : captureRow(scroller)
    return {
      top: scroll.scrollTopRef.current,
      height: scroller.scrollHeight,
      ...(row === undefined ? {} : { rowId: row.id, rowTop: row.top, rowSeq: row.seq }),
    }
  }

  const loadOlder = useCallback((silent = false, beforeSeqOverride?: number, chain = false, maxRows?: number) => {
    if (pendingRef.current) {
      // A page is already in flight: remember this request and replay it once
      // the page lands. Dropping it makes the caller think it paged (search
      // "next" lands exactly on this race).
      queuedRef.current = { beforeSeq: beforeSeqOverride }
      return
    }
    pendingRef.current = true
    if (!silent) onLoading(true)

    const first = getFirstRow()
    if (first === undefined) {
      pendingRef.current = false
      if (!silent) onLoading(false)
      return
    }

    // Anchor BEFORE the request: React's commit-time focus restoration can
    // zero scrollTop while the old page is swapped, so measuring after the
    // await would anchor to the wrong content.
    const anchor = captureAnchor(silent)

    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort(new DOMException('load older timed out', 'TimeoutError'))
    }, LOAD_OLDER_TIMEOUT_MS)

    // A coalesced turn spans many step rows; page by its FIRST row's seq,
    // otherwise the request re-fetches steps already shown and prepending
    // duplicates their text. A locate may override the cursor.
    const beforeSeq = beforeSeqOverride ?? (first.startSeq ?? first.seq)
    const cached = pageCacheRef.current.get(beforeSeq)
    if (cached !== undefined) pageCacheRef.current.delete(beforeSeq)

    const pageRequest = cached === undefined
      ? loadChatPage(sessionId, beforeSeq, controller.signal, undefined, undefined, maxRows)
      : Promise.resolve(cached)

    void pageRequest.then(
      async (page) => {
        clearTimeout(timeout)
        pendingRef.current = false
        if (!silent) onLoading(false)

        const older = await preparePage(page)
        adoptPage(older, page, { silent, maxRows, beforeSeq, first })

        // Restore the reader's position for a manual prepend; a silent
        // auto-extend instead re-follows the tail at commit time.
        const scroll = getScrollRef.current()
        if (older.length > 0 && maxRows === undefined && scroll !== undefined) {
          if (silent && scroll.scrollStateRef.current.gap <= FOLLOW_THRESHOLD_PX) {
            followAfterPrependRef.current = true
          } else if (anchor !== undefined) {
            prependAnchorRef.current = anchor
          }
        }

        // An empty page must not write `hasOlder`: a skewed cursor also
        // returns empty, and treating it as "the end" freezes history forever.
        if (older.length > 0) setHasOlder(page.hasMore)

        // Silent auto-extend chain: stop at the page cap, history end, or the
        // target row count.
        if (chain && page.hasMore && chainPagesRef.current < OPEN_HISTORY_MAX_PAGES) {
          if (loadedRowCount() < OPEN_HISTORY_TARGET_ROWS) {
            chainPagesRef.current += 1
            loadOlderRef.current(true, undefined, true)
          }
        }

        // Replay the request that was blocked while this page was in flight.
        const queued = queuedRef.current
        if (queued !== undefined) {
          queuedRef.current = undefined
          loadOlderRef.current(true, queued.beforeSeq, false, maxRows)
        }
      },
      (reason: unknown) => {
        clearTimeout(timeout)
        pendingRef.current = false
        onLoading(false)
        // The auto-extend is best-effort: keep the loaded tail and the manual
        // button; only a user-initiated load surfaces the error.
        if (!silent) onError(reason)
        const queued = queuedRef.current
        if (queued !== undefined) {
          queuedRef.current = undefined
          loadOlderRef.current(true, queued.beforeSeq, false, maxRows)
        }
      },
    )
  }, [sessionId, getFirstRow, loadedRowCount, preparePage, adoptPage, onLoading, onError])

  loadOlderRef.current = loadOlder

  const markFollowAfterPrepend = useCallback(() => {
    followAfterPrependRef.current = true
  }, [])

  // Commit-time anchor restore + silent re-follow. Layout (not passive) so the
  // measurement happens after the prepended rows are in the DOM but before the
  // next paint.
  useLayoutEffect(() => {
    const scroll = getScrollRef.current()
    if (scroll === undefined) return
    const { scrollRef, scrollStateRef, setScrollTopProgrammatically, lastScrollHeightRef } = scroll
    const pending = prependAnchorRef.current
    if (pending !== undefined) {
      prependAnchorRef.current = undefined
      const box = scrollRef.current
      if (box !== undefined) {
        // With a concrete row, calibrate by SCREEN POSITION only: height delta
        // under-/over-shoots under windowed rendering (observed +17793px).
        if (pending.rowId === undefined) {
          const grown = box.scrollHeight - (pending.height ?? box.scrollHeight)
          if (grown > 0) {
            setScrollTopProgrammatically(box, pending.top + grown)
            lastScrollHeightRef.current = box.scrollHeight
          }
        }
        if (pending.rowId !== undefined && pending.rowTop !== undefined) {
          const rowId = pending.rowId
          const rowTop = pending.rowTop
          const rowSeq = pending.rowSeq
          const correct = (): void => {
            const scroller = scrollRef.current
            if (scroller === undefined) return
            let row = scroller.querySelector(`[data-message-id="${CSS.escape(rowId)}"]`)
            if (row === null && typeof rowSeq === 'number' && rowSeq > 0) {
              // The row may have been re-identified by the page merge: only an
              // EXACTLY equal seq is acceptable (a near neighbour may be half
              // a page away and would throw the reader).
              let best: Element | null = null
              let bestGap = Number.POSITIVE_INFINITY
              for (const candidate of scroller.querySelectorAll('[data-row-seq]')) {
                const gap = Math.abs(Number(candidate.getAttribute('data-row-seq') ?? '0') - rowSeq)
                if (gap < bestGap) { bestGap = gap; best = candidate }
              }
              row = best !== null && bestGap <= 1 ? best : null
            }
            if (row === null) return
            const delta = Math.round(row.getBoundingClientRect().top) - rowTop
            // Clamp absurd values: more than two viewports means the wrong
            // element; leave the reader where they are rather than yank them.
            if (Math.abs(delta) <= 2 || Math.abs(delta) > scroller.clientHeight * 2) return
            setScrollTopProgrammatically(scroller, Math.max(0, scroller.scrollTop + delta))
          }
          correct()
          requestAnimationFrame(correct)
          for (const delay of [80, 200, 400, 800]) window.setTimeout(correct, delay)
        }
      }
      // Silent prepend continues into the follow branch below.
      if (!followAfterPrependRef.current) return
    }
    if (!followAfterPrependRef.current) return
    followAfterPrependRef.current = false
    // Gate on `stick` (reader never scrolled up), not on the current gap: the
    // prepend itself grows content, so gap > 80 already and the follow would
    // never fire (observed 423px stranded).
    if (!scrollStateRef.current.stick && scrollStateRef.current.gap > FOLLOW_THRESHOLD_PX) return
    actionsRef.current.scrollToBottom()
    const box = scrollRef.current
    if (box !== undefined) lastScrollHeightRef.current = box.scrollHeight
    actionsRef.current.settleBottomAfterCommit()
  }, [messages])

  const recallSnapshot = useCallback(() => recallChatSnapshot(sessionId), [sessionId])

  return { hasOlder, setHasOlder, pendingRef, pageCacheRef, loadOlder, markFollowAfterPrepend, recallSnapshot }
}
