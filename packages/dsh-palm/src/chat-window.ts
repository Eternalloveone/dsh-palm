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
 * - `todo` carries the newest valid todo/write inside the window (the
 *   phone's plan strip is seeded from the page, not from raw events);
 *   `projections` mirrors the projection block of the tail page plus any
 *   session/projection frames seen since (same higher-seq-wins rule the
 *   desktop client applies).
 */

import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { EventFolder, foldEvents, lastOpenTurnStartTime, latestTodoSnapshot, parseTodoList } from './mobile/messages.ts'
import type { RenderMessage, TodoSnapshot, WireEvent } from './mobile/messages.ts'
import type { SessionProjectionsBlock } from '@deepseek-ai/dsh-host-apiproxy/api/sessions'

/** Windows kept per process (sessions a phone actually opened, worst case). */
export const WINDOW_LIMIT = 20
/** Folded rows kept per window; older-than-this pages are re-read from the log. */
export const WINDOW_ROW_LIMIT = 400
/** Upper bound a phone may request in one page. */
export const READ_CHAT_MAX_ROWS = 200
/** Default page size (matches the mobile history default of 25). */
export const READ_CHAT_DEFAULT_ROWS = 25

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
  /** Newest valid todo/write inside the page's events, when any. */
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
) => Promise<ChatHistoryPage>

/** One window: the live fold plus its metadata. */
interface Window {
  folder: EventFolder
  maxSeq: number
  hasMore: boolean
  todo: TodoSnapshot | undefined
  projections: SessionProjectionsBlock | undefined
  /** The window's open turn/start logged time (undefined: no open boundary). */
  turnStartAt: number | undefined
  lastAccessedAt: number
}

/**
 * The default history fetcher over the host ApiProxy: `session.history`
 * tail/earlier pages (exactly the pagination the desktop uses).
 */
export function defaultChatHistoryFetcher(apiProxy: ApiProxy): ChatHistoryFetcher {
  return async (sessionId, beforeSeq, maxMessages) => {
    const request: RpcRequest<{ sessionId: string; beforeSeq?: number; maxMessages: number }> = {
      rpcId: RpcId('mobile-chat-window'),
      payload: {
        sessionId,
        maxMessages,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
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
   * window from one host history read; later tail reads never touch the log
   * again until process restart.
   */
  async tail(sessionId: string, maxRows: number): Promise<ChatPage> {
    const existing = this.windows.get(sessionId)
    if (existing !== undefined) {
      existing.lastAccessedAt = Date.now()
      return pageOf(existing, maxRows)
    }
    const page = await this.fetchHistoryPage(sessionId, undefined, maxRows)
    return this.installWindow(sessionId, page, maxRows)
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
   * watermark advances with the event, and a todo/write updates the window's
   * plan-snapshot seed.
   */
  handleEvent(sessionId: string, event: WireEvent): void {
    const window = this.windows.get(sessionId)
    if (window === undefined) return
    window.folder.fold([event])
    window.maxSeq = window.folder.lastSeq
    // Keep the open-turn anchor current for the turn clock (desktop parity):
    // a live boundary corrects it long before the phone opens the session.
    if (event.type === 'turn/start') {
      window.turnStartAt = typeof event.time === 'number' ? event.time : undefined
    } else if (event.type === 'turn/end') {
      window.turnStartAt = undefined
    }
    if (event.type === 'todo/write') {
      const items = parseTodoList(event.data)
      if (items !== undefined) window.todo = { seq: event.seq, items }
    }
    this.trimRows(window)
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
      todo: latestTodoSnapshot(events),
      projections: page.projections,
      turnStartAt: lastOpenTurnStartTime(events),
      lastAccessedAt: Date.now(),
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
