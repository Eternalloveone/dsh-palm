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
import { loadChatPage, type ChatPageResult } from '../../../data/chat-page.ts'
import type { RenderMessage } from '../../../render/messages.ts'
import { recallChatSnapshot } from '../../../session/chat-snapshot.ts'
import { FOLLOW_THRESHOLD_PX } from '../../../stream/scroll-machine.ts'
import { capturePrependAnchor, restorePrependScrollTop, type ChatScrollHandle, type PrependAnchor } from '../../../ui/hooks/use-stick-to-bottom.ts'
import { createPagePrefetchCache, type PagePrefetchCache } from '../../../history/page-prefetch-cache.ts'


/** Abort an older-page request that never answers (weak links hang, not fail). */
export const LOAD_OLDER_TIMEOUT_MS = 90_000
/**
 * How many silent pages the open-time auto-extend may load.
 *
 * 2026-11-15 恢复为 4：曾试过降到 2（想少拉点历史），但补页都发生在**首屏落地之后**，
 * 对"点下去多久看到内容"没有帮助，反而让"进会话一次铺开"的既有契约（ChatView 里
 * 「一次提交而不是一页页长出来」那组用例）失败。真正治首屏的是尾读合并与首屏闸门。
 */
export const OPEN_HISTORY_MAX_PAGES = 4
/**
 * Target row count for the open-time auto-extend.
 *
 * **2026-11-14：120 → 40。** 真机（4x CPU + 4G 仿真）实测一次进会话是
 * `1 次 sessionState + 4 次 session.history` **串行**：先要 120 行，而尾窗只装得下
 * 三四十行，于是链式往上补到 120 行才提交 —— 5 个来回、约 570 KB，首屏 3.1~3.5 s。
 * 但一屏只放得下 5~8 条消息，多出来的 80 行只是"往上滑时省一次请求"。
 * 改成 40 行（≈ 2~3 屏）后进会话只剩 1 个请求；更多的历史仍由原有的
 * hasOlder / 近顶自动补页负责，行为不变。单条特别高的会话不够 40 行时，
 * 下面的链仍会照旧补页（`loaded < OPEN_HISTORY_TARGET_ROWS`）。
 */
export const OPEN_HISTORY_TARGET_ROWS = 16

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

