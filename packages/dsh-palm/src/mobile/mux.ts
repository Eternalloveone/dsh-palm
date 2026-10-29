/**
 * Mobile-surface live-event client: the plugin's `/m/api/events.mux` SSE
 * channel (Server-Sent Events — the host bridges the mux stream onto it, so
 * no WebSocket handshake or framing is needed on this side). The host
 * pushes mux frames (subscribed baselines, session events, approvals,
 * questions, queue snapshots, tasks, projections) as soon as the stream
 * opens — no subscription handshake is needed. Frames arrive as
 * server-request envelopes whose payload is the mux frame; unknown frame
 * types are dropped so a newer host never breaks this client.
 *
 * EventSource reconnects automatically — but only over a tunnel that
 * actually forwards frames. Public quick tunnels (Cloudflare quick tunnel /
 * Tailscale Serve) do not transparently pass Server-Sent Events: ordinary
 * HTTP works, yet the SSE connection stays open or reconnects with zero
 * bytes, so no live frame ever arrives. That is a transport-layer limit of
 * the tunnel, not something the host can fix. This client therefore
 * degrades gracefully: once the SSE channel has silently stalled (no frame
 * for {@link MuxClientOptions.stallThresholdMs}, or the EventSource reports
 * an error), it starts polling the open session's history over plain HTTP
 * (the `/m/api/session.history` RPC — unaffected by the SSE limitation),
 * and re-emits freshly appended events as `session/event` frames through
 * the same subscriber contract, so listeners (and the message fold) behave
 * exactly as if the frames had arrived over SSE. When the SSE channel
 * delivers again, fallback polling stops and the live stream takes over.
 */

import type { MuxFrame } from '../api-proxy-types'
import type { JobView } from '../api-proxy-types'
import type { HistoryEntry } from '../api-proxy-types'
import { history as fetchHistory, listSessions as listSessionRows, queueItemViewOf, type HistoryPage, type QueueItemView } from './api.ts'
import { runningSessions as runningSessionIds, turnState as turnStateOf } from './api.ts'
import { RunningMirror } from './running-mirror.ts'
import { RpcTransportError } from './rpc.ts'
import { perfAnomaly, perfEnabled, perfMark } from './perf.ts'

/** Injectable seams for tests. */
export interface MuxClientOptions {
  /** EventSource factory (defaults to the browser EventSource). */
  sourceFactory?: (url: string) => EventSourceLike
  /**
   * Fetch one history page (tail) for a session — the polling fallback's
   * data source. Defaults to the mobile `session.history` RPC, which rides
   * the ordinary HTTP channel (unaffected by SSE-impairing tunnels).
   */
  /**
   * History page fetcher for fallback polling. Omit `beforeSeq` for the
   * newest page; pass a seq to page backwards (gap refill).
   */
  pollLatest?: (sessionId: string, beforeSeq?: number) => Promise<HistoryPage>
  /** Initial poll cadence while SSE is stalled (default 3000 ms). Empty polls back off to 60000 ms. */
  pollIntervalMs?: number
  /** Initial SSE stall window (default 12000 ms); a previously-live stream gets three windows before fallback. */
  stallThresholdMs?: number
  /** Clock seam for tests (defaults to Date.now). */
  now?: () => number
  /** 宿主运行集合探针（默认走 mobile.runningSessions；测试注入假数据）。 */
  runningProbe?: () => Promise<string[]>
  /**
   * 逐条复核「这个会话真的还在跑吗」（默认走 mobile.turnState —— 聊天页判定
   * 运行中用的就是同一个接口）。宿主的运行集合本身是一份帧镜像：漏掉一条
   * turn/end 之后要等五分钟静默上限才会掉，期间花名册页会一直说「有会话在跑」，
   * 而点进去聊天页当场一问宿主却是空闲的。复核就是为了让两边同一口径。
   */
  verifyRunning?: (sessionId: string) => Promise<boolean>
  /** 运行集合校准间隔（默认 60 秒；测试可缩短）。 */
  runningResyncMs?: number
  /**
   * Called when the polling fallback hits a terminal (unpaired) error — the
   * device was revoked or remote control was stopped. The client has already
   * stopped itself (no more polling, no more SSE); the UI uses this to enter
   * the unpaired state instead of silently polling forever into a 60 s backoff.
   */
  onUnpaired?: () => void
}

/** The EventSource subset this client uses (browser EventSource fits). */
export interface EventSourceLike {
  onmessage: ((event: { data: string }) => void) | null
  onerror: ((event: unknown) => void) | null
  close(): void
}

/** Browser default source factory. */
function browserSource(url: string): EventSourceLike {
  // The DOM EventSource is structurally compatible; the `this`-typed handler
  // signatures differ, so the narrow face takes it through an adapter cast.
  return new EventSource(url) as unknown as EventSourceLike
}

/** The `session/event` arm of the mux frame union. */
type SessionEventFrame = Extract<MuxFrame, { type: 'session/event' }>

