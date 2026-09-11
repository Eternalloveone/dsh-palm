/**
 * events.mux 重组适配。
 *
 * 0.1.5-rc.1 里旧 `events.mux`（全会话聚合流）已拆为：
 * - `session.control` 流（队列/任务/投影）
 * - `approval/request` / `user-questions/request` waterfall 事件（应答式）
 *
 * 本模块把这两路重组回旧 `MuxFrame` 形状。旧 `MuxFrame` 不含 `host/*` 帧
 * （那些在 `events.host`），故 `api-session/*` 事件不接入 mux 广播
 * （dsh-palm 的 mux 消费者也不需要它们）。
 *
 * `session/event` 重新接回（2026-09-11 修复「手机端丢消息/不跟桌面同步」）：
 * 0.1.5 拆分 `events.mux` 时，事件帧曾一度"降级为不转发"，理由是由历史读兜底。
 * 但 chat-window 的窗口一旦装好就**不再回读日志**（chat-window.ts 顶部注释），
 * 它唯一的活水就是这里的 `session/event`；断掉之后窗口在进程生命周期内永久冻结，
 * preview-cache / notify 同样收不到实时事件。现在直接挂宿主事件总线
 * （`ctx.on('session/event', …, { global: true })`——与 `session.follow` 内部
 * 完全同一个源，history.ts:145）把它接回广播，实时性与桌面端一致。
 *
 * 设计：一个共享 `MuxBroadcast`，所有 `events.mux` 订阅（后台 watch + SSE 桥）
 * 都从它消费；`session.control` 与 `session/event` 由 setup 时一次性接入，
 * approval/question 由 respond 桥接（api-proxy-adapter）推入。
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import type { SessionControlFrame } from '@deepseek-ai/dsh-api-session-controller/types'
import type { RpcRequest, MuxFrame, JobView, QueuedInboxItem } from './api-proxy-types.ts'
import { RpcId } from './api-proxy-types.ts'
import type { DependencyDiagnostics } from './api-proxy-diag.ts'

/** 会话列表的宿主事件名（桌面端客户端消费同一批，见 session-controller client/index.ts:102-110）。 */
const SESSION_LIST_EVENTS = [
  'api-session/added',
  'api-session/removed',
  'api-session/status',
  'api-session/activity',
  'api-session/error',
] as const

/** 把 catch 到的东西变成一行可读原因（自检报告用）。 */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 一个可推入的异步队列（events.mux 的订阅端）。 */
class MuxQueue implements AsyncIterable<RpcRequest<MuxFrame>> {
  private readonly buffer: Array<RpcRequest<MuxFrame>> = []
  private waiter: (() => void) | undefined
  private closed = false

  push(frame: RpcRequest<MuxFrame>): void {
    if (this.closed) return
    this.buffer.push(frame)
    this.waiter?.()
  }

  end(): void {
    if (this.closed) return
    this.closed = true
    this.waiter?.()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<RpcRequest<MuxFrame>> {
    while (true) {
      while (this.buffer.length > 0) yield this.buffer.shift() as RpcRequest<MuxFrame>
      if (this.closed) return
      await new Promise<void>(resolve => { this.waiter = resolve })
      this.waiter = undefined
    }
  }
}

/** 共享广播：所有 events.mux 订阅都从它消费。 */
export class MuxBroadcast {
  /** 订阅队列 → 该订阅的帧过滤谓词（undefined = 全收）。 */
  private readonly subscribers = new Map<MuxQueue, ((frame: MuxFrame) => boolean) | undefined>()

  /** 推一帧到所有活跃订阅（自动铸造 rpcId）。 */
  emit(frame: MuxFrame): void {
    this.emitWithRpcId(RpcId(`mux-${randomUUID()}`), frame)
  }

  /** 用指定 rpcId 推一帧（respond 桥接用：手机以该 rpcId 应答）。 */
  emitWithRpcId(rpcId: RpcId, frame: MuxFrame): void {
    const wrapped: RpcRequest<MuxFrame> = { rpcId, payload: frame }
    for (const [sub, accept] of this.subscribers) {
      if (accept !== undefined && !accept(frame)) continue
      sub.push(wrapped)
    }
  }