/** Pager state + entry points. */
export interface ChatHistoryHandle {
  /** Whether more history exists (kept in sync with adopted pages). */
  hasOlder: boolean
  setHasOlder: Dispatch<SetStateAction<boolean>>
  /** True while a page is in flight (also gates the near-top auto-load). */
  pendingRef: MutableRefObject<boolean>
  /** Prefetched pages by cursor (search "next" hit fetches ahead of time). */
  pageCacheRef: MutableRefObject<PagePrefetchCache>
  /**
   * Load one older page.
   * @param silent - auto-extend (no "加载中…" flash, failures stay quiet).
   * @param beforeSeq - explicit cursor (search locate); defaults to the first row.
   * @param chain - keep loading while under the open-time target.
   * @param maxRows - cap for a locate page (different window, no anchor shift).
   */
  loadOlder(silent?: boolean, beforeSeq?: number, chain?: boolean, maxRows?: number): void
  /** Capture a predicate that turns false when the session epoch changes. */
  captureSessionGuard(): () => boolean
  /** Ask the next commit to re-follow the tail (silent auto-extend). */
  markFollowAfterPrepend(): void
  /** The in-memory snapshot for this session (open-time seeding). */
  recallSnapshot(): { rows: RenderMessage[]; hasOlder: boolean } | undefined
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
  const queuedRef = useRef<{
    silent: boolean
    beforeSeq?: number
    chain: boolean
    maxRows?: number
  } | undefined>(undefined)
  // 预取页缓存有上限（Cache 内核，W4）：以前是个裸 Map，一次搜索跳转就塞一页，
  // 长会话里来回跳几十次就是几十页正文常驻内存。预取的意义只是"下一次点击不用等"，
  // 留最近几页足够。
  const pageCacheRef = useRef<PagePrefetchCache>(createPagePrefetchCache())
  const chainPagesRef = useRef(0)
  /** 链上一次看到的行数：没长就说明这段历史已经拉过（见 loadOlder 里的说明）。 */
  const chainRowMarkRef = useRef(0)
  const followAfterPrependRef = useRef(false)
  const prependAnchorRef = useRef<PrependAnchor | undefined>(undefined)
  const epochRef = useRef(0)
  const sessionIdRef = useRef(sessionId)
  const requestRef = useRef<{
    epoch: number
    controller: AbortController
    timeout: ReturnType<typeof setTimeout>
  } | undefined>(undefined)
  const loadOlderRef = useRef<(silent?: boolean, beforeSeq?: number, chain?: boolean, maxRows?: number) => void>(() => {})
  // Latest closures without making the layout effect re-run on every render.
  const getScrollRef = useRef(getScroll)
  getScrollRef.current = getScroll
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  // A pager instance survives route renders. Invalidate and abort its in-flight
  // request synchronously at the session boundary so a late page cannot write
  // through the previous render's adoptPage closure into the newly opened chat.
  useLayoutEffect(() => {
    epochRef.current += 1
    const epoch = epochRef.current
    sessionIdRef.current = sessionId
    chainPagesRef.current = 0
    pendingRef.current = false
    queuedRef.current = undefined
    followAfterPrependRef.current = false
    prependAnchorRef.current = undefined
    pageCacheRef.current = createPagePrefetchCache()
    setHasOlder(false)

    return () => {
      if (epochRef.current !== epoch) return
      epochRef.current += 1
      const request = requestRef.current
      if (request !== undefined && request.epoch === epoch) {
        clearTimeout(request.timeout)
        request.controller.abort(new DOMException('history session changed', 'AbortError'))
        requestRef.current = undefined
      }
      pendingRef.current = false
      queuedRef.current = undefined
      followAfterPrependRef.current = false
      prependAnchorRef.current = undefined
      pageCacheRef.current = createPagePrefetchCache()
    }
  }, [sessionId])

  const captureSessionGuard = useCallback(() => {
    const epoch = epochRef.current
    const owner = sessionId
    return () => epochRef.current === epoch && sessionIdRef.current === owner
  }, [sessionId])

