/**
 * 手机端"正在看的会话"的实时助手流。
 *
 * 0.1.5 之后 token 级流式不再写持久事件（`assistant/chunk` 在会话格式 v3 里已清零），
 * 它只以进程内总线事件的形式存在：`agent/assistant-stream`（声明于
 * core/agent/src/runtime-types.ts:373，由 agent-loop 发出）。
 *
 * session-controller 的 follow 之所以能带流式帧，正是因为它订阅了同一条总线
 * （api/session-controller/src/history.ts:54-61，`{ global: true }`）；follow 的
 * assistant-stream 分支不过是"按目标会话过滤 + 补一个 startedAfterSeq"的转发
 * （同文件 :166-174、:282-292）。所以 palm 直接订阅这条总线即可——少一层中转，
 * 也不需要 per-session follow、重连退避、revision 连续性维护这些流生命周期。
 *
 * 翻译规则（手机端零渲染改动的关键）：把每个 chunk 变成一条**持久形状的
 * `assistant/chunk` 事件**，seq 用分数塞进"当前持久游标"与"下一条持久事件"之间：
 * `cursor + n/(n+1)`，单调递增且恒 < cursor+1。桌面端用的是同一招
 * （api/session-controller/src/client/sessions/assistant-stream.ts:81）。这样手机的
 * `EventFolder` 与宿主 chat-window 都不用改：它们本来就按 (turn,step) 建待定行、
 * 由持久 `assistant/message` 收尾，分数 seq 既不推进持久水位、也不挤掉后续持久事件。
 *
 * 游标取自事件载荷里的活会话 seq（`agent.session.seq` 是"下一条"日志偏移，与
 * session-controller 自己的 `cursorBeforeNext` 一致），不会像 follow 游标那样滞后。
 *
 * 放弃语义：尝试被放弃时**没有**持久结算事件，待定行会一直挂到 `turn/end`。这里
 * 主动补一条 `message/delete` 把它删掉——删除事件的 seq 必须严格大于最后一个 chunk
 * （fold 的水位闸门是 `seq <= floor → skip`），故用 `cursor + (n+1)/(n+2)`。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { MuxBroadcast } from './api-proxy-mux.ts'
import type { SessionObserverRegistry } from './api-proxy-observe.ts'
import type { DependencyDiagnostics } from './api-proxy-diag.ts'

/** 一条活动尝试的翻译状态。 */
interface LiveAttempt {
  attemptId: string
  turn: number
  step: number
  /** 本尝试已翻译的 chunk 数（分数 seq 的分子）。 */
  chunks: number
  /** 最后一个 chunk 的 seq（放弃时用来定位待定行）。 */
  lastSeq: number
  /** 最后一个 chunk 的时间（删除事件沿用）。 */
  lastTime: number
}

export interface AssistantStreamDeps {
  /** 宿主 context（用宽松转换订阅总线，见下）。 */
  ctx: Context
  broadcast: MuxBroadcast
  observers: SessionObserverRegistry
  /** 插件生命周期信号：中止即停止翻译。 */
  signal: AbortSignal
  /** 依赖自检（可选）：登记订阅结果并统计收到的帧。 */
  diagnostics?: DependencyDiagnostics
}

/** 从总线载荷里取出会话 id、持久游标与流式帧；形状不符返回 undefined。 */
function readStreamEvent(payload: unknown): { sessionId: string; cursor: number; frame: Record<string, unknown> } | undefined {
  if (payload === null || typeof payload !== 'object') return undefined
  const agent = (payload as { agent?: unknown }).agent
  const frame = (payload as { frame?: unknown }).frame
  if (agent === null || typeof agent !== 'object' || frame === null || typeof frame !== 'object') return undefined
  const session = (agent as { session?: unknown }).session
  const scope = (session !== null && typeof session === 'object' ? session : agent) as { id?: unknown; seq?: unknown }
  const sessionId = typeof scope.id === 'string' && scope.id !== '' ? scope.id : undefined
  if (sessionId === undefined) return undefined
  // `seq` 是"下一条"日志偏移；transient 的锚点是它前一条（与 session-controller
  // 的 cursorBeforeNext 相同）。
  const nextSeq = typeof scope.seq === 'number' && Number.isFinite(scope.seq) ? scope.seq : 0
  return { sessionId, cursor: nextSeq === 0 ? -1 : nextSeq - 1, frame: frame as Record<string, unknown> }
}