const DEFAULT_POLL_INTERVAL_MS = 3000
const DEFAULT_STALL_THRESHOLD_MS = 12000
const LIVE_SSE_STALL_MULTIPLIER = 3
const MAX_POLL_BACKOFF_MS = 60000
/**
 * Stall-check granularity: the single scheduler tick runs at least this
 * often so fallback arms within a second of the stall threshold passing,
 * while the poll cadence itself stays {@link MuxClientOptions.pollIntervalMs}.
 */
const STALL_CHECK_MS = 1000
/** Poll window: enough recent events to cover a few seconds of agent output. */
const DEFAULT_POLL_PAGE_SIZE = 50
/**
 * Cap on retained per-session background-task snapshots. The mux stream opens
 * at app boot and runs for the page lifetime, so a `session/jobs` frame for a
 * session the user never opens would otherwise be cached forever; the bound
 * keeps the map from growing without limit across the roster.
 */
const MAX_CACHED_JOBS_SESSION = 64
/** 基线帧的密集程度小于这个间隔 = 新一条连接（宿主每次重连都重订阅所有会话）。 */
const SUBSCRIBED_GENERATION_GAP_MS = 5_000
/** 运行集合的周期性校准间隔：漏掉的 turn/end 帧只能在下一轮探针里被纠正。 */
const RUNNING_RESYNC_INTERVAL_MS = 60_000
/** 校准失败的重试上限（指数退避，从 30 秒起）。 */
const RUNNING_RESYNC_MAX_BACKOFF_MS = 5 * 60_000
/** 证据比这个更旧的「运行中」才值得向宿主逐条复核（刚看到 turn/start 的不问）。 */
const RUNNING_VERIFY_STALE_MS = 45_000
/** 一轮最多复核几个会话：花名册上一屏通常 0～2 个，多的下一轮再说。 */
const RUNNING_VERIFY_MAX = 8

/**
 * Known mux frame discriminants, mirroring the host's frame union. Unknown
 * frames are dropped exactly like the schema-validated version did.
 */
const MUX_FRAME_TYPES = new Set<string>([
  'session/event',
  'session/subscribed',
  'approval/requested',
  'approval/resolved',
  'question/requested',
  'question/resolved',
  'session/queue',
  'session/jobs',
  'session/projection',
  'session/added',
  'session/removed',
  'session/status',
  'session/activity',
  'session/error',
  'stream/error',
  // Keep-alive from the host. It carries no state; the client only uses it as
  // proof the transport is still delivering (see handleMessage). It has to be
  // a real frame rather than an SSE comment line, because the EventSource spec
  // discards comments without ever surfacing them to the page — which made an
  // idle stream look dead and dropped every phone onto 3 s polling.
  'mux/ping',
])

/**
 * Structural guard for one SSE payload: a `server-request` envelope whose
 * payload carries a known mux frame discriminant.
 *
 * This replaces the two zod schemas that used to validate the channel. Those
 * schemas were the only value imports pulling zod into the phone bundle, and
 * they measured ~60 KB raw / ~16 KB gzip for what amounts to two shape checks
 * (the phone only ever reads `type` plus per-arm fields it narrows locally).
 * `session/event` additionally requires an object `event`, because its readers
 * dereference `event.type` unconditionally.
 * @param data - one raw SSE `data:` payload.
 * @returns the frame plus its envelope rpcId, or undefined for anything the
 * phone must not act on.
 */
function parseMuxEnvelope(data: string): { frame: MuxFrame; rpcId: string } | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const envelope = parsed as { type?: unknown; rpcId?: unknown; method?: unknown; payload?: unknown }
  if (envelope.type !== 'server-request') return undefined
  if (typeof envelope.rpcId !== 'string' || typeof envelope.method !== 'string') return undefined
  const frame = envelope.payload
  if (typeof frame !== 'object' || frame === null) return undefined
  const type = (frame as { type?: unknown }).type
  if (typeof type !== 'string' || !MUX_FRAME_TYPES.has(type)) return undefined
  if (type === 'session/event') {
    const event = (frame as { event?: unknown }).event
    if (typeof event !== 'object' || event === null) return undefined
  }
  return { frame: frame as MuxFrame, rpcId: envelope.rpcId }
}

/**
 * Whether a polling error is terminal — the device is no longer paired. The
 * mobile RPC carrier maps the pairing gate's 403 (and any 401) to an
 * RpcTransportError whose message is the HTTP status literal; a business
 * 'unpaired' message is the same condition. Any other error (network, 5xx,
 * history paging) is transient and must keep the backoff loop alive.
 */
function isTerminalPollError(error: unknown): boolean {
  if (!(error instanceof RpcTransportError)) return false
  return error.message === 'HTTP 403'
    || error.message === 'HTTP 401'
    || error.message.includes('unpaired')
}

/**
 * Keep one SSE subscription open, fanning validated frames out to
 * subscribers. EventSource owns reconnection (with its own backoff); this
 * class only manages the subscription lifecycle, plus a polling fallback
 * that keeps the open session live when the SSE channel cannot deliver.
 */