  const loadOlder = useCallback((silent = false, beforeSeqOverride?: number, chain = false, maxRows?: number) => {
    if (pendingRef.current) {
      // A page is already in flight: remember this request and replay it once
      // the page lands. Dropping it makes the caller think it paged (search
      // "next" lands exactly on this race).
      queuedRef.current = { silent, beforeSeq: beforeSeqOverride, chain, maxRows }
      return
    }
    pendingRef.current = true
    if (!silent) onLoading(true)

    /*
     * 链的第一步：记下「现在屏幕上有多少行」。链唯一还该继续的理由是**真的补进了新行**；
     * 行数不动说明这段历史早就拉过了。
     *
     * 2026-11-15 真机实测：切一个会话，`session.history` 被两条链路各拉三页，
     * 参数逐字相同（25 / beforeSeq 2386 / beforeSeq 2235），255KB 拉了两遍、共 510KB；
     * 会话日志越大越贵（`session.history` 要解压整份日志，52MB 会话实测 34 秒）。
     * 第二条链之所以不停，就是因为它只看「行数 < 40」这个条件，而行数根本没变。
     */
    if (chain && chainPagesRef.current === 0) chainRowMarkRef.current = loadedRowCount()

    const first = getFirstRow()
    if (first === undefined) {
      pendingRef.current = false
      if (!silent) onLoading(false)
      return
    }

    // Anchor BEFORE the request: React's commit-time focus restoration can
    // zero scrollTop while the old page is swapped, so measuring after the
    // await would anchor to the wrong content.
    const anchor = capturePrependAnchor(getScrollRef.current(), silent)

    const controller = new AbortController()
    const requestEpoch = epochRef.current
    const timeout = setTimeout(() => {
      controller.abort(new DOMException('load older timed out', 'TimeoutError'))
    }, LOAD_OLDER_TIMEOUT_MS)
    const request = { epoch: requestEpoch, controller, timeout }
    requestRef.current = request
    const isCurrent = captureSessionGuard()
    const releaseRequest = (): void => {
      clearTimeout(timeout)
      if (requestRef.current === request) requestRef.current = undefined
    }
    const replayQueued = (): void => {
      const queued = queuedRef.current
      if (queued === undefined || !isCurrent()) return
      queuedRef.current = undefined
      loadOlderRef.current(queued.silent, queued.beforeSeq, queued.chain, queued.maxRows)
    }

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
        if (!isCurrent()) {
          // **不要在这里清 pendingRef**：这个响应属于上一个会话，而 pendingRef
          // 是跨会话共享的那一个 —— 此刻它代表的可能是新会话正在飞的请求
          // （`use-chat-history.test.tsx` 第 125 行就是钉这个的）。会话切换时的
          // 清理由上面的重置逻辑负责。
          releaseRequest()
          return
        }
        try {
          const older = await preparePage(page)
          if (!isCurrent()) {
            releaseRequest()
            return
          }

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
          // 但「空页 + 宿主明确说没有更早的了」是真的到头：必须收起按钮，否则用户
          // 一直点「加载更早的消息」屏幕上什么都不发生（真机「加载不出来」）。
          if (older.length > 0) setHasOlder(page.hasMore)
          else if (page.hasMore !== true) setHasOlder(false)

          releaseRequest()
          pendingRef.current = false
          if (!silent) onLoading(false)

          // Silent auto-extend chain: stop at the page cap, history end, or the
          // target row count. 行数没长也停（这一页的历史早就拉过了，再拉一模一样）。
          if (chain && page.hasMore && chainPagesRef.current < OPEN_HISTORY_MAX_PAGES) {
            const now = loadedRowCount()
            const grew = now > chainRowMarkRef.current
            chainRowMarkRef.current = now
            if (grew && now < OPEN_HISTORY_TARGET_ROWS) {
              chainPagesRef.current += 1
              loadOlderRef.current(true, undefined, true)
            }
          }

          replayQueued()
        } catch (reason: unknown) {
          releaseRequest()
          // 早退时不动 pendingRef：它可能是新会话正在飞的那个请求的状态
          // （见上面 success 分支的说明与 use-chat-history.test.tsx:125）。
          if (!isCurrent()) return
          pendingRef.current = false
          if (!silent) onLoading(false)
          if (!silent) onError(reason)
          replayQueued()
        }
      },
      (reason: unknown) => {
        releaseRequest()
        if (!isCurrent()) return
        pendingRef.current = false
        onLoading(false)
        // The auto-extend is best-effort: keep the loaded tail and the manual
        // button; only a user-initiated load surfaces the error.
        if (!silent) onError(reason)
        replayQueued()
      },
    )
  }, [sessionId, getFirstRow, loadedRowCount, preparePage, adoptPage, onLoading, onError, captureSessionGuard])

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
        const restore = (): void => {
          const scroller = scrollRef.current
          if (scroller === undefined) return
          const target = restorePrependScrollTop(scroller, pending)
          if (target === undefined) return
          setScrollTopProgrammatically(scroller, target)
          lastScrollHeightRef.current = scroller.scrollHeight
        }
        // With a concrete row, calibrate by screen position only: height
        // deltas under/overshoot under windowed rendering.
        if (pending.rowId === undefined) {
          restore()
        } else if (pending.rowTop !== undefined) {
          const correct = (): void => {
            restore()
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

  return { hasOlder, setHasOlder, pendingRef, pageCacheRef, loadOlder, captureSessionGuard, markFollowAfterPrepend, recallSnapshot }
}
