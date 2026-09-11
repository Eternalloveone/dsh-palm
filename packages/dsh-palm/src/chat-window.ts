/**
 * Host-side chat-window cache (v3 folded-view reads).
 *
 * The mobile chat page reads sessions through this service instead of the
 * raw `session.history` event stream: the host folds the event log into
 * renderable message rows ONCE per window, keeps the window live-fed by the
 * host mux stream, and serves folded rows on every later read — so a
 * repeat visit to a session costs zero log reads and the wire carries rows
 * (tens of KB) instead of the full event tail (hundreds of KB to MBs of
 * chunk/tool events).
 *
 * Correctness model:
 * - A window is a snapshot of one `session.history` tail page (the same
 *   page-boundary semantics, maxRows whole messages) plus every later event
 *   the host mux stream delivers for that session. The host process's mux
 *   stream is the authoritative append-only event feed, so between a window
 *   install and process exit the window is exactly "log tail + all events
 *   since" — no revision probing, no staleness window.
 * - That assumption is load-bearing and was silently false for a while
 *   (0.1.5 split `events.mux` and `session/event` stopped being forwarded), so
 *   the window is now **revalidated against the log on read**
 *   ({@link WINDOW_REVALIDATE_MS}): a read that finds the window older than the
 *   log catches up by folding the fresh tail page, and a read that finds a hole
 *   (the fresh page's oldest event sits above the window watermark) rebuilds the
 *   window from that page. Correctness therefore no longer depends on the push
 *   feed staying alive — a dead feed costs latency, never rows.
 * - `maxSeq` is the window's event watermark (EventFolder.lastSeq — above
 *   any row seq, since turn/end etc. never bump a row's seq). The phone
 *   restores its folder with (rows, maxSeq) so a live frame that a previous
 *   open already folded can never double-apply.
 * - Older pages (loadOlder) always read the log: they are low-frequency,
 *   and paging backward from a cached window would need log scans anyway.
 *   The returned page prepends into the live window so repeated upward
 *   paging of the same session still converges without re-folding the tail.
 * - Windows are bounded: WINDOW_LIMIT sessions LRU-evicted, WINDOW_ROW_LIMIT
 *   rows per window (head-trimmed; the watermark survives because trimming
 *   drops the OLDEST rows, never the newest event feed).
 * - `todo` carries the projection-equivalent todo state of the window (the
 *   phone's plan strip is seeded from the page, not from raw events): the
 *   newest todo/write list folded under the host projection's turn-boundary
 *   rules (turn/end normalizes a leftover in_progress to completed, turn/start
 *   clears the whole list) — so a reopened session can never reseed an
 *   intermediate snapshot the host projection already resolved;
 *   `projections` mirrors the projection block of the tail page plus any
 *   session/projection frames seen since (same higher-seq-wins rule the
 *   desktop client applies).
 */

import type { ApiProxy } from './api-proxy-types'
import type { RpcRequest } from './api-proxy-types'
import { RpcId } from './api-proxy-types'
import { EventFolder, foldEvents, foldTodoEvent, foldTodoSnapshot, lastOpenTurnStartTime } from './mobile/messages.ts'
import type { RenderMessage, TodoSnapshot, WireEvent } from './mobile/messages.ts'
import type { SessionProjectionsBlock } from './api-proxy-types'

/** Windows kept per process (sessions a phone actually opened, worst case). */
export const WINDOW_LIMIT = 20
/** Folded rows kept per window; older-than-this pages are re-read from the log. */
export const WINDOW_ROW_LIMIT = 400
/** Upper bound a phone may request in one page. */
export const READ_CHAT_MAX_ROWS = 200
/** Default page size (matches the mobile history default of 25). */
export const READ_CHAT_DEFAULT_ROWS = 25
/**
 * How long a resident window may go unverified before a read revalidates it
 * against the log (ms). Bounds both the staleness a dead push feed can cause
 * and the extra log reads revalidation costs.
 */
export const WINDOW_REVALIDATE_MS = 2000

/** One host history page as the window service sees it (post-envelope mapping). */
export interface ChatHistoryPage {
  readonly events: ReadonlyArray<{ readonly event: WireEvent; readonly view?: unknown }>
  readonly hasMore: boolean
  readonly projections?: SessionProjectionsBlock
}

