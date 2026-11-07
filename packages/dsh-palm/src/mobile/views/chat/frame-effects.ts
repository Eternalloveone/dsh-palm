/**
 * 帧分发器（S7a-4c）：`ChatView` 里 `mux.onFrame` 那一个 235 行的巨型回调，按事件类型
 * 拆成独立处理器；视图层只留「每帧 reportConnectivity(true) → dispatchFrame」。
 *
 * **纯搬运**：判据、注释（真机结论）、事件顺序与 return 语义逐字保留。`ctx` 是**一个**
 * 结构化对象（流/回合语义接口 + 必要写入方），处理器只经它落地，不反向 import ChatView。
 */
import { startTransition, type Dispatch, type SetStateAction } from 'react'
import type { MuxFrame, JobView } from '../../../api-proxy-types'
import type { TodoSnapshot, WireEvent } from '../../messages.ts'
import { queueItemViewOf, type PendingApproval, type PendingQuestionItem, type QueueItemView } from '../../api.ts'
import { parsePermissionSelect, type PermissionSelectValue } from '../../sheets.tsx'
import type { MobileGoal } from '../../goal-projection.ts'
import type { StatusEvent } from '../../session-status.ts'
import { toast } from '../../toast.tsx'
import type { TurnVerdict } from './stream-state.ts'

/**
 * 宿主时钟：校准逻辑已经搬到 `../../host-clock.ts`。
 *
 * 这里原来有一个"最近 24 个样本取最大偏移"的窗口（上面那段注释描述的就是它）。
 * 它解决的是抖动，但没解决"墙钟被拨动"和"锚点用旧偏移、现在用新偏移"这两件事，
 * 真机上表现为秒表突然变成个莫名其妙的数、重进会话才恢复。现在统一交给宿主时钟：
 * 单调本地时钟推宿主时间，读数只做宿主时间域内的减法。
 */

export interface ContextPressureData { contextWindow?: number; pressureTokens?: number; projectedTokens?: number }

/** Loose parse of the contextPressure projection (host augmentation). */
export function parseContextPressure(value: unknown): ContextPressureData | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as Record<string, unknown>
  return {
    ...(typeof v['contextWindow'] === 'number' ? { contextWindow: v['contextWindow'] } : {}),
    ...(typeof v['pressureTokens'] === 'number' ? { pressureTokens: v['pressureTokens'] } : {}),
    ...(typeof v['projectedTokens'] === 'number' ? { projectedTokens: v['projectedTokens'] } : {}),
  }
}

/** 回合边界事件（turn/start / turn/end）data 里的轮号；缺失或非数字即 undefined。 */
export function turnNumberOf(event: WireEvent): number | undefined {
  const data = event.data
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
  const turn = (data as Record<string, unknown>)['turn']
  return typeof turn === 'number' && Number.isFinite(turn) ? turn : undefined
}

/**
 * 分发器需要的全部上下文（一个结构化对象）。
 * 两组：`use-chat-stream` 的语义接口（回合/流）与视图写入方（setter / 状态仓）。
 */
export interface FrameContext {
  sessionId: string

  /** 任意帧都证明链路活着。 */
  clearHostLost: () => void
  /** 裁决门用的即时值。 */
  isRunning: () => boolean
  /** 唯一回合裁决入口。 */
  applyTurnVerdict: (verdict: TurnVerdict) => void
  clearActiveTurn: () => void
  /** turn/start：清「已中断」并锚定秒表。 */
  beginTurn: (startAt: number) => void
  normalizeTurnEndTodo: () => void
  /** 运行状态对账（基线帧到达时核一次）。 */
  reconcileRunning: () => void
  enqueueLiveEvent: (event: WireEvent) => void
  reloadTail: () => void

  /** 用一帧的宿主时间戳校准宿主时钟（见 host-clock.ts）。 */
  syncHostClock: (hostMs: number) => void