export class MuxClient {
  private readonly sourceFactory: (url: string) => EventSourceLike
  private readonly pollLatest: (sessionId: string, beforeSeq?: number) => Promise<HistoryPage>
  private readonly pollIntervalMs: number
  private readonly stallThresholdMs: number
  private readonly now: () => number
  private readonly onUnpaired: (() => void) | undefined
  private readonly listeners = new Set<(frame: MuxFrame, rpcId?: string) => void>()
  /**
   * Latest `session/jobs` snapshot per session, retained regardless of whether
   * a {@link ChatView} listener was mounted when the frame arrived. The mux
   * stream opens once at app boot and the host's jobs baseline rides that
   * opening, so without this a background task running before the user opens a
   * chat would never appear — the baseline arrives with zero listeners and is
   * otherwise dropped. Kept at the client (not per-view) so a freshly mounted
   * chat can replay its session's last known tasks on entry.
   */
  private readonly cachedJobsBySession = new Map<string, JobView[]>()
  /**
   * Latest `session/queue` snapshot per session, retained regardless of
   * whether a ChatView listener was mounted when the frame arrived (same
   * rationale as cachedJobsBySession: the mux opens at boot, so a queue
   * baseline arriving with zero listeners would otherwise be lost and a
   * freshly opened chat would show an empty queue until the next change).
   */
  private readonly cachedQueueBySession = new Map<string, QueueItemView[]>()
  /**
   * Session ids whose turn is currently open, derived from the `turn/start`
   * and `turn/end` events every session streams over the mux. Retained for
   * the page lifetime exactly like the jobs/queue mirrors, so a surface
   * mounted later (the run-overview page) still sees a session that started
   * generating before it opened — the turn/start frame itself is long gone
   * by then, and session.list's 60 s TTL can still report running:false.
   */
  /** 运行中镜像（帧 + 宿主探针两路证据，见 running-mirror.ts）。 */
  private readonly running = new RunningMirror()
  /** 周期性校准的定时器（漏掉的 turn/end 帧只能靠它收敛）。 */
  private runningResyncTimer: ReturnType<typeof setInterval> | undefined
  /** 校准失败后的退避（毫秒）；成功后复位到基数。 */
  private runningResyncBackoffMs = RUNNING_RESYNC_INTERVAL_MS
  /** 宿主运行集合探针。 */
  private readonly runningProbe: () => Promise<string[]>
  /** 逐条复核「真的还在跑吗」（见 MuxClientOptions.verifyRunning）。 */
  private readonly verifyRunning: (sessionId: string) => Promise<boolean>
  /** 校准间隔基数。 */
  private readonly runningResyncMs: number
  /** 上一轮 session/subscribed 基线帧的时间：断线重连时宿主会把每个会话重新
   *  订阅一遍，那批帧之间的间隔远小于正常帧间隔，用它识别"新一轮连接"。 */
  private lastSubscribedAt = 0
  private source: EventSourceLike | undefined
  private stopped = false
  /** Released on purpose because the page is hidden (see {@link pause}). */
  private paused = false
  private readonly url: string
  /** Last live session/event seq seen per session (perf gap detection). */
  private readonly lastEventSeqBySession = new Map<string, number>()

  /** The session to keep live via fallback polling (undefined = none). */
  private observeSessionId: string | undefined
  /** Last epoch ms the SSE channel produced a frame (or the stream opened). */
  private lastDataAt = 0
  /**
   * Whether the SSE channel has ever delivered a frame in this stream (a
   * delivered frame proves the tunnel can forward SSE; sustained silence may
   * still mean a suspended mobile tunnel, so polling re-arms after 3 windows).
   */
  private sseAlive = false
  /** Per-session highest event seq already emitted, for poll dedup. */
  private readonly pollWatermark = new Map<string, number>()
  /** Single scheduler tick: both the stall check and the poll cadence ride this one interval. */
  private tickTimer: ReturnType<typeof setInterval> | undefined
  private polling = false
  /** Epoch ms of the next due poll while polling (kept on the same tick timer). */
  private nextPollAt = 0
  /** Adaptive delay: productive polls reset it; empty/error polls add one base interval up to one minute. */
  private pollDelayMs: number

  /**
   * @param url - the mobile events endpoint (browser-relative).
   * @param options - seams.
   */
  constructor(url = '/m/api/events.mux', options: MuxClientOptions = {}) {
    this.url = url
    this.sourceFactory = options.sourceFactory ?? browserSource
    this.pollLatest = options.pollLatest ?? ((sessionId, beforeSeq) => fetchHistory(sessionId, beforeSeq, DEFAULT_POLL_PAGE_SIZE))
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.pollDelayMs = this.pollIntervalMs
    this.stallThresholdMs = options.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS
    this.now = options.now ?? (() => Date.now())
    this.runningProbe = options.runningProbe ?? (async () => (await runningSessionIds()).sessionIds)
    this.verifyRunning = options.verifyRunning ?? (async sessionId => (await turnStateOf(sessionId)).running === true)
    this.runningResyncMs = options.runningResyncMs ?? RUNNING_RESYNC_INTERVAL_MS
    this.runningResyncBackoffMs = this.runningResyncMs
    this.onUnpaired = options.onUnpaired
  }