/** One folded page served to the phone. */
export interface ChatPage {
  /** Folded message rows (never coalesced — the surface coalesces at render time). */
  rows: RenderMessage[]
  /** Event-seq watermark of the page's source window (replay floor). */
  maxSeq: number
  hasMore: boolean
  /** Newest valid todo/write snapshot in the page's events, when any. */
  todo?: TodoSnapshot
  /** Tail-page projection baseline, when available. */
  projections?: SessionProjectionsBlock
  /** The running turn's logged `turn/start` time (epoch ms) when the window
   *  contains an open turn boundary — the phone's turn-clock anchor (desktop
   *  parity). Absent when the last boundary is a `turn/end` or the boundary
   *  lies outside the window (the phone then falls back to mount time, as
   *  the desktop TurnStatus does). Tail pages carry it; older pages never do. */
  turnStartAt?: number
}

/** The host history read the service pages through (wired by the plugin). */
export type ChatHistoryFetcher = (
  sessionId: string,
  beforeSeq: number | undefined,
  maxMessages: number,
  /** Bypass the adapter's cursor TTL: the read must end at the current log. */
  fresh?: boolean,
) => Promise<ChatHistoryPage>

/** One window: the live fold plus its metadata. */
interface Window {
  folder: EventFolder
  maxSeq: number
  hasMore: boolean
  /** Projection-equivalent todo state (host turn-boundary rules folded in;
   *  undefined = cleared or never written). */
  todo: TodoSnapshot | undefined
  projections: SessionProjectionsBlock | undefined
  /** The window's open turn/start logged time (undefined: no open boundary). */
  turnStartAt: number | undefined
  lastAccessedAt: number
  /** Last time this window was verified against the log (revalidation clock). */
  verifiedAt: number
}

/**
 * The default history fetcher over the host ApiProxy: `session.history`
 * tail/earlier pages (exactly the pagination the desktop uses).
 */
export function defaultChatHistoryFetcher(apiProxy: ApiProxy): ChatHistoryFetcher {
  return async (sessionId, beforeSeq, maxMessages, fresh) => {
    const request: RpcRequest<{ sessionId: string; beforeSeq?: number; maxMessages: number; fresh?: boolean }> = {
      rpcId: RpcId('mobile-chat-window'),
      payload: {
        sessionId,
        maxMessages,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
        ...(fresh === true ? { fresh: true } : {}),
      },
    }
    const response = await apiProxy.sessions.history(request as never)
    if (!response.result.ok) {
      throw new Error(response.result.error.message)
    }
    const value = response.result.value
    return {
      events: value.events,
      hasMore: value.hasMore,
      ...(value.projections === undefined ? {} : { projections: value.projections }),
    }
  }
}

/** Wrap a raw history event entry in the mobile WireEvent envelope (view rides beside). */
function toWireEvent(entry: { event: WireEvent; view?: unknown }): WireEvent {
  return entry.view === undefined ? entry.event : { ...entry.event, view: entry.view }
}

/**
 * Bounded, mux-fed chat-window cache. All methods are synchronous-except-the-
 * log-read: a window hit serves from memory; only a cold window (or an
 * older-page read) touches the injected history fetcher.
 */
export class ChatWindowService {
  private readonly windows = new Map<string, Window>()

  constructor(private readonly fetchHistoryPage: ChatHistoryFetcher) {}

  /** Number of resident windows (diagnostics/tests). */
  get size(): number {
    return this.windows.size
  }

  /** Drop every window (tests; the service is otherwise process-lifetime). */
  clear(): void {
    this.windows.clear()
  }

  /**
   * The tail page (or the cached window when one exists): rows, the window's
   * event watermark, hasMore, todo and projections. A cold read installs a
   * window from one host history read (against the current log — the read is
   * `fresh`, so the install page cannot be capped by a stale cursor); later
   * tail reads serve memory, revalidating against the log at most once per
   * {@link WINDOW_REVALIDATE_MS}.
   */
  async tail(sessionId: string, maxRows: number): Promise<ChatPage> {
    const existing = this.windows.get(sessionId)
    if (existing !== undefined) {
      existing.lastAccessedAt = Date.now()
      if (Date.now() - existing.verifiedAt >= WINDOW_REVALIDATE_MS) {
        await this.revalidate(sessionId, existing, maxRows)
      }
      return pageOf(existing, maxRows)
    }
    const page = await this.fetchHistoryPage(sessionId, undefined, maxRows, true)
    return this.installWindow(sessionId, page, maxRows)
  }

