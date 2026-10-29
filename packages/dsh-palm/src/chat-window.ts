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
import { EventFolder, coalesceTurnMessages, foldTodoEvent, foldTodoSnapshot, lastOpenTurnStartTime } from './mobile/messages.ts'

/** 一页事件里最新的一条的时间；没有带时间的就返回 undefined（不知道，不当成"结束了"）。 */
function newestEventTime(events: readonly WireEvent[]): number | undefined {
  let newest: number | undefined
  for (const event of events) {
    if (typeof event.time !== 'number' || !Number.isFinite(event.time)) continue
    newest = newest === undefined ? event.time : Math.max(newest, event.time)
  }
  return newest
}
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
/**
 * How many messages one anchor peek reads behind a window. A turn can own a
 * long run of messages before its first assistant row, so the peek has to reach
 * past them in a single read; a turn whose start sits further back just keeps
 * its blank elapsed time.
 */
export const TURN_ANCHOR_PEEK_MESSAGES = 16

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
  /** Timestamp of the newest event in the page (epoch ms). Lets the phone tell a
   *  live turn from a lost `turn/end`: a running turn emits events constantly, so
   *  an "open" boundary whose newest event is old is a finished turn whose end
   *  frame never arrived. Absent on pages whose events carry no time. */
  lastEventAt?: number
  /** 这一轮到底还开着吗：true=最后一条边界是 turn/start，false=turn/end。
   *
   *  必须与 turnStartAt 分开说。turnStartAt 缺席有两种完全不同的意思——"收工了"
   *  和"这段窗口里根本没有边界事件"（一轮工具跑二十几步，48 帧尾切里全是工具事件，
   *  边界还在几十帧之外）。以前两者都被当成"收工"，于是命令正跑着，手机把这个回合
   *  判成已完成：真机实测，一轮进行中的会话 mobile.logTail 只回 rows/maxSeq/hasMore/
   *  lastEventAt，没有 turnStartAt。缺席＝不知道，不能再当"结束了"。 */
  turnOpen?: boolean
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
  /** 窗口里最新一条事件的时间（epoch ms）。手机上「边界开着但日志早就静了」这条判据
   *  全靠它：漏掉的 turn/end 不会重放，没有这个时间就只能一直显示「运行中」。 */
  lastEventAt: number | undefined
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

/** 冷装/校验时补边界要翻多少帧日志：要足够回看到上一轮的 turn/start 与 turn/end
 *  （一个跑了十几分钟的回合有几百条事件），又不至于把整份日志读进来。 */
export const BOUNDARY_TAIL_FRAMES = 2_000

/**
 * Wrap a history fetcher so every tail page also carries the newest turn
 * boundaries read straight from the log.
 *
 * `session.history` pages by MESSAGE, and `turn/end` is not a message: a window
 * holding the tail of a long turn arrives without that turn's end event, and
 * `turn/end` is the only event that carries the turn's finishing time. Without
 * the boundary the fold can never stamp a duration, and a finished turn shows a
 * bare 已完成 with no elapsed time — the oldest, most persistent complaint about
 * this screen. The log tail is a cheap read (server-side, tens of ms), and only
 * its boundary events are merged in, so nothing else about the page changes.
 *
 * Older pages (`beforeSeq` given) are left alone: they exist to extend history
 * upwards, and the live tail already supplies the boundaries.
 */
export function withLogTurnBoundaries(
  inner: ChatHistoryFetcher,
  readTail: (sessionId: string, options: { maxFrames: number }) => Promise<
    { lines: ReadonlyArray<{ event: Record<string, unknown> & { seq?: number } }> } | undefined
  >,
): ChatHistoryFetcher {
  return async (sessionId, beforeSeq, maxMessages, fresh) => {
    const page = await inner(sessionId, beforeSeq, maxMessages, fresh)
    if (beforeSeq !== undefined) return page
    try {
      const tail = await readTail(sessionId, { maxFrames: BOUNDARY_TAIL_FRAMES })
      const present = new Set(page.events.map(entry => entry.event.seq))
      const extra: Array<{ event: WireEvent; view?: unknown }> = []
      for (const line of tail?.lines ?? []) {
        const type = line.event['type']
        if (type !== 'turn/start' && type !== 'turn/end') continue
        const seq = line.event.seq
        if (typeof seq !== 'number') continue
        if (present.has(seq)) continue
        present.add(seq)
        extra.push({ event: line.event as unknown as WireEvent })
      }
      if (extra.length === 0) return page
      // 合并后必须按 seq 重新排好：`lastOpenTurnStartTime` 是"从数组尾部往前找
      // 第一个边界"的位置判据，不是按 seq 找。直接把边界塞到前面，它从尾部扫
      // 过去会先撞上 turn/end（本该在 turn/start 之后），于是把一个正开着的
      // 回合判成没有锚点——手机上就表现为"一进会话，用时从 0 开始数"。
      const merged = [...extra, ...page.events].sort((left, right) => {
        const a = typeof left.event.seq === 'number' ? left.event.seq : Number.MAX_SAFE_INTEGER
        const b = typeof right.event.seq === 'number' ? right.event.seq : Number.MAX_SAFE_INTEGER
        return a - b
      })
      return { ...page, events: merged }
    } catch {
      // A failed tail read must never cost the page: the window still renders,
      // it just reports no elapsed time for turns whose end it cannot see.
      return page
    }
  }
}