  /** Open the stream (idempotent; EventSource reconnects until {@link stop}). */
  start(): void {
    this.stopped = false
    this.paused = false
    this.lastDataAt = this.now()
    if (this.source === undefined) this.connect()
    this.startTick()
    this.armRunningResync()
  }

  /** Close for good. */
  stop(): void {
    this.stopped = true
    if (this.runningResyncTimer !== undefined) {
      clearTimeout(this.runningResyncTimer)
      this.runningResyncTimer = undefined
    }
    this.stopTick()
    this.stopPolling()
    this.closeSource()
    this.observeSessionId = undefined
    this.nextPollAt = 0
  }

  /**
   * Release the transport because the page went to the background, keeping the
   * client resumable — {@link resync} on the way back rebuilds the socket and
   * replays the gap.
   *
   * The host already stops folding and pushing a released observation, so the
   * frames stop; this drops the socket itself, so a pocketed page holds one
   * live stream (the notify channel) instead of two idle ones, and no 1 s tick
   * wakes a frozen tab. Deliberately NOT {@link stop}: nothing here is
   * terminal, and the observation id, caches and poll watermarks all survive
   * for the return.
   */
  pause(): void {
    if (this.stopped || this.paused) return
    this.paused = true
    this.stopTick()
    this.stopPolling()
    this.closeSource()
  }