  /**
   * Revalidate a resident window against the log and catch it up.
   *
   * The push feed is the fast path, not the source of truth: if it ever stops
   * delivering (a dropped subscription, a plugin reload, a gap the bus never
   * replayed), a window would otherwise serve stale rows for the rest of the
   * process lifetime — the exact failure this read-time check removes.
   *
   * - Fresh page watermark at or below the window's → nothing to do.
   * - Fresh page continues the window (its oldest event sits at or just above
   *   the watermark) → fold it in; the folder's watermark makes this idempotent.
   * - Fresh page starts above the watermark (a hole between them) → the window
   *   cannot be repaired by folding, so it is rebuilt from the fresh page; rows
   *   older than the page remain reachable through `before` (log reads).
   *
   * A failed read must not damage a good window: it only defers to the next
   * revalidation.
   */
  private async revalidate(sessionId: string, window: Window, maxRows: number): Promise<void> {
    let page: ChatHistoryPage
    try {
      page = await this.fetchHistoryPage(sessionId, undefined, maxRows, true)
    } catch {
      window.verifiedAt = Date.now()
      return
    }
    const events = page.events.map(toWireEvent)
    const fresh = new EventFolder(foldEvents(events))
    if (fresh.lastSeq > window.maxSeq) {
      const oldest = events.length > 0 ? (events[0]?.seq ?? -1) : -1
      if (window.maxSeq >= 0 && oldest > window.maxSeq + 1) {
        window.folder = fresh
        window.todo = foldTodoSnapshot(events)
        window.turnStartAt = lastOpenTurnStartTime(events)
      } else {
        for (const event of events) this.applyEvent(window, event)
      }
      window.maxSeq = window.folder.lastSeq
      window.hasMore = page.hasMore
      this.trimRows(window)
    }
    if (page.projections !== undefined) window.projections = page.projections
    window.verifiedAt = Date.now()
  }

  /**
   * One older page (loadOlder): always a log read, folded on the fly and
   * prepended into the live window when one exists (later reads of the same
   * session converge without re-reading the older page).
   */
  async before(sessionId: string, beforeSeq: number, maxRows: number): Promise<ChatPage> {
    const page = await this.fetchHistoryPage(sessionId, beforeSeq, maxRows)
    const events = page.events.map(toWireEvent)
    const folder = new EventFolder(foldEvents(events))
    const rows = folder.snapshot()
    const window = this.windows.get(sessionId)
    if (window !== undefined) {
      // Prepend keeps the live window continuous under the newer rows: the
      // seam is exact (host pages never cut a message), so no re-fold of the
      // window's own tail is needed.
      window.folder.prepend(rows)
      window.hasMore = page.hasMore
      window.lastAccessedAt = Date.now()
      this.trimRows(window)
    }
    return {
      rows,
      maxSeq: folder.lastSeq,
      hasMore: page.hasMore,
    }
  }

  /**
   * Feed one live session event (host mux `session/event` frame): folded
   * into the session's window when one is resident, ignored otherwise. The
   * watermark advances with the event, and the window's plan snapshot folds
   * the same turn-boundary rules the host projection applies (a todo/write
   * replaces it, turn/end normalizes leftovers, turn/start clears it).
   */
  handleEvent(sessionId: string, event: WireEvent): void {
    const window = this.windows.get(sessionId)
    if (window === undefined) return
    this.applyEvent(window, event)
    this.trimRows(window)
  }