  shadowEvent: (event: StatusEvent) => void
  setTodo: Dispatch<SetStateAction<TodoSnapshot | undefined>>
  adoptTodoLatest: (event: WireEvent) => void
  refreshSubagents: () => void
  refreshInbox: (options?: { fresh?: boolean }) => void
  claimQueueHead: (sessionId: string) => void
  queueView: (sessionId: string) => QueueItemView[]
  setQueueItems: Dispatch<SetStateAction<QueueItemView[]>>
  applyQueueItems: (sessionId: string, items: QueueItemView[]) => void
  setJobs: Dispatch<SetStateAction<JobView[]>>
  setPermissions: Dispatch<SetStateAction<PermissionSelectValue | undefined>>
  setContextPressure: Dispatch<SetStateAction<ContextPressureData | undefined>>
  applyInbox: (value: unknown) => void
  applyGoal: (value: unknown) => void
  setGoal: Dispatch<SetStateAction<MobileGoal | null | undefined>>
  setPendingApprovals: Dispatch<SetStateAction<PendingApproval[]>>
  setPendingQuestions: Dispatch<SetStateAction<PendingQuestionItem[]>>
  answeredApprovals: (sessionId: string) => ReadonlySet<string>
  answeredQuestions: (sessionId: string) => ReadonlySet<string>
  /** 亲眼看到收工的轮号（交付卡判据）。 */
  liveClosedTurns: Set<number>
  /** 本会话最后一次真实事件的时刻（链路活性旁证）。 */
  lastSessionEventAt: { current: number }
}

/**
 * 帧入口：与帧类型无关的几件事先做（慢消费者兜底、宿主时钟校准、链路恢复），再分派。
 * 顺序敏感：slow-consumer 在时钟校准与 `clearHostLost` **之前**（原实现如此）。
 */
export function dispatchFrame(ctx: FrameContext, frame: MuxFrame, frameRpcId?: string): void {
  // The host dropped frames for this subscriber (its queue hit the byte
  // cap on a slow tunnel). One synthetic frame per drop window; the only
  // recovery is a fresh tail read — the dropped frames are gone.
  if (frame.type === 'stream/error' && frame.error.code === 'slow-consumer') {
    toast('你落后太多，正在重新加载这一步')
    ctx.reloadTail()
    return
  }
  calibrateHostClock(ctx, frame)
  // Any frame proves the link is back (and the host alive).
  ctx.clearHostLost()

  if (frame.type === 'session/status' || frame.type === 'session/turn-boundary') {
    onRosterFrame(ctx, frame)
    return
  }
  if (frame.type === 'session/event') {
    onSessionEvent(ctx, frame)
    return
  }
  // Live projection pushes keep the permission picker and the context
  // usage chip current.
  if (frame.type === 'session/projection' && frame.sessionId === ctx.sessionId) {
    onProjection(ctx, frame)
    return
  }
  // 目标激活态帧：桌面端点暂停只撤授权（durable 相位仍 active），投影不会变，
  // 所以必须靠这一帧把条子的按钮从「暂停」换成「继续」。
  if (frame.type === 'goal/activation' && frame.sessionId === ctx.sessionId) {
    onGoalActivation(ctx, frame)
    return
  }
  // Background-task snapshot for this session (subagent delegations etc.).
  if (frame.type === 'session/jobs' && frame.sessionId === ctx.sessionId) {
    onJobs(ctx, frame)
    return
  }
  if (frame.type === 'session/subscribed' && frame.sessionId === ctx.sessionId) {
    onSubscribed(ctx)
    return
  }
  // Pending-message queue snapshot for this session (desktop QueueDock equivalent).
  if (frame.type === 'session/queue' && frame.sessionId === ctx.sessionId) {
    onQueue(ctx, frame)
    return
  }
  // Approval/question frames for this session (#1025).
  if (!('sessionId' in frame) || frame.sessionId !== ctx.sessionId) return
  if (frame.type === 'approval/requested') {
    onApprovalRequested(ctx, frame, frameRpcId)
    return
  }
  if (frame.type === 'approval/resolved') {
    onApprovalResolved(ctx, frame)
    return
  }
  if (frame.type === 'question/requested') {
    onQuestionRequested(ctx, frame, frameRpcId)
    return
  }
  if (frame.type === 'question/resolved') {
    onQuestionResolved(ctx)
    return
  }
}

/**
 * 宿主时钟校准（每帧一次，turn/start 除外）。
 *
 * Every live host event frame carries a `time` the host wrote moments
 * before dispatch, so it calibrates the host-clock offset. The running
 * turn's elapsed math then matches the DESKTOP clock (same host)
 * instead of drifting fast/slow by the phone's NTP skew over a public
 * link (a few seconds is normal phone-vs-PC clock difference). The
 * turn/start boundary frame is excluded: it anchors the clock and may
 * legitimately carry an older logged time.
 */
