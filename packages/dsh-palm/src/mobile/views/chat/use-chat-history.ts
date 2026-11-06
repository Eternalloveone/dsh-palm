/**
 * Paginated history loading for one chat.
 *
 * Owns the pieces that are pure bookkeeping: the in-flight latch, the coalesced
 * request queue (a click during a fetch must not be dropped), the per-page
 * cache (search prefetch), the abort/timeout, `hasOlder`, and the silent
 * auto-extend chain. The page content itself is rendered and merged by the
 * caller: `preparePage` turns a host page into rows (settled cards included)
 * and `adoptPage` folds them into the view's row model — those depend on the
 * chat's fold and on scroll anchoring, which is why they stay in ChatView for
 * now (S3b-2 moves the anchor half).
 *
 * Extracted from ChatView as the second slice of S3.
 *
 * @module dsh-palm/mobile/views/chat/use-chat-history
 */

import { useCallback, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { ChatPageResult } from '../App.tsx'
import { loadChatPage } from '../App.tsx'
import type { RenderMessage } from '../../messages.ts'

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
  /** Opaque anchor captured before the request (ChatView's shape). */
  anchor: unknown
}

/** Everything the pager needs from ChatView. */
export interface ChatHistoryOptions {
  sessionId: string
  /** First row currently in the fold (authoritative at call time). */
  getFirstRow(): RenderMessage | undefined
  /** Row count currently loaded (stops the auto-extend chain). */
  loadedRowCount(): number
  /** Render + card-recover one page (ChatView keeps this because it owns the fold). */
  preparePage(page: ChatPageResult): Promise<RenderMessage[]>
  /** Merge the rendered page into the view and apply the scroll anchor. */
  adoptPage(older: RenderMessage[], page: ChatPageResult, context: OlderPageContext): void
  /** Capture the visual anchor BEFORE the fetch (scrollTop/height/row). */
  captureAnchor?(): unknown
  /** Toggle the "加载中…" state (silent loads do not flash it). */
  onLoading(loading: boolean): void
  /** Surface a non-silent failure. */
  onError(reason: unknown): void
}

/** Pager state + entry point. */
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
}

/**
 * Create the history pager for one chat view.
 * @param options - session id plus the fold/anchor callbacks owned by ChatView.
 * @returns pager state and the `loadOlder` entry point.
 */
export function useChatHistory(options: ChatHistoryOptions): ChatHistoryHandle {
  const { sessionId, getFirstRow, loadedRowCount, preparePage, adoptPage, captureAnchor, onLoading, onError } = options
  const [hasOlder, setHasOlder] = useState(false)
  const pendingRef = useRef(false)
  const queuedRef = useRef<{ beforeSeq?: number } | undefined>(undefined)
  const pageCacheRef = useRef(new Map<number, ChatPageResult>())
  const chainPagesRef = useRef(0)
  const loadOlderRef = useRef<(silent?: boolean, beforeSeq?: number, chain?: boolean, maxRows?: number) => void>(() => {})

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

    const anchor = captureAnchor === undefined ? undefined : captureAnchor()

    const pageRequest = cached === undefined
      ? loadChatPage(sessionId, beforeSeq, controller.signal, undefined, undefined, maxRows)
      : Promise.resolve(cached)

    void pageRequest.then(
      async (page) => {
        clearTimeout(timeout)
        pendingRef.current = false
        if (!silent) onLoading(false)

        const older = await preparePage(page)
        adoptPage(older, page, { silent, maxRows, beforeSeq, first, anchor })
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
  }, [sessionId, getFirstRow, loadedRowCount, preparePage, adoptPage, captureAnchor, onLoading, onError])

  loadOlderRef.current = loadOlder

  return { hasOlder, setHasOlder, pendingRef, pageCacheRef, loadOlder }
}