  /** Subscribe to validated frames; returns an unsubscribe function. The
   * rpcId is the server-request envelope's id (the wire correlation approval
   * and question answers must echo). */
  onFrame(listener: (frame: MuxFrame, rpcId?: string) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Whether the SSE channel is currently delivering (false while it has been
   * silent past the stall window, or after {@link stop}). Sibling throttles —
   * e.g. the pending approval/question poll — use this to stay slow while
   * the live stream works and fast only while it is down.
   */
  isSseLive(): boolean {
    return !this.stopped && !this.isSseStalled()
  }

  /**
   * Point the fallback at one open session (or `undefined` to stop it).
   * While the SSE channel is stalled this client polls that session's
   * history and re-emits new events as `session/event` frames.
   */
  observe(sessionId: string | undefined): void {
    const changed = this.observeSessionId !== sessionId
    this.observeSessionId = sessionId
    if (sessionId === undefined) {
      this.stopPolling()
      // Nothing left to schedule (no observed session, no polling), so the 1 s
      // tick would only wake a backgrounded phone to do nothing. `observe(id)`
      // and `resync()` both restart it.
      this.stopTick()
      return
    }
    this.startTick()
    if (this.paused) return
    if (changed) {
      // A session switch resets the poll state: the previous session's
      // backoff (up to MAX_POLL_BACKOFF_MS of silence) says nothing about
      // the new session's stream, so poll the new session immediately
      // instead of waiting out the old stall window. Watermarks of other
      // sessions are dropped too — the fold is idempotent by message id, so
      // replaying their history later cannot duplicate rows.
      this.pollDelayMs = this.pollIntervalMs
      this.nextPollAt = 0
      for (const key of this.pollWatermark.keys()) {
        if (key !== sessionId) this.pollWatermark.delete(key)
      }
    }
    // If SSE is already stalled for this session, start patching right away.
    if (!this.polling && !this.stopped && this.isSseStalled()) this.startPolling()
  }

  /**
   * A user action (e.g. a prompt was just sent) produced fresh activity:
   * drop the poll backoff so the fallback picks the new events up without
   * waiting out the current stall window.
   */
  poke(): void {
    if (this.stopped || this.paused) return
    this.pollDelayMs = this.pollIntervalMs
    this.nextPollAt = 0
  }

  /**
   * Force a resync when the page returns to the foreground.
   *
   * A backgrounded PWA is frozen by the browser: its timers stop, and a tunnel
   * can drop the SSE socket without the page ever seeing an error — the stream
   * then still reads "alive" while nothing arrives (exactly the failure mode a
   * background desktop tab shows). Resume therefore shortcuts the live-stream
   * grace period: silence that already outlived the base stall window means
   * the socket is not delivering, so rebuild it and let the history fallback
   * replay the gap immediately; a stream that was still delivering only needs
   * its backoff cleared.
   */
  resync(): void {
    if (this.stopped) return
    // A paused client has no socket to check (see pause): returning from the
    // background always rebuilds, however short the pause was, because the
    // elapsed silence cannot tell a released transport from a live one.
    const wasPaused = this.paused
    this.paused = false
    // Idempotent: a browser that suspended the page also suspended the timer.
    this.startTick()
    if (wasPaused || this.now() - this.lastDataAt > this.stallThresholdMs) {
      this.closeSource()
      this.connect()
      if (this.observeSessionId !== undefined) this.startPolling()
      return
    }
    this.poke()
  }

  private connect(): void {
    // A fresh stream starts unknown; only a delivered frame proves it works.
    this.sseAlive = false
    const source = this.sourceFactory(this.url)
    this.source = source
    source.onmessage = (event) => {
      this.handleMessage(event.data)
    }
    source.onerror = () => {
      // EventSource reconnects by itself; when we are closing, detach first
      // so the native reconnect cannot outlive stop(). Otherwise an error is
      // a strong signal the transport is not delivering — degrade to polling.
      if (this.stopped && this.source === source) {
        this.closeSource()
        return
      }
      this.sseAlive = false
      if (this.observeSessionId !== undefined) this.startPolling()
    }
  }

  /**
   * The single scheduler tick is the only interval this client owns. One
   * timer (at the finer of the stall-check and poll cadences) both arms the
   * polling fallback once the stall threshold passes and drives each poll at
   * {@link MuxClientOptions.pollIntervalMs} — one timer instead of two.
   */
  private startTick(): void {
    if (this.tickTimer !== undefined) return
    const cadence = Math.min(this.pollIntervalMs, STALL_CHECK_MS)
    this.tickTimer = setInterval(() => { this.tick() }, cadence)
  }

  private stopTick(): void {
    if (this.tickTimer !== undefined) {
      clearInterval(this.tickTimer)
      this.tickTimer = undefined
    }
  }

  private tick(): void {
    if (this.stopped) return
    if (this.observeSessionId === undefined) return
    if (this.polling) {
      // The stall phase has ended; the same tick now paces the adaptive polls.
      if (this.now() >= this.nextPollAt) {
        // pollTick schedules the next run after it settles, so slow requests
        // cannot overlap with another scheduler tick.
        this.nextPollAt = Number.POSITIVE_INFINITY
        void this.pollTick()
      }
      return
    }
    if (this.isSseStalled()) this.startPolling()
  }

  private isSseStalled(): boolean {
    const windowMs = this.sseAlive
      ? this.stallThresholdMs * LIVE_SSE_STALL_MULTIPLIER
      : this.stallThresholdMs
    return (this.now() - this.lastDataAt) > windowMs
  }

  private startPolling(): void {
    if (this.polling || this.stopped || this.paused) return
    this.polling = true
    this.pollDelayMs = this.pollIntervalMs
    this.nextPollAt = Number.POSITIVE_INFINITY
    void this.pollTick()
  }

  private stopPolling(): void {
    this.polling = false
    this.pollDelayMs = this.pollIntervalMs
    this.nextPollAt = 0
  }

  /**
   * Fetch the latest history page(s) for the observed session and re-emit any
   * event above the per-session watermark as a `session/event` frame.
   * Idempotent by seq: listeners (and the fold) never see a duplicate.
   *
   * The newest page alone can permanently skip events when a burst outgrew
   * its page size during backoff: the missing range sits between the old
   * watermark and the page head, which a plain "latest page" poll never
   * returns. The poll therefore pages backwards (beforeSeq) until the gap
   * below the newest page is covered down to the watermark.
   */
  private async pollTick(): Promise<void> {
    const sessionId = this.observeSessionId
    if (sessionId === undefined) {
      this.stopPolling()
      return
    }
    let emitted = 0
    const seqOf = (entry: HistoryEntry): number => {
      const seq = entry?.event?.seq
      return typeof seq === 'number' ? seq : -1
    }
    try {
      const initialWatermark = this.pollWatermark.get(sessionId) ?? -1
      // A gap can only exist relative to a real watermark; before the first
      // successful poll there is no history to page for.
      const hadWatermark = initialWatermark >= 0
      let maxSeq = initialWatermark
      // Newest edge already emitted by this chain (the newest page's oldest
      // row); older pages must stay strictly below it.
      let chainTop = Number.POSITIVE_INFINITY
      let beforeSeq: number | undefined = undefined
      // Collect the whole chain first, then emit strictly ascending by seq.
      // Pages come back newest-first (the tail page, then beforeSeq refills),
      // and the fold consumer keeps a per-batch watermark: emitting the newer
      // rows before the older refill rows would make the downstream fold read
      // the refill as replays and drop them forever — its maxSeq already
      // passed them by the time they arrive, and this poll's watermark then
      // advances past the gap, so the missing range is never re-fetched.
      const pending: Array<{ seq: number; frame: SessionEventFrame }> = []
      // True when the chain reached the watermark (no gap remains). A chain
      // that hits the page cap with a gap still open must NOT advance the
      // watermark past it — the events between the watermark and the page
      // bottom would be skipped forever by every later poll.
      let coveredToFloor = false
      for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
        // The observation target changed mid-chain (stop/switch): stop
        // emitting stale-session rows.
        if (this.observeSessionId !== sessionId) {
          coveredToFloor = true
          // The collected rows belong to the old observation target; the new
          // one will poll its own history. Drop them instead of broadcasting
          // stale-session frames after the switch.
          pending.length = 0
          break
        }
        const page: HistoryPage = beforeSeq === undefined
          ? await this.pollLatest(sessionId)
          : await this.pollLatest(sessionId, beforeSeq)
        const ordered = [...page.events].sort((left, right) => seqOf(left) - seqOf(right))
        let pageEmitted = 0
        for (const entry of ordered) {
          const seq = seqOf(entry)
          // Already consumed before this chain, or emitted by a newer page.
          if (seq <= initialWatermark || seq >= chainTop) continue
          if (seq > maxSeq) maxSeq = seq
          pageEmitted += 1
          pending.push({
            seq,
            frame: { type: 'session/event', sessionId: sessionId as SessionEventFrame['sessionId'], event: entry.event } as SessionEventFrame,
          })
        }
        emitted += pageEmitted
        // A（并流）：排队状态跟着这条轮询一起回来。
        //
        // 手机上的 SSE 被隧道掐断之后，对话内容全靠这条轮询续命；队列如果另开一条
        // 请求，就多出一个会静默失败的独立通道 —— 卡片停在旧值、点删除也删不掉，
        // 而桌面端一切正常，根源就在这里。tail 页本来就捎带投影基线
        // （session.history 的 projections.values），白白不读太可惜。
        if (beforeSeq === undefined) {
          const inbox = page.projections?.values?.['inbox']
          if (inbox !== undefined) {
            this.emit({
              type: 'session/projection',
              sessionId: sessionId as SessionEventFrame['sessionId'],
              key: 'inbox',
              value: inbox,
              seq: Math.max(maxSeq, 0),
            })
          }
        }
        const oldestSeq = ordered.length > 0 ? seqOf(ordered[0] ?? { event: undefined }) : -1
        // The chain reached the watermark (no gap left) or returned nothing new.
        if (pageEmitted === 0 || oldestSeq === -1 || !hadWatermark) {
          coveredToFloor = true
          break
        }
        if (oldestSeq <= initialWatermark + 1) {
          coveredToFloor = true
          break
        }
        // Events between the old watermark and this page's bottom are missing:
        // pull the page below this one's oldest row.
        chainTop = oldestSeq
        beforeSeq = oldestSeq
      }
      if (coveredToFloor) {
        this.pollWatermark.set(sessionId, maxSeq)
      } else {
        // Page cap hit with a gap still open: hold the watermark where it
        // was and retry next poll (re-emitting is safe — the fold is
        // idempotent by seq), so the missing range is NOT silently dropped.
        console.warn(
          `poll gap refill hit the 10-page cap; events above seq ${initialWatermark} will be re-fetched next poll`,
        )
      }
      // Emit the whole refill chain only now, oldest page first: the fold
      // consumer's watermark must never jump past rows that have not reached
      // it yet (see the pending collection note above).
      pending.sort((left, right) => left.seq - right.seq)
      for (const item of pending) this.emit(item.frame)
    } catch (error) {
      // A terminal error means the device is no longer paired (revoked, or
      // remote control stopped): the host refuses every gated request with
      // 403/401. Without this, the catch would swallow it and the fallback
      // would keep polling into a 60 s backoff forever — a zombie poller
      // after revoke/stop. Stop the client and notify the UI so it can enter
      // the unpaired state. Everything else stays transient and backs off.
      if (isTerminalPollError(error)) {
        this.stop()
        this.onUnpaired?.()
        return
      }
      // Transient (network, history paging); retry with backoff.
    } finally {
      if (emitted > 0) {
        this.pollDelayMs = this.pollIntervalMs
      } else {
        this.pollDelayMs = Math.min(MAX_POLL_BACKOFF_MS, this.pollDelayMs + this.pollIntervalMs)
      }
      if (this.polling && this.observeSessionId === sessionId) {
        this.nextPollAt = this.now() + this.pollDelayMs
      }
    }
  }