function calibrateHostClock(ctx: FrameContext, frame: MuxFrame): void {
  const frameEvent = (frame as { event?: { type?: unknown; time?: unknown } }).event
  if (typeof frameEvent?.time === 'number'
    && Number.isFinite(frameEvent.time)
    && frameEvent.type !== 'turn/start') {
    // 只把帧时间喂给宿主时钟（`host-clock.ts`）：由它用单调时钟把宿主时间往前推，
    // 读数 = 宿主时间 − 宿主锚点，手机墙钟完全不参与。老写法"样本里取最大偏移"
    // 在真机上会跳（墙钟被 NTP 拽、快包把偏移永久顶高），详见该模块顶部注释。
    // turn/start 照旧排除：它锚定秒表、携带更早的日志时间，拿来校准会把时钟往回拽。
    ctx.syncHostClock(frameEvent.time)
  }
}

/**
 * 宿主自己的运行裁决（`session/status` / `session/turn-boundary`）。
 *
 * The host's own running verdict. `turn/end` is the usual way the
 * indicator clears, but that frame can be lost (a reconnect window, a
 * killed turn, a stream that degraded to polling) and then nothing else
 * ever lowers it: the page kept painting the last turn as 深度求索中 and
 * claimed 输出中 while the desktop showed nothing running. The roster
 * event is the authoritative correction — it carries what the host
 * believes, independently of whether this page saw the boundary.
 */
function onRosterFrame(
  ctx: FrameContext,
  frame: Extract<MuxFrame, { type: 'session/status' | 'session/turn-boundary' }>,
): void {
  if (frame.sessionId !== ctx.sessionId) return
  const hostRunning = frame.running === true
  if (hostRunning) {
    // 迟到的"在跑"不许把已收工的回合重新点着：只有在本地也认为没在跑时才采纳
    if (!ctx.isRunning()) ctx.applyTurnVerdict({ running: true, seq: 'seq' in frame ? frame.seq : undefined })
  } else {
    // 停止纠正：边界帧可能已经丢了，这条必须生效
    ctx.applyTurnVerdict({ running: false, force: true })
  }
  // 花名册优先级最低：能被实时帧/宿主快照盖掉，只负责纠正「帧丢了」的残留。
  ctx.shadowEvent({ type: 'turn', at: Date.now(), source: 'roster', running: hostRunning })
  if (!hostRunning) {
    // Settling here must also drop the active-turn pointer and the clock
    // anchor, or the last turn keeps matching `liveTurn` and stays
    // "running" with a stopwatch that never stops.
    ctx.clearActiveTurn()
  }
}

function onSessionEvent(ctx: FrameContext, frame: Extract<MuxFrame, { type: 'session/event' }>): void {
  if (frame.sessionId !== ctx.sessionId) return
  // 本会话真的在送事件——核对判据之外的旁证，也用于链路活性判断。
  ctx.lastSessionEventAt.current = Date.now()
  const event = frame.view === undefined
    ? frame.event as WireEvent
    : { ...frame.event, view: frame.view } as WireEvent
  // Track the turn running state for the "outputting" indicator (#1017).
  if (typeof event.type === 'string') {
    if (event.type === 'turn/start') onTurnStart(ctx, event)
    if (event.type === 'turn/end') onTurnEnd(ctx, event)
    // todo/write is a full-list snapshot (last-write-wins): adopt it
    // into the plan strip. It keeps flowing into the fold below, which
    // ignores unknown types, so the message stream is unaffected.
    if (event.type === 'todo/write') startTransition(() => { ctx.adoptTodoLatest(event) })
  }
  ctx.enqueueLiveEvent(event)
}

/**
 * turn/start 边界。防的回归（#1017 / 真机 2026-11-01）：
 * - 「输出中」立刻亮：走唯一裁决入口（带 seq 单调），不许各写各的；
 * - 秒表锚在**日志里的真起点**（中途重载不回零）；
 * - subagent 树刷新（turn/start 是它们被拉起的时刻）；
 * - 计划条清空但**保留 seq 水位**，否则更旧的一页历史能把上一轮计划塞回来（串轮）；
 * - 队首认领要从状态仓里一起移走，否则下一份旧快照把它画回来（「消失→出现」闪一下）。
 */