/** Wrap a raw history event entry in the mobile WireEvent envelope (view rides beside). */
function toWireEvent(entry: { event: WireEvent; view?: unknown }): WireEvent {
  return entry.view === undefined ? entry.event : { ...entry.event, view: entry.view }
}

/**
 * 这个事件是不是一轮的开头（用户消息 / turn/start）。
 *
 * 不是的话，这一页折出来的第一张卡只是「一轮的后半截」：手机上先画半截、索引先收
 * 半截，而窗口整体折叠出来的那一轮正文更多——索引坐标和渲染坐标从此对不上，搜索
 * 就会指到一段屏幕上不存在的文字。翻页要按回合边界切。
 */
function isTurnBoundaryEvent(event: WireEvent): boolean {
  return event.type === 'turn/start' || event.type === 'user/message'
}

/** 往前补读的次数上限：对不齐也要在一次翻页里收手，别把 loadOlder 拖成 N 次读。 */
const TURN_ALIGN_MAX_READS = 3

/** The turn an event belongs to (`data.turn`), when it carries one. */
function turnNumberOf(event: WireEvent): number | undefined {
  const data: unknown = event.data
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined
  const turn = (data as Record<string, unknown>)['turn']
  return typeof turn === 'number' && Number.isFinite(turn) ? turn : undefined
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

  /**
   * 取一页历史，并把页首对齐到回合开头。
   *
   * 宿主历史页按「条数」切，切点可能落在一轮（turn）中间：这一页折出来的第一行
   * 就是「半截回合」——只有后半段步骤。窗口按页预折叠、搜索索引按页建文档，两边
   * 都会把这个半截行当真，于是同一轮在索引里和在屏幕上长得不一样（真机：一条命中
   * 的正文只存在于索引里，落地的卡上一个高亮都没有）。往前补读到 turn/start 或
   * 用户消息为止，切点就固定在回合边界上，索引与渲染共用同一份折叠。
   */
  private async fetchAlignedPage(
    sessionId: string,
    beforeSeq: number | undefined,
    maxRows: number,
    fresh?: boolean,
  ): Promise<ChatHistoryPage> {
    let page = await this.fetchHistoryPage(sessionId, beforeSeq, maxRows, fresh)
    for (let attempt = 0; attempt < TURN_ALIGN_MAX_READS; attempt += 1) {
      const oldest = page.events[0]
      if (oldest === undefined) break
      const first = toWireEvent(oldest)
      if (isTurnBoundaryEvent(first)) break
      const seq = first.seq
      if (typeof seq !== 'number') break
      const older = await this.fetchHistoryPage(sessionId, seq, maxRows, fresh).catch(() => undefined)
      if (older === undefined || older.events.length === 0) break
      // 补读必须真的更早：游标若被当成「含端点」，同一段会被重复读三遍。
      const olderMax = older.events.reduce((max, item) => {
        const at = item.event.seq
        return typeof at === 'number' && at > max ? at : max
      }, -1)
      if (olderMax < 0 || olderMax >= seq) break
      const merged = [...older.events, ...page.events].sort((left, right) => {
        const a = typeof left.event.seq === 'number' ? left.event.seq : Number.MAX_SAFE_INTEGER
        const b = typeof right.event.seq === 'number' ? right.event.seq : Number.MAX_SAFE_INTEGER
        return a - b
      })
      page = {
        events: merged,
        hasMore: older.hasMore,
        ...(page.projections === undefined ? {} : { projections: page.projections }),
      }
    }
    return page
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
    const page = await this.fetchAlignedPage(sessionId, undefined, maxRows, true)
    return await this.installWindow(sessionId, page, maxRows)
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
    const fresh = new EventFolder()
    fresh.fold(events)
    if (fresh.lastSeq > window.maxSeq) {
      const oldest = events.length > 0 ? (events[0]?.seq ?? -1) : -1
      if (window.maxSeq >= 0 && oldest > window.maxSeq + 1) {
        // A rebuild replaces the folder wholesale. The fresh page is cut at a
        // message boundary, so the anchors it needs for its own turns are not in
        // it — inherit them from the folder being replaced, or every turn in the
        // new window loses its elapsed time (turn/end carries no duration).
        fresh.adoptAnchors(window.folder)
        window.folder = fresh
        window.todo = foldTodoSnapshot(events)
        window.turnStartAt = lastOpenTurnStartTime(events)
        window.lastEventAt = newestEventTime(events)
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
    const page = await this.fetchAlignedPage(sessionId, beforeSeq, maxRows)
    const events = page.events.map(toWireEvent)
    const folder = new EventFolder()
    folder.fold(events)
    const rows = coalesceTurnMessages(folder.snapshot())
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
    if (typeof event.time === 'number' && Number.isFinite(event.time)) {
      window.lastEventAt = window.lastEventAt === undefined ? event.time : Math.max(window.lastEventAt, event.time)
    }
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

  /**
   * Give the window's oldest turn its `turn/start` anchor back.
   *
   * A page is cut at a message boundary, so the `turn/start` of the turn that
   * owns the first message normally sits just outside it. `turn/end` carries
   * only the turn number, never a duration, so without that anchor the fold
   * cannot compute how long the turn took and its process head settles on a
   * bare 已完成 — the user sees a finished turn that reports no elapsed time.
   * Reading one page further back and prepending the anchor fixes it: a
   * turn/start renders nothing on its own, so it can only supply the missing
   * clock.
   *
   * This runs whether or not the turn has ended yet. Waiting for its `turn/end`
   * is exactly wrong: the window is installed while the turn is still running
   * (so it looks "not ended" and is skipped), the window is then cached, and
   * when the end finally arrives the anchor is already out of reach — the turn
   * that just finished forever reports no elapsed time.
   */
  private async withTurnAnchors(sessionId: string, events: readonly WireEvent[]): Promise<WireEvent[]> {
    let firstTurn: number | undefined
    const anchored = new Set<number>()
    for (const event of events) {
      const turn = turnNumberOf(event)
      if (turn === undefined) continue
      if (event.type === 'turn/start') anchored.add(turn)
      const isMessage = event.type === 'assistant/message' || event.type === 'assistant/chunk'
      if (isMessage && firstTurn === undefined) firstTurn = turn
    }
    const oldest = events[0]?.seq
    if (firstTurn === undefined || anchored.has(firstTurn) || oldest === undefined) return [...events]
    try {
      // A turn can own a long run of messages before its first assistant row,
      // so the peek has to be wide enough to reach the boundary in one read:
      // four messages stopped short of a real session's anchor, sixteen reached
      // it. One read is the budget — a turn whose start sits further back keeps
      // its blank clock rather than costing the open another round trip.
      const older = await this.fetchHistoryPage(sessionId, oldest, TURN_ANCHOR_PEEK_MESSAGES)
      const anchors = older.events
        .map(toWireEvent)
        .filter(event => event.type === 'turn/start' && turnNumberOf(event) === firstTurn)
      return anchors.length === 0 ? [...events] : [...anchors, ...events]
    } catch {
      // A failed peek costs the elapsed time, never the window.
      return [...events]
    }
  }

  private async installWindow(sessionId: string, page: ChatHistoryPage, maxRows: number): Promise<ChatPage> {
    const events = await this.withTurnAnchors(sessionId, page.events.map(toWireEvent))
    const folder = new EventFolder()
    folder.fold(events)
    const window: Window = {
      folder,
      maxSeq: folder.lastSeq,
      hasMore: page.hasMore,
      todo: foldTodoSnapshot(events),
      projections: page.projections,
      turnStartAt: lastOpenTurnStartTime(events),
      lastEventAt: newestEventTime(events),
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
    // 窗口是从日志折出来的，它的锚点只有两种来源：边界事件，或者"整页都没有边界"，
    // 后者窗口本身会记成 undefined。窗口知道边界信息，所以这里可以明确说开/关。
    turnOpen: window.turnStartAt !== undefined,
    ...(window.lastEventAt === undefined ? {} : { lastEventAt: window.lastEventAt }),
  }
}

