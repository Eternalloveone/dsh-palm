/**
 * events.mux 重组适配。
 *
 * 0.1.5-rc.1 里旧 `events.mux`（全会话聚合流）已拆为：
 * - `session.control` 流（队列/任务/投影）
 * - `approval/request` / `user-questions/request` waterfall 事件（应答式）
 *
 * 本模块把这两路重组回旧 `MuxFrame` 形状。`session/event` 帧（带 view）降级为
 * 不转发（由 chat-window/preview 历史读兜底，只影响实时性不影响正确性）。
 * 旧 `MuxFrame` 不含 `host/*` 帧（那些在 `events.host`），故 `api-session/*`
 * 事件不接入 mux 广播（dsh-palm 的 mux 消费者也不需要它们）。
 *
 * 设计：一个共享 `MuxBroadcast`，所有 `events.mux` 订阅（后台 watch + SSE 桥）
 * 都从它消费；`session.control` 由 setup 时一次性接入，approval/question 由
 * respond 桥接（api-proxy-adapter）推入。
 */

import { randomUUID } from 'node:crypto'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import type { SessionControlFrame } from '@deepseek-ai/dsh-api-session-controller/types'
import type { RpcRequest, MuxFrame, JobView, QueuedInboxItem } from './api-proxy-types.ts'
import { RpcId } from './api-proxy-types.ts'

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
  private readonly subscribers = new Set<MuxQueue>()

  /** 推一帧到所有活跃订阅（自动铸造 rpcId）。 */
  emit(frame: MuxFrame): void {
    this.emitWithRpcId(RpcId(`mux-${randomUUID()}`), frame)
  }

  /** 用指定 rpcId 推一帧（respond 桥接用：手机以该 rpcId 应答）。 */
  emitWithRpcId(rpcId: RpcId, frame: MuxFrame): void {
    const wrapped: RpcRequest<MuxFrame> = { rpcId, payload: frame }
    for (const sub of this.subscribers) sub.push(wrapped)
  }

  /** 开一个新订阅（events.mux 的返回）。 */
  subscribe(signal: AbortSignal): AsyncIterable<RpcRequest<MuxFrame>> {
    const queue = new MuxQueue()
    this.subscribers.add(queue)
    const onAbort = (): void => {
      this.subscribers.delete(queue)
      queue.end()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    return queue
  }
}

/**
 * 把 `session.control` 流接入广播。返回清理函数。
 * approval/question 由 respond 桥接（api-proxy-adapter）单独接入。
 */
export function setupMuxSources(
  session: SessionController,
  broadcast: MuxBroadcast,
  signal: AbortSignal,
): () => void {
  const controlTask = (async () => {
    try {
      const frames = session.control(signal)
      for await (const frame of frames) {
        for (const wire of controlFrameToMux(frame)) broadcast.emit(wire)
      }
    } catch {
      // 流结束或中止；best-effort。
    }
  })()
  return () => { void controlTask }
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