  /**
   * Fold one event into a resident window: the row fold plus the derived state
   * the window carries (watermark, open-turn anchor, projection-equivalent todo).
   * Idempotent by seq, so the live feed and a revalidation page may overlap.
   */
  private applyEvent(window: Window, event: WireEvent): void {
    window.folder.fold([event])
    window.maxSeq = window.folder.lastSeq
    // Keep the open-turn anchor current for the turn clock (desktop parity):
    // a live boundary corrects it long before the phone opens the session.
    if (event.type === 'turn/start') {
      window.turnStartAt = typeof event.time === 'number' ? event.time : undefined
    } else if (event.type === 'turn/end') {
      window.turnStartAt = undefined
    }
    // Fold the event into the projection-equivalent todo state (the host's
    // own projection lives on the host session; this window keeps the phone
    // seed in lockstep: turn/start clears, turn/end normalizes in_progress
    // leftovers, todo/write replaces — never a raw newest-write overwrite).
    window.todo = foldTodoEvent(window.todo, event)
  }

  /**
   * Feed one host mux `session/projection` frame into the resident window's
   * projection baseline (the same higher-seq-wins rule the desktop client
   * applies to its value store).
   */
  handleProjection(sessionId: string, key: string, value: unknown, seq: number): void {
    const window = this.windows.get(sessionId)
    if (window === undefined) return
    const block = window.projections
    if (block !== undefined && block.asOfSeq > seq) return
    window.projections = {
      asOfSeq: seq,
      values: { ...(block?.values ?? {}), [key]: value },
    }
  }

  /** Route one host mux frame (the shared background watch's per-frame hook). */
  onFrame(frame: { payload?: unknown }): void {
    const payload = frame?.payload as
      | {
        type?: string
        sessionId?: string
        event?: WireEvent
        view?: unknown
        key?: string
        value?: unknown
        seq?: number
      }
      | undefined
    if (payload === null || typeof payload !== 'object') return
    if (payload.type === 'session/event' && typeof payload.sessionId === 'string' && payload.event !== undefined) {
      this.handleEvent(payload.sessionId, payload.view === undefined ? payload.event : { ...payload.event, view: payload.view })
      return
    }
    if (payload.type === 'session/projection' && typeof payload.sessionId === 'string' && typeof payload.key === 'string') {
      this.handleProjection(payload.sessionId, payload.key, payload.value, typeof payload.seq === 'number' ? payload.seq : -1)
    }
  }

  private installWindow(sessionId: string, page: ChatHistoryPage, maxRows: number): ChatPage {
    const events = page.events.map(toWireEvent)
    const folder = new EventFolder(foldEvents(events))
    const window: Window = {
      folder,
      maxSeq: folder.lastSeq,
      hasMore: page.hasMore,
      todo: foldTodoSnapshot(events),
      projections: page.projections,
      turnStartAt: lastOpenTurnStartTime(events),
      lastAccessedAt: Date.now(),
      verifiedAt: Date.now(),
    }
    this.windows.set(sessionId, window)
    if (this.windows.size > WINDOW_LIMIT) this.evictLeastRecent()
    this.trimRows(window)
    return pageOf(window, maxRows)
  }

  /** Head-trim a window past the row cap (oldest rows; the live feed survives). */
  private trimRows(window: Window): void {
    const rows = window.folder.snapshot()
    if (rows.length <= WINDOW_ROW_LIMIT) return
    // seed() rebuilds every index from the kept rows — no orphaned indexes
    // survive the trim, and the watermark stays (event feed, not rows).
    window.folder.seed(rows.slice(-WINDOW_ROW_LIMIT))
  }

  private evictLeastRecent(): void {
    let oldest: { id: string; at: number } | undefined
    for (const [id, window] of this.windows) {
      if (oldest === undefined || window.lastAccessedAt < oldest.at) oldest = { id, at: window.lastAccessedAt }
    }
    if (oldest !== undefined) this.windows.delete(oldest.id)
  }
}

/** Serve at most `maxRows` rows of a window's snapshot (rows are seq-sorted). */
function pageOf(window: Window, maxRows: number): ChatPage {
  const rows = window.folder.snapshot()
  return {
    rows: maxRows >= rows.length ? rows : rows.slice(-maxRows),
    maxSeq: window.maxSeq,
    hasMore: window.hasMore,
    ...(window.todo === undefined ? {} : { todo: window.todo }),
    ...(window.projections === undefined ? {} : { projections: window.projections }),
    ...(window.turnStartAt !== undefined ? { turnStartAt: window.turnStartAt } : {}),
  }
}