  private handleMessage(data: string): void {
    if (typeof data !== 'string' || data === '') return
    // The SSE channel carries server-request envelopes whose payload is the
    // mux frame (same wire shape as the desktop mux channel).
    const envelope = parseMuxEnvelope(data)
    if (envelope === undefined) return
    const frame = envelope.frame
    // Host keep-alive: proves the channel is delivering but carries no state,
    // so it refreshes the liveness clock and stops any fallback polling without
    // reaching subscribers. Without this the phone only ever counted real
    // events, so an idle session tripped the stall window and fell back to 3 s
    // polling — turning a live push channel into a delayed one precisely when
    // the user was about to start a turn.
    if (frame.type === 'mux/ping') {
      this.sseAlive = true
      this.lastDataAt = this.now()
      if (this.polling) this.stopPolling()
      return
    }
    // Opt-in perf mark: stamp the frame the moment it reaches the client,
    // with its event seq when it is a session/event (later stages key spans
    // off this mark). Seq gaps beyond +1 are the transport's own loss signal.
    // Everything here is gated on the perf switch so the disabled hot path
    // adds no per-frame work (no Map ops, no marks).
    const eventSeq = (frame as { event?: { seq?: unknown } }).event?.seq
    if (perfEnabled()) {
      perfMark('recv', {
        seq: typeof eventSeq === 'number' ? eventSeq : undefined,
        frame: frame.type,
      })
      if (frame.type === 'session/event' && typeof eventSeq === 'number') {
        const sessionId = (frame as { sessionId?: string }).sessionId
        if (sessionId !== undefined) {
          const last = this.lastEventSeqBySession.get(sessionId)
          if (last !== undefined && eventSeq > last + 1) {
            perfAnomaly('seq-gap', `session=${sessionId} last=${last} got=${eventSeq}`)
          }
          this.lastEventSeqBySession.set(sessionId, eventSeq)
        }
      }
    }
    // A delivered frame proves the SSE channel is live (the tunnel forwards
    // it) and delivers again — drop any fallback polling so the live stream
    // takes over without double delivery.
    this.sseAlive = true
    this.lastDataAt = this.now()
    if (this.polling) this.stopPolling()
    if (frame.type === 'session/jobs') this.rememberJobs(frame)
    if (frame.type === 'session/queue') this.rememberQueue(frame)
    if (frame.type === 'session/subscribed') this.rememberSubscribed(frame)
    this.trackTurnState(frame)
    this.emit(frame, envelope.rpcId)
  }

