/**
 * The completion-notify trigger: one host mux watch (the same pattern as the
 * pending tracker in index.ts) that turns session/jobs terminal transitions
 * and long turn/end events into NotifyEvents, broadcast to every subscriber
 * (the L1 SSE channel; L2/L3 delivery hooks ride the same events).
 *
 * The trigger logic lives here once — the phone never re-derives it — so
 * every delivery channel sees identical semantics.
 */

import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import type { NotifyStore } from './notify-store.ts'

/** What happened; drives the notification copy. */
export type NotifyKind = 'task-done' | 'task-failed' | 'turn-done' | 'todo-done'

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
  private controller: AbortController | undefined
  private indexTimer: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly host: NotifyEngineHost,
    private readonly store: NotifyStore,
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

  /** Fan out to every delivery listener; a failing listener never breaks the engine. */
  private emit(event: NotifyEvent): void {
    // Lock-screen privacy: one decision, applied before any channel sees the
    // event — L1 (in-app), L2 (Web Push) and L3 (Server酱/Bark/Telegram/
    // PushPlus) all deliver the same redacted copy, and the phone inbox too.
    const config = this.store.getConfig()
    const delivered: NotifyEvent = config.hideDetails === true
      ? {
          ...event,
          title: event.kind === 'task-done' ? '任务完成'
            : event.kind === 'task-failed' ? '任务失败'
              : event.kind === 'todo-done' ? '规划完成' : '回复完成',
          body: event.kind === 'task-done' ? '有后台任务已完成，点击查看'
            : event.kind === 'task-failed' ? '有后台任务失败，点击查看'
              : event.kind === 'todo-done' ? '有任务规划已完成，点击查看'
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
