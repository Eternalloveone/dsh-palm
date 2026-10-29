/**
 * The completion-notify trigger: one host mux watch (the same pattern as the
 * pending tracker in index.ts) that turns session/jobs terminal transitions
 * and long turn/end events into NotifyEvents, broadcast to every subscriber
 * (the L1 SSE channel; L2/L3 delivery hooks ride the same events).
 *
 * The trigger logic lives here once — the phone never re-derives it — so
 * every delivery channel sees identical semantics.
 */

import { RpcId } from '../api-proxy-types'
import type { NotifyStore } from './notify-store.ts'

/** What happened; drives the notification copy. */
export type NotifyKind = 'task-done' | 'task-failed' | 'turn-done' | 'todo-done' | 'approval' | 'question'

/** One notification decision, ready for any delivery channel. */
export interface NotifyEvent {
  /** Stable per-decision id (dedupe tag for the browser). */
  id: string
  kind: NotifyKind
  title: string
  body: string
  sessionId: string
  /** Present when the workspace index knows the session. */
  workspaceId?: string
  ts: number
  /**
   * Set on the two kinds that are waiting for an answer. The push payload
   * carries it so the phone can answer from the lock screen (where the
   * platform supports action buttons) or, failing that, land directly on the
   * decision instead of the session list.
   */
  decision?: { id: string; kind: 'approval' | 'question'; rpcId?: string }
}

/** The minimal host surface the engine needs (test seam). */
export interface NotifyEngineHost {
  events: {
    mux(request: { rpcId: string; payload: unknown }, signal: AbortSignal): AsyncIterable<unknown>
  }
  sessions: {
    list(request: unknown): Promise<{
      result: {
        ok: boolean
        value?: { items?: Array<{ sessionId: string; projections?: { values?: Record<string, unknown> } }> }
      }
    }>
  }
  workspace: {
    list(request: unknown): Promise<{
      result: {
        ok: boolean
        value?: { items?: Array<{ workspaceId: string; sessionIds?: string[] }> }
      }
    }>
  }
}

/** The assembled notify feature the mobile routes need. */
export interface NotifyService {
  store: NotifyStore
  engine: NotifyEngine
}

/** Session index refresh cadence (title + workspace lookup for copy/deep links). */
const INDEX_REFRESH_MS = 5 * 60_000

/** Bounded in-memory decision log (the phone's notification inbox). */
const RECENT_EVENTS_LIMIT = 50

/**
 * The notify decision engine. One instance per plugin lifetime; start() opens
 * the host mux watch, subscribe() attaches delivery listeners.
 */