export function onTurnStart(ctx: FrameContext, event: WireEvent): void {
  // 走唯一裁决入口：帧只是"证据之一"，带 seq 参与单调比较
  ctx.applyTurnVerdict({
    running: true,
    turn: turnNumberOf(event),
    startAt: typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : Date.now(),
    seq: (event as { seq?: number }).seq,
  })
  // Anchor the turn clock at the logged start (desktop parity):
  // a mid-turn reload keeps the real elapsed time.
  ctx.beginTurn(typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : Date.now())
  // A turn start is when subagents spawn; refresh the tree.
  ctx.refreshSubagents()
  // The host clears the todo projection at turn/start; mirror it so
  // a stale plan never outlives the turn that wrote it.
  //
  // 但**水位要留着**：直接 setTodo(undefined) 把上一轮那份计划的 seq 也丢了，
  // 之后一页更旧的历史（里面带着上一轮的 todo/write）就能把它重新塞回来 ——
  // 新回合已经开始、屏幕上却还挂着上一轮的计划（真机排查时可见的串轮）。
  // 保留 seq、清空条目：新回合自己的 todo/write seq 更大，照常落地。
  ctx.setTodo(previous => previous === undefined ? previous : { seq: previous.seq, items: [] })
  // A turn start claims the pending queue (the agent picks up the
  // next queued message in FIFO order). The host broadcasts a fresh
  // session/queue snapshot, but that frame can be lost when the SSE
  // channel degrades to fallback polling (which does not replay
  // session/queue). Clear the local queue view so a claimed message
  // never lingers as a phantom row that can no longer be edited or
  // removed.
  // 清空只是"队首被认领"的乐观视图：一轮开始只拿走队首一条，剩下的必须
  // 留着。以前清完就等下一次轮询（空闲时 20 秒），期间手机上整条队列消失，
  // 而桌面端（读宿主投影）还挂着 —— 真机就是这个现象。清完立刻问一次真值。
  // 只认领队首一条（宿主是 FIFO），其余还排着 —— 而且必须**从状态仓里**
  // 一起移走：只清本地列表的话，下一份快照（可能是几分钟前的投影）会把
  // 被认领的那条画回来，排队条就「消失→出现」闪一下。
  ctx.claimQueueHead(ctx.sessionId)
  startTransition(() => { ctx.setQueueItems(ctx.queueView(ctx.sessionId)) })
  ctx.refreshInbox({ fresh: true })
}

/**
 * turn/end 边界。防的回归（真机：卡片/过程条状态不对）：
 * - 收尾必须**亲眼看到**才算收工：轮号进 `liveClosedTurns`（交付卡凭据）并落 running；
 * - 三根条按 frame 优先级发布（只有宿主复核的 local 能再改它）；
 * - 清活跃轮次，否则上一轮的行一直定格在「运行中」（秒表不停）；
 * - 待办按宿主同一份归一化，否则计划条停在上一轮。
 */
export function onTurnEnd(ctx: FrameContext, event: WireEvent): void {
  // 这一轮的收尾是**亲眼看到**的：它的卡由实时帧自己折出来（带参数、
  // 带 tool/result 的 meta），不必再为它回读日志。
  const closed = turnNumberOf(event)
  if (closed !== undefined) ctx.liveClosedTurns.add(closed)
  ctx.applyTurnVerdict({ running: false, seq: (event as { seq?: number }).seq })
  // 亲眼看到的收尾：frame 优先级，只有 local（宿主复核）能再改它。
  ctx.shadowEvent({
    type: 'turn',
    at: Date.now(),
    source: 'frame',
    running: false,
    ...(closed === undefined ? {} : { turnNo: closed }),
  })
  // 活跃轮次随之清空：按步定格的行立刻回到 已完成/已中断/失败。
  ctx.clearActiveTurn()
  // Mirror the host's turn/end normalization (see normalizeTurnEndTodo).
  ctx.normalizeTurnEndTodo()
}

function onProjection(ctx: FrameContext, frame: Extract<MuxFrame, { type: 'session/projection' }>): void {
  if (frame.key === 'permissions') ctx.setPermissions(parsePermissionSelect(frame.value))
  if (frame.key === 'contextPressure') ctx.setContextPressure(parseContextPressure(frame.value))
  // 排队消息也走投影：宿主从不发 `session/queue`，发的是 `inbox`。漏了这条，
  // 手机端就永远看不到"已排队"的那几条。
  if (frame.key === 'inbox') ctx.applyInbox(frame.value)
  // 目标条也走投影：宿主在目标每次变更后推 key='goal' 的帧。
  if (frame.key === 'goal') ctx.applyGoal(frame.value)
}