/** 把一条流式帧翻译成手机认识的持久形状事件。 */
function translate(
  broadcast: MuxBroadcast,
  sessionId: string,
  cursor: number,
  frame: Record<string, unknown>,
  attempt: LiveAttempt | undefined,
): LiveAttempt | undefined {
  const type = frame.type
  if (type === 'start') {
    const turn = frame.turn
    const step = frame.step
    if (typeof turn !== 'number' || typeof step !== 'number') return undefined
    return { attemptId: String(frame.attemptId), turn, step, chunks: 0, lastSeq: cursor, lastTime: 0 }
  }
  if (attempt === undefined || attempt.attemptId !== String(frame.attemptId)) return attempt

  if (type === 'chunk') {
    const time = typeof frame.time === 'number' && Number.isFinite(frame.time) ? frame.time : Date.now()
    attempt.chunks += 1
    attempt.lastSeq = cursor + attempt.chunks / (attempt.chunks + 1)
    attempt.lastTime = time
    broadcast.emit({
      type: 'session/event',
      sessionId: sessionId as never,
      event: {
        type: 'assistant/chunk',
        seq: attempt.lastSeq,
        time,
        data: { turn: attempt.turn, step: attempt.step, chunk: frame.chunk },
      } as never,
    })
    return attempt
  }

  if (type === 'end') {
    const outcome = frame.outcome
    const abandoned = outcome !== null && typeof outcome === 'object'
      && (outcome as { kind?: unknown }).kind === 'abandoned'
    if (abandoned && attempt.chunks > 0) {
      // 删除事件的 seq 要严格大于最后一个 chunk（水位闸门），且仍在下一条持久
      // 事件之前，所以顺延到下一个分数位。
      const seq = cursor + (attempt.chunks + 1) / (attempt.chunks + 2)
      broadcast.emit({
        type: 'session/event',
        sessionId: sessionId as never,
        event: { type: 'message/delete', seq, time: attempt.lastTime, data: { seq: attempt.lastSeq } } as never,
      })
    }
    return undefined
  }

  return attempt
}

/** 订阅宿主助手流总线，按被观察的会话翻译。返回清理函数。 */
export function setupAssistantStream(deps: AssistantStreamDeps): () => void {
  const { ctx, broadcast, observers, signal, diagnostics } = deps
  const attempts = new Map<string, LiveAttempt>()
  /** 手机正在看的会话：只有这些会话的 chunk 值得翻译与广播。 */
  let observed = new Set<string>()

  const disposeObservers = observers.onChange((sessionIds) => {
    observed = new Set(sessionIds)
    // 不再被观察的会话：丢掉半截的尝试状态，别让它留到下次打开时错配。
    for (const sessionId of [...attempts.keys()]) {
      if (!observed.has(sessionId)) attempts.delete(sessionId)
    }
  })

  // 事件名与 `{ agent, frame }` 形状来自 session-controller 自己消费的同一条总线
  // （history.ts:54，`{global:true}`），未在 dsh-palm 的 Context 声明里合并，故沿用
  // approval/question 的宽松转换。总线不可用时只降级为"没有逐字流式"。
  let disposeStream: (() => void) | undefined
  try {
    const on = ctx.on as unknown as (
      name: string,
      listener: (payload: unknown) => void,
      options?: { global?: boolean },
    ) => () => void
    disposeStream = on('agent/assistant-stream', (payload) => {
      // 帧计数先记：它证明的是"宿主确实在发这条事件"，与是否被观察无关。
      diagnostics?.note('agent/assistant-stream')
      if (signal.aborted) return
      const parsed = readStreamEvent(payload)
      if (parsed === undefined) return
      if (!observed.has(parsed.sessionId)) return
      const next = translate(broadcast, parsed.sessionId, parsed.cursor, parsed.frame, attempts.get(parsed.sessionId))
      if (next === undefined) attempts.delete(parsed.sessionId)
      else attempts.set(parsed.sessionId, next)
    }, { global: true })
    diagnostics?.register('agent/assistant-stream', 'event', true)
  } catch (error) {
    // 旧版本/未来版本没有这条总线：保持"消息级实时 + 读时自愈"。
    diagnostics?.register('agent/assistant-stream', 'event', false, error instanceof Error ? error.message : String(error))
  }

  return () => {
    disposeStream?.()
    disposeObservers()
    attempts.clear()
  }
}