export class NotifyEngine {
  private readonly listeners = new Set<(event: NotifyEvent) => void>()
  /** jobId → last seen status (terminal transitions notify once). */
  private readonly jobStatus = new Map<string, string>()
  /** sessionId → turn/start epoch (turn-done duration). */
  private readonly turnStartedAt = new Map<string, number>()
  /** sessionId → last turn-done notify epoch (cooldown). */
  private readonly lastTurnNotifyAt = new Map<string, number>()
  /** sessionId → last todo-done notify epoch (cooldown). */
  private readonly lastTodoNotifyAt = new Map<string, number>()
  /** sessionId → { title, workspaceId } (best-effort, refreshed). */
  private readonly sessionIndex = new Map<string, { title?: string; workspaceId?: string }>()
  /** Recent decisions, oldest first (the phone's inbox; bounded). */
  private readonly recent: NotifyEvent[] = []
  /** sessionId → last emit epoch per `${kind}:${sessionId}` (dedupe window). */
  private readonly lastEmitAt = new Map<string, number>()
  private controller: AbortController | undefined
  private indexTimer: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly host: NotifyEngineHost,
    private readonly store: NotifyStore,
    /**
     * Whether a session is still working. Used to drop turn-done events that
     * only reflect an internal sub-turn: the agent finished one step of its
     * own choreography, the user is not being handed anything back yet.
     */
    private readonly isRunning?: (sessionId: string) => boolean,
  ) {}

  /** Begin the host mux watch + index refresh. Idempotent. */
  start(): void {
    if (this.controller !== undefined) return
    const controller = new AbortController()
    this.controller = controller
    void this.watch(controller)
    void this.refreshIndex()
    this.indexTimer = setInterval(() => { void this.refreshIndex() }, INDEX_REFRESH_MS)
    this.indexTimer.unref?.()
  }

  /** Stop the watch + timer. */
  stop(): void {
    this.controller?.abort()
    this.controller = undefined
    if (this.indexTimer !== undefined) clearInterval(this.indexTimer)
    this.indexTimer = undefined
  }

  /** Register a delivery listener; returns the unsubscribe function. */
  subscribe(listener: (event: NotifyEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private async watch(controller: AbortController): Promise<void> {
    try {
      const frames = this.host.events.mux(
        { rpcId: RpcId(`dsh-palm-notify-${Date.now().toString(36)}`), payload: {} },
        controller.signal,
      )
      for await (const frame of frames) {
        // The host mux stream wraps every frame in the RPC envelope
        // ({ rpcId, payload }); unwrap before routing — the same shape the
        // mobile events.mux bridge forwards to the phone.
        const payload = (frame as { payload?: unknown }).payload
        if (payload !== undefined) this.onFrame(payload as never)
      }
    } catch {
      // The stream ended or was aborted; the watch is best-effort.
    }
  }

  /** Route one mux frame. */
  private onFrame(frame: { type?: string; sessionId?: string; jobs?: unknown; event?: unknown }): void {
    if (frame.type === 'session/jobs' && frame.sessionId !== undefined && Array.isArray(frame.jobs)) {
      this.onJobs(frame.sessionId, frame.jobs as Array<{ id: string; status: string; label?: string; detail?: string }>)
      return
    }
    if (frame.type === 'session/event' && frame.sessionId !== undefined && frame.event !== undefined) {
      this.onSessionEvent(frame.sessionId, frame.event as { type?: string; turn?: number; reason?: { kind?: string } })
    }
  }

  /** Track job status; a running→terminal transition emits one notification. */
  private onJobs(sessionId: string, jobs: Array<{ id: string; status: string; label?: string; detail?: string }>): void {
    const config = this.store.getConfig()
    if (config.kinds?.jobs === false) return
    for (const job of jobs) {
      const previous = this.jobStatus.get(job.id)
      this.jobStatus.set(job.id, job.status)
      if (previous !== 'running') continue
      if (job.status === 'completed' || job.status === 'failed') {
        const label = job.label !== undefined && job.label !== '' ? job.label : job.id
        this.emit({
          id: `job-${job.id}-${Date.now().toString(36)}`,
          kind: job.status === 'completed' ? 'task-done' : 'task-failed',
          title: job.status === 'completed' ? '任务完成' : '任务失败',
          body: job.status === 'completed'
            ? `「${label}」已完成`
            : `「${label}」失败${job.detail !== undefined && job.detail !== '' ? `：${job.detail}` : ''}`,
          sessionId,
          workspaceId: this.sessionIndex.get(sessionId)?.workspaceId,
          ts: Date.now(),
        })
      }
    }
  }

  /** Track the todo plan; a non-empty plan reaching all-completed emits one. */
  private onTodo(sessionId: string, payload: { todos?: unknown }): void {
    const todos = payload.todos
    if (!Array.isArray(todos) || todos.length === 0) return
    const allDone = todos.every(todo =>
      typeof todo === 'object' && todo !== null && (todo as { status?: unknown }).status === 'completed')
    if (!allDone) return
    const now = Date.now()
    const config = this.store.getConfig()
    if (config.kinds?.todo === false) return
    const last = this.lastTodoNotifyAt.get(sessionId)
    if (last !== undefined && now - last < config.turnCooldownMs) return
    this.lastTodoNotifyAt.set(sessionId, now)
    const title = this.sessionIndex.get(sessionId)?.title
    this.emit({
      id: `todo-${sessionId}-${now.toString(36)}`,
      kind: 'todo-done',
      title: '规划完成',
      body: title !== undefined && title !== '' ? `「${title}」的任务规划已全部完成` : '任务规划已全部完成',
      sessionId,
      workspaceId: this.sessionIndex.get(sessionId)?.workspaceId,
      ts: now,
    })
  }

  /** Time turns; a completed turn longer than the threshold emits one notification. */
  private onSessionEvent(sessionId: string, event: { type?: string; turn?: number; reason?: { kind?: string }; data?: unknown }): void {
    if (event.type === 'turn/start') {
      this.turnStartedAt.set(sessionId, Date.now())
      return
    }
    if (event.type === 'todo/write') {
      // The todo/write event carries the full-list snapshot in `data`
      // ({ todos: TodoItem[] }) — the same shape the phone's plan strip parses.
      this.onTodo(sessionId, event.data as { todos?: unknown } | undefined ?? {})
      return
    }
    if (event.type !== 'turn/end') return
    const startedAt = this.turnStartedAt.get(sessionId)
    this.turnStartedAt.delete(sessionId)
    if (startedAt === undefined) return
    // Only a completed turn notifies; aborted/error turns are either
    // user-initiated or already surfaced by the chat itself.
    if (event.reason?.kind !== 'completed') return
    const now = Date.now()
    const config = this.store.getConfig()
    if (config.kinds?.turns === false) return
    if (now - startedAt < config.turnThresholdMs) return
    const last = this.lastTurnNotifyAt.get(sessionId)
    if (last !== undefined && now - last < config.turnCooldownMs) return
    this.lastTurnNotifyAt.set(sessionId, now)
    const title = this.sessionIndex.get(sessionId)?.title
    this.emit({
      id: `turn-${sessionId}-${event.turn ?? now.toString(36)}`,
      kind: 'turn-done',
      title: '回复完成',
      body: title !== undefined && title !== '' ? `「${title}」的回复已完成` : '回复已完成',
      sessionId,
      workspaceId: this.sessionIndex.get(sessionId)?.workspaceId,
      ts: now,
    })
  }

  /** The most recent decisions, newest first (bounded at RECENT_EVENTS_LIMIT). */
  recentEvents(): NotifyEvent[] {
    return [...this.recent].reverse()
  }

  /**
   * A session is now BLOCKED waiting for the user: an approval to run a tool,
   * or a question it needs answered. Unlike the completion kinds this is not
   * a courtesy — the turn cannot proceed until someone answers, so it
   * notifies regardless of the turn threshold and cooldown.
   */
  notifyDecision(input: {
    sessionId: string
    decisionId: string
    rpcId?: string
    kind: 'approval' | 'question'
    toolName?: string
    summary?: string
    multiSelect?: boolean
    optionCount?: number
  }): void {
    const config = this.store.getConfig()
    if (config.kinds?.approvals === false) return
    const sessionTitle = this.sessionIndex.get(input.sessionId)?.title
    const where = sessionTitle !== undefined && sessionTitle !== '' ? `「${sessionTitle}」` : '一个会话'
    const tool = input.toolName !== undefined && input.toolName !== '' ? input.toolName : undefined
    let title: string
    let body: string
    if (input.kind === 'approval') {
      title = '需要你授权'
      body = tool !== undefined
        ? `${where}请求执行 ${tool}`
        : `${where}请求执行一个工具`
      if (input.summary !== undefined && input.summary !== '') body = `${body}：${input.summary}`
    } else {
      title = '需要你回答'
      const asked = input.summary !== undefined && input.summary !== '' ? input.summary : '一个问题'
      body = `${where}在等你回答：${asked}`
      if (input.optionCount !== undefined && input.optionCount > 0) {
        body = `${body}（${input.optionCount} 个选项${input.multiSelect === true ? '，可多选' : ''}）`
      }
    }
    this.emit({
      id: `${input.kind}-${input.decisionId}`,
      kind: input.kind,
      title,
      body,
      sessionId: input.sessionId,
      workspaceId: this.sessionIndex.get(input.sessionId)?.workspaceId,
      ts: Date.now(),
      decision: { id: input.decisionId, kind: input.kind, ...(input.rpcId !== undefined ? { rpcId: input.rpcId } : {}) },
    })
  }

  /**
   * Push one synthetic event through every channel. The settings page's test
   * button uses this instead of calling the delivery functions directly, so a
   * test exercises exactly what a real notification does: the inbox, every
   * configured channel, and the delivery telemetry.
   */
  publishTest(): void {
    this.publish({
      id: `test-${Date.now().toString(36)}`,
      kind: 'task-done',
      title: '测试通知',
      body: '这是一条来自 dsh-palm 的测试通知',
      sessionId: '',
      ts: Date.now(),
    })
  }

  /**
   * Publish an event the engine did not observe itself (a phone-side error
   * report, a test push). Goes through the same fan-out, so it lands in the
   * inbox and the delivery telemetry like any other notification instead of
   * bypassing them.
   */
  publish(event: NotifyEvent): void {
    this.emit(event)
  }

  /** Fan out to every delivery listener; a failing listener never breaks the engine. */
  private emit(event: NotifyEvent): void {
    // Lock-screen privacy: one decision, applied before any channel sees the
    // event — L1 (in-app), L2 (Web Push) and L3 (Server酱/Bark/Telegram/
    // WxPusher) all deliver the same redacted copy, and the phone inbox too.
    const config = this.store.getConfig()
    // Tiering. "Someone is waiting for an answer" is the one class of event
    // that must never be suppressed, delayed or deduplicated: the turn is
    // literally blocked until it is handled. Everything else is a courtesy
    // and gets filtered — an internal sub-turn the user never started is not
    // worth a buzz, and a repeated status for the same session just trains
    // people to ignore notifications.
    const urgent = event.kind === 'approval' || event.kind === 'question'
    if (!urgent) {
      if (event.kind === 'turn-done' && this.isRunning?.(event.sessionId) === true) {
        this.store.recordDelivery({
          at: Date.now(), eventId: event.id, kind: event.kind, channel: 'engine', status: 'dropped',
          detail: 'session still running (internal sub-turn)',
        })
        return
      }
      const dedupeWindow = config.dedupeMs ?? 0
      if (dedupeWindow > 0) {
        const key = `${event.kind}:${event.sessionId}`
        const previous = this.lastEmitAt.get(key) ?? 0
        if (previous > 0 && event.ts - previous < dedupeWindow) {
          this.store.recordDelivery({
            at: Date.now(), eventId: event.id, kind: event.kind, channel: 'engine', status: 'dropped',
            detail: `duplicate within ${Math.round(dedupeWindow / 1000)}s`,
          })
          return
        }
        this.lastEmitAt.set(key, event.ts)
      }
    }
    const delivered: NotifyEvent = config.hideDetails === true
      ? {
          ...event,
          title: event.kind === 'task-done' ? '任务完成'
            : event.kind === 'task-failed' ? '任务失败'
              : event.kind === 'todo-done' ? '规划完成'
                : event.kind === 'approval' ? '需要你授权'
                  : event.kind === 'question' ? '需要你回答' : '回复完成',
          body: event.kind === 'task-done' ? '有后台任务已完成，点击查看'
            : event.kind === 'task-failed' ? '有后台任务失败，点击查看'
              : event.kind === 'todo-done' ? '有任务规划已完成，点击查看'
                : event.kind === 'approval' ? '有操作在等你授权，点击查看'
                  : event.kind === 'question' ? '有问题在等你回答，点击查看'
                    : '有新的回复已完成，点击查看',
        }
      : event
    this.recent.push(delivered)
    if (this.recent.length > RECENT_EVENTS_LIMIT) {
      this.recent.splice(0, this.recent.length - RECENT_EVENTS_LIMIT)
    }
    for (const listener of this.listeners) {
      try {
        listener(delivered)
      } catch {
        // delivery errors are the listener's problem
      }
    }
  }

  /** Best-effort sessionId → { title, workspaceId } index (copy + deep links). */
  private async refreshIndex(): Promise<void> {
    try {
      const [sessions, workspaces] = await Promise.all([
        this.host.sessions.list({ rpcId: RpcId('dsh-palm-notify-index'), payload: {} }),
        this.host.workspace.list({ rpcId: RpcId('dsh-palm-notify-index-ws'), payload: {} }),
      ])
      if (sessions.result.ok && sessions.result.value?.items !== undefined) {
        for (const item of sessions.result.value.items) {
          const values = item.projections?.values
          const title = typeof values?.title === 'string' ? values.title : undefined
          const entry = this.sessionIndex.get(item.sessionId) ?? {}
          this.sessionIndex.set(item.sessionId, { ...entry, title })
        }
      }
      if (workspaces.result.ok && workspaces.result.value?.items !== undefined) {
        for (const workspace of workspaces.result.value.items) {
          for (const sessionId of workspace.sessionIds ?? []) {
            const entry = this.sessionIndex.get(sessionId) ?? {}
            this.sessionIndex.set(sessionId, { ...entry, workspaceId: workspace.workspaceId })
          }
        }
      }
    } catch {
      // Index refresh is best-effort; notifications still fire with bare ids.
    }
  }
}