  /** Update the running-session mirror from a session/event frame's turn
   *  boundary (turn/start opens a turn, turn/end closes it). Any other event
   *  leaves the mirror untouched. */
  private trackTurnState(frame: MuxFrame): void {
    if (frame.type !== 'session/event') return
    const event = frame.event as { type?: unknown } | undefined
    const eventType = event?.type
    const sessionId = String(frame.sessionId)
    this.running.observeFrame(typeof eventType === 'string' ? eventType : undefined, sessionId, this.now())
  }

  /**
   * Every session whose turn is currently open, in frame-arrival order. The
   * run-overview page seeds its running set from this so a session that
   * started generating before the page opened still appears (the mux opens
   * at app boot and tracks turns for the whole page lifetime).
   */
  runningSessionsSnapshot(): string[] {
    return this.running.snapshot()
  }

  /**
   * Retain the snapshot for one session. The jobs baseline (and every later
   * change push) rides the mux stream, which opens at app boot — before any
   * chat is mounted — so a freshly opened chat must be able to replay the last
   * known tasks instead of starting empty until the next registry change.
   */
  private rememberJobs(frame: Extract<MuxFrame, { type: 'session/jobs' }>): void {
    const sessionId = String(frame.sessionId)
    if (this.cachedJobsBySession.size >= MAX_CACHED_JOBS_SESSION && !this.cachedJobsBySession.has(sessionId)) {
      const oldest = this.cachedJobsBySession.keys().next().value
      if (oldest !== undefined) this.cachedJobsBySession.delete(oldest)
    }
    this.cachedJobsBySession.set(sessionId, frame.jobs)
  }

  /**
   * Last known background-task snapshot for a session, or undefined if none
   * has been seen on this mux stream. A chat view seeds its task bar from
   * this on mount so tasks already running are visible as soon as it opens.
   */
  cachedJobsFor(sessionId: string): JobView[] | undefined {
    return this.cachedJobsBySession.get(sessionId)
  }

  /**
   * Every retained per-session background-task snapshot (sessions with no
   * snapshot are absent — the host expresses "no tasks" by omitting the
   * session/jobs frame). Stable insertion order, newest retention evicts
   * oldest past {@link MAX_CACHED_JOBS_SESSION}. The global run-overview
   * surface renders this as its source of truth; the arrays are the live
   * retained JobView instances, so callers must treat them read-only.
   */
  jobsSnapshot(): Array<{ sessionId: string; jobs: readonly JobView[] }> {
    const rows: Array<{ sessionId: string; jobs: readonly JobView[] }> = []
    for (const [sessionId, jobs] of this.cachedJobsBySession) rows.push({ sessionId, jobs })
    return rows
  }

  /**
   * Number of in-flight (running/stopping) background jobs across every
   * retained session snapshot — the badge count for the global run-overview
   * entry. A settled-only set counts zero, matching the host's "no live
   * tasks" reading.
   */
  liveJobCount(): number {
    let count = 0
    for (const jobs of this.cachedJobsBySession.values()) {
      for (const job of jobs) {
        if (job.status === 'running' || job.status === 'stopping') count += 1
      }
    }
    return count
  }

  /** Retain the queue snapshot for one session (see cachedQueueBySession). */
  private rememberQueue(frame: Extract<MuxFrame, { type: 'session/queue' }>): void {
    const sessionId = String(frame.sessionId)
    const items = (frame.items ?? []).map(item => queueItemViewOf({
      id: String(item.id),
      placement: item.placement,
      message: item.message as never,
    }))
    this.cachedQueueBySession.set(sessionId, items)
  }

  /**
   * New mux-generation baseline for one session: the host pushes
   * `session/subscribed` for EVERY session on every stream (re)open, before
   * any per-session queue/jobs baseline that follows. The host omits those
   * baselines when the live queue/job set is empty, so a snapshot retained
   * from the previous generation would survive as a phantom list — the same
   * re-baseline reasoning the desktop runtime applies in its Session/manager
   * mirrors. Drop the retained rows now; any non-empty baseline right behind
   * this frame repopulates them, and an omitted baseline means "empty".
   */
  private rememberSubscribed(frame: Extract<MuxFrame, { type: 'session/subscribed' }>): void {
    const sessionId = String(frame.sessionId)
    this.cachedQueueBySession.delete(sessionId)
    this.cachedJobsBySession.delete(sessionId)
    // 新一轮连接：断线期间发生的 turn/end 不会重放，running 集合就会一直留着
    // 一个早已结束的会话——"运行中"页明明桌面端什么都没跑，手机却显示在跑。
    // 基线帧是新连接最早的一批帧，用它们的密集程度认出这一轮，然后按宿主列表
    // 校正（走插件快照，毫秒级）。
    const now = Date.now()
    const freshGeneration = now - this.lastSubscribedAt > SUBSCRIBED_GENERATION_GAP_MS
    this.lastSubscribedAt = now
    if (freshGeneration) void this.resyncRunning()
  }