function onGoalActivation(ctx: FrameContext, frame: Extract<MuxFrame, { type: 'goal/activation' }>): void {
  ctx.setGoal(current => current === null || current === undefined ? current : { ...current, activation: frame.activation })
}

function onJobs(ctx: FrameContext, frame: Extract<MuxFrame, { type: 'session/jobs' }>): void {
  startTransition(() => { ctx.setJobs(frame.jobs) })
}

/**
 * 新一条连接的基线帧（`session/subscribed`）。
 *
 * New mux-generation baseline: the host re-subscribes every session on
 * each stream (re)open and pushes its queue/jobs snapshots right after —
 * and only when non-empty. An omitted baseline means "empty", so any
 * rows retained from the previous generation would linger as phantoms
 * (the same re-baseline reset the desktop runtime applies to its queue
 * mirror on session/subscribed). Drop both views; the frames that follow
 * this one — if any — repopulate them.
 */
function onSubscribed(ctx: FrameContext): void {
  startTransition(() => { ctx.setQueueItems([]); ctx.setJobs([]) })
  // 新一条连接的基线帧：断线期间丢掉的 turn/end（或 turn/start）不会重放，
  // 手机就会一直停在"输出中"，或者该亮的时候不亮。基线一到就核一次。
  ctx.reconcileRunning()
}

function onQueue(ctx: FrameContext, frame: Extract<MuxFrame, { type: 'session/queue' }>): void {
  startTransition(() => {
    // 帧里带 placement，但手机端不采信 steering 这个值：点过「立即发送」之后宿主
    // 会把它标成 steering，而排队条只渲染 queued —— 于是这条在手机上整个消失，
    // 桌面端（读 next-turn 投影，那里没有 placement）却一直挂着。宿主的 next-turn
    // 才是"还在排队"的真值：只要它没把这条移走，两端就该都显示。
    const items = (frame.items ?? []).map(item => queueItemViewOf({
      id: String(item.id),
      placement: 'queued',
      message: item.message as never,
    }))
    // 帧也进状态仓：队列只有一个来源，本地隐藏/乐观项才不会跟帧互相盖掉。
    ctx.applyQueueItems(ctx.sessionId, items)
    ctx.setQueueItems(ctx.queueView(ctx.sessionId))
  })
}

/** `approval/requested`：手机答过的审批不许被 replay 复活。 */
function onApprovalRequested(
  ctx: FrameContext,
  frame: Extract<MuxFrame, { type: 'approval/requested' }>,
  frameRpcId: string | undefined,
): void {
  startTransition(() => {
    ctx.setPendingApprovals(previous => {
      // This phone already answered it: the host replays what it still
      // holds, and a replay must never resurrect an answered panel.
      if (ctx.answeredApprovals(ctx.sessionId).has(frame.approvalId)) return previous
      if (previous.some(a => a.approvalId === frame.approvalId)) return previous
      return [...previous, {
        rpcId: frameRpcId ?? '',
        approvalId: frame.approvalId,
        toolName: frame.toolName,
        callId: frame.callId,
        reason: frame.reason,
      }]
    })
  })
}

/** `approval/resolved`：任何一端答完，面板立刻收。 */
function onApprovalResolved(ctx: FrameContext, frame: Extract<MuxFrame, { type: 'approval/resolved' }>): void {
  startTransition(() => {
    ctx.setPendingApprovals(previous => previous.filter(a => a.approvalId !== frame.approvalId))
  })
}

/** `question/requested`：同一批问题答过就不再显示（宿主每次重订阅都会重放）。 */
function onQuestionRequested(
  ctx: FrameContext,
  frame: Extract<MuxFrame, { type: 'question/requested' }>,
  frameRpcId: string | undefined,
): void {
  const items = frame.questions.map(item => ({ rpcId: frameRpcId ?? '', ...item }))
  // A batch this phone already answered is never re-shown: the host
  // replays every still-pending question on each mux (re)subscribe, so a
  // late replay must not resurrect an answered panel.
  const unanswered = items.filter(q => !ctx.answeredQuestions(ctx.sessionId).has(q.rpcId))
  startTransition(() => { ctx.setPendingQuestions(unanswered) })
}

/** `question/resolved`：问题批次结束，面板清空。 */
function onQuestionResolved(ctx: FrameContext): void {
  startTransition(() => { ctx.setPendingQuestions([]) })
}