  /**
   * 开一个新订阅（events.mux 的返回）。
   * @param signal - 中止即关闭该订阅。
   * @param accept - 可选的帧过滤：手机 SSE 用它只收本设备观察的会话（其余会话的
   *   持久事件——尤其 `tool/result` 这类大载荷——不必过隧道）。控制/列表/审批帧
   *   由调用方在谓词里放行。
   */
  subscribe(signal: AbortSignal, accept?: (frame: MuxFrame) => boolean): AsyncIterable<RpcRequest<MuxFrame>> {
    const queue = new MuxQueue()
    this.subscribers.set(queue, accept)
    const onAbort = (): void => {
      this.subscribers.delete(queue)
      queue.end()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    return queue
  }
}

/**
 * 把 `session.control` 流与宿主 `session/event` 总线接入广播。返回清理函数。
 * approval/question 由 respond 桥接（api-proxy-adapter）单独接入。
 *
 * `session/event` 必须在这里**一次性**注册（而不是按会话懒注册）：插件 setup
 * 即开始监听，才不存在"会话变有趣"到"订阅开始"之间的空窗——那段空窗里的
 * 事件没有任何补偿路径，会变成永久空洞。
 */
export function setupMuxSources(
  ctx: Context,
  session: SessionController,
  broadcast: MuxBroadcast,
  signal: AbortSignal,
  diagnostics?: DependencyDiagnostics,
): () => void {
  const controlTask = (async () => {
    try {
      const frames = session.control(signal)
      for await (const frame of frames) {
        diagnostics?.note('session.control')
        for (const wire of controlFrameToMux(frame)) broadcast.emit(wire)
      }
    } catch {
      // 流结束或中止；best-effort。
    }
  })()

  // 宿主事件总线 → mux `session/event` 帧。事件名与 `(session, event)` 形状
  // 来自 session-controller 自己消费的同一条总线（history.ts:145，`{global:true}`），
  // 但未在 dsh-palm 的 Context 声明里合并，故沿用 approval/question 的宽松转换。
  // 总线不可用时只降级为"没有实时事件"，不影响其余功能。
  let disposeSessionEvent: (() => void) | undefined
  try {
    const on = ctx.on as unknown as (
      name: string,
      listener: (session: { id?: unknown }, event: unknown) => void,
      options?: { global?: boolean },
    ) => () => void
    disposeSessionEvent = on('session/event', (session, event) => {
      diagnostics?.note('session/event')
      const sessionId = session?.id
      if (typeof sessionId !== 'string' || event === null || typeof event !== 'object') return
      broadcast.emit({
        type: 'session/event',
        sessionId: sessionId as never,
        event: event as never,
      })
    }, { global: true })
    diagnostics?.register('session/event', 'event', true)
  } catch (error) {
    // 旧版本/未来版本没有这条总线：保持 control-only 的降级行为。
    diagnostics?.register('session/event', 'event', false, reasonOf(error))
  }

  // 会话列表的实时状态：宿主 `api-session/*` 五事件 → 同名 mux 帧。桌面端消费的
  // 就是这五条（session-controller client/index.ts:102-110）；手机端的列表此前只能
  // 靠 `sessions.list` 拉取，于是桌面端新建/关闭的会话、running 点、活动时间排序都
  // 要等下一次拉取才更新。与 session/event 同样一次性注册、同样容忍总线缺失
  // （缺失时退回拉取驱动，功能不坏）。
  let disposeSessionList: Array<() => void> = []
  try {
    const on = ctx.on as unknown as (
      name: string,
      listener: (...args: unknown[]) => void,
      options?: { global?: boolean },
    ) => () => void
    const idOf = (value: unknown): string | undefined =>
      typeof value === 'string' && value !== '' ? value : undefined
    disposeSessionList = [
      on('api-session/added', (summary: unknown) => {
        diagnostics?.note('api-session/added')
        if (summary === null || typeof summary !== 'object') return
        broadcast.emit({ type: 'session/added', summary: summary as never })
      }, { global: true }),
      on('api-session/removed', (sessionId: unknown) => {
        diagnostics?.note('api-session/removed')
        const id = idOf(sessionId)
        if (id !== undefined) broadcast.emit({ type: 'session/removed', sessionId: id as never })
      }, { global: true }),
      on('api-session/status', (sessionId: unknown, running: unknown) => {
        diagnostics?.note('api-session/status')
        const id = idOf(sessionId)
        if (id === undefined || typeof running !== 'boolean') return
        broadcast.emit({ type: 'session/status', sessionId: id as never, running })
      }, { global: true }),
      on('api-session/activity', (sessionId: unknown, updatedAt: unknown) => {
        diagnostics?.note('api-session/activity')
        const id = idOf(sessionId)
        if (id === undefined || typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return
        broadcast.emit({ type: 'session/activity', sessionId: id as never, updatedAt })
      }, { global: true }),
      on('api-session/error', (sessionId: unknown, message: unknown) => {
        diagnostics?.note('api-session/error')
        const id = idOf(sessionId)
        if (id === undefined || typeof message !== 'string') return
        broadcast.emit({ type: 'session/error', sessionId: id as never, message })
      }, { global: true }),
    ]
    for (const name of SESSION_LIST_EVENTS) diagnostics?.register(name, 'event', true)
  } catch (error) {
    // 同 session/event：总线不可用时列表退回拉取驱动。
    for (const name of SESSION_LIST_EVENTS) diagnostics?.register(name, 'event', false, reasonOf(error))
  }

  return () => {
    disposeSessionEvent?.()
    for (const dispose of disposeSessionList) dispose()
    void controlTask
  }
}

/** 把一条 SessionControlFrame 展开为若干 MuxFrame。 */
function controlFrameToMux(frame: SessionControlFrame): MuxFrame[] {
  if (frame.type === 'baseline') {
    const out: MuxFrame[] = []
    for (const [sessionId, items] of Object.entries(frame.value.queues)) {
      out.push({ type: 'session/queue', sessionId, items: items.map(toQueuedInboxItem) })
    }
    for (const [sessionId, jobs] of Object.entries(frame.value.jobs)) {
      out.push({ type: 'session/jobs', sessionId, jobs: jobs.map(toJobView) })
    }
    for (const [sessionId, projections] of Object.entries(frame.value.projections)) {
      for (const [key, value] of Object.entries(projections.values)) {
        out.push({ type: 'session/projection', sessionId, key, value, seq: projections.asOfSeq })
      }
    }
    return out
  }
  if (frame.type === 'queue') {
    return [{ type: 'session/queue', sessionId: frame.sessionId as string, items: frame.items.map(toQueuedInboxItem) }]
  }
  if (frame.type === 'jobs') {
    return [{ type: 'session/jobs', sessionId: frame.sessionId as string, jobs: frame.jobs.map(toJobView) }]
  }
  if (frame.type === 'projection') {
    return [{ type: 'session/projection', sessionId: frame.sessionId as string, key: frame.key, value: frame.value, seq: frame.seq }]
  }
  return []
}

/** 新 SessionQueuedItem → 旧 QueuedInboxItem（message 形状宽松映射）。 */
function toQueuedInboxItem(item: any): QueuedInboxItem {
  return { id: item.id as never, placement: item.placement, message: item.message }
}

/** 新 SessionJob → 旧 JobView（字段同形）。 */
function toJobView(job: {
  id: string
  kind: string
  label: string
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  detail?: string
  startedAt: number
  finishedAt?: number
}): JobView {
  return {
    id: job.id as never,
    kind: job.kind,
    label: job.label,
    status: job.status,
    ...(job.detail !== undefined ? { detail: job.detail } : {}),
    startedAt: job.startedAt,
    ...(job.finishedAt !== undefined ? { finishedAt: job.finishedAt } : {}),
  }
}
