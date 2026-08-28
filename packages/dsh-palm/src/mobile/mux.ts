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

import type { MuxFrame } from '@deepseek-ai/dsh-host-apiproxy/api/events'
import { muxFrameSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'
import { serverRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { history as fetchHistory, type HistoryPage } from './api.ts'
import type { HistoryEntry } from '@deepseek-ai/dsh-host-apiproxy/api/sessions'

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
  private readonly listeners = new Set<(frame: MuxFrame, rpcId?: string) => void>()
  private source: EventSourceLike | undefined
  private stopped = false
  private readonly url: string

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
  }

  /** Open the stream (idempotent; EventSource reconnects until {@link stop}). */
  start(): void {
    this.stopped = false
    this.lastDataAt = this.now()
    if (this.source === undefined) this.connect()
    this.startTick()
  }

  /** Close for good. */
  stop(): void {
    this.stopped = true
    this.stopTick()
    this.stopPolling()
    this.closeSource()
    this.observeSessionId = undefined
    this.nextPollAt = 0
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
      return
    }
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
    if (this.stopped) return
    this.pollDelayMs = this.pollIntervalMs
    this.nextPollAt = 0
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
    if (this.polling || this.stopped) return
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
    } catch {
      // Transient (network, pairing, history paging); retry with backoff.
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
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      return
    }
    // The SSE channel carries server-request envelopes whose payload is the
    // mux frame (same wire shape as the desktop mux channel).
    const envelope = serverRequestSchema.safeParse(parsed)
    if (!envelope.success) return
    const frame = muxFrameSchema.safeParse(envelope.data.payload)
    if (!frame.success) return
    // A delivered frame proves the SSE channel is live (the tunnel forwards
    // it) and delivers again — drop any fallback polling so the live stream
    // takes over without double delivery.
    this.sseAlive = true
    this.lastDataAt = this.now()
    if (this.polling) this.stopPolling()
    this.emit(frame.data, envelope.data.rpcId)
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