  /** 用宿主的运行集合校正 running 镜像。
   *
   *  断线期间漏掉的 turn/end 帧永远不会重放，光靠 mux 帧攒出来的集合会一直
   *  挂着"进行中"——桌面端早就跑完了。会话列表的 running 字段不能当判据
   *  （它可能来自一份旧快照），宿主这份集合是权威的。 */
  private async resyncRunning(): Promise<void> {
    try {
      const sessionIds = await this.runningProbe()
      const at = this.now()
      const confirmed = await this.confirmRunning(sessionIds, at)
      this.running.observeRoster(confirmed, at)
      this.running.prune(at)
      this.runningResyncBackoffMs = this.runningResyncMs
    } catch {
      // 读不到就把现有集合留着：宁可多显示一个运行中，也不要悄悄吞掉。
      // 但要有退避 —— 探针挂了却按原节奏重试，弱网下只是拿失败换流量。
      this.runningResyncBackoffMs = Math.min(
        RUNNING_RESYNC_MAX_BACKOFF_MS,
        this.runningResyncBackoffMs * 2,
      )
    }
  }

  /**
   * 宿主集合里的每条都要复核才进镜像。
   *
   *  宿主的运行集合本身也是帧镜像：漏掉一条 turn/end 之后，它要等五分钟静默
   *  上限才会掉。这段时间花名册页一直说「运行中 N 个会话」，点进去聊天页当场
   *  问 `mobile.turnState` 却是空闲 —— 用户看到的就是「外面说有会话在跑，进去
   *  一个都没有」。所以这里用聊天页同一个接口逐条复核：
   *
   *  - 刚看到 turn/start（证据比 {@link RUNNING_VERIFY_STALE_MS} 新）的会话直接信，
   *    不为它多发一次往返；
   *  - 证据旧的逐条问，答「没在跑」的当场从镜像里删掉；
   *  - 复核请求本身失败时按「还在跑」处理：弱网下宁可多显示一个，也不悄悄吞。
   */
  private async confirmRunning(sessionIds: readonly string[], at: number): Promise<string[]> {
    const confirmed: string[] = []
    const unchecked: string[] = []
    for (const sessionId of sessionIds) {
      const age = this.running.evidenceAge(sessionId, at)
      if (age === undefined || age > RUNNING_VERIFY_STALE_MS) unchecked.push(sessionId)
      else confirmed.push(sessionId)
    }
    const asked = unchecked.slice(0, RUNNING_VERIFY_MAX)
    for (const sessionId of unchecked.slice(RUNNING_VERIFY_MAX)) confirmed.push(sessionId)
    const answers = await Promise.all(asked.map(async (sessionId) => {
      try {
        return { sessionId, running: await this.verifyRunning(sessionId) }
      } catch {
        return { sessionId, running: true }
      }
    }))
    for (const answer of answers) {
      if (answer.running) confirmed.push(answer.sessionId)
      else this.running.forget(answer.sessionId)
    }
    return confirmed
  }

  /**
   * 立刻按宿主校正一次运行集合。花名册页（那个绿点 + 数字）用它代替自己再开
   * 一条探针：两路各自维护一份「谁在跑」只会互相续命，错的那个永远退不掉。
   */
  refreshRunning(): Promise<void> {
    return this.resyncRunning()
  }

  /** 起/重启周期校准定时器（间隔取当前退避值）。 */
  private armRunningResync(): void {
    if (this.runningResyncTimer !== undefined) clearTimeout(this.runningResyncTimer)
    this.runningResyncTimer = setTimeout(() => {
      this.runningResyncTimer = undefined
      void this.resyncRunning().then(() => {
        if (!this.stopped) this.armRunningResync()
      })
    }, this.runningResyncBackoffMs)
  }

  /** Last known queue snapshot for a session, or undefined if none seen. */
  cachedQueueFor(sessionId: string): QueueItemView[] | undefined {
    return this.cachedQueueBySession.get(sessionId)
  }

  private emit(frame: MuxFrame, rpcId?: string): void {
    for (const listener of this.listeners) {
      try {
        listener(frame, rpcId)
      } catch {
        // A throwing subscriber must not break the emit loop.
      }
    }
  }

  private closeSource(): void {
    const source = this.source
    this.source = undefined
    if (source !== undefined) {
      source.onmessage = null
      source.onerror = null
      try {
        source.close()
      } catch {
        // Already closed.
      }
    }
  }
}