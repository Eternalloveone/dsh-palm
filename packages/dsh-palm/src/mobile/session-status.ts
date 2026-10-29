/**
 * 会话状态机（阶段 0：旁路只读）。
 *
 * ## 为什么要有它
 *
 * 一个会话的「现在什么状态」以前有 5 个来源各自说话：mux 实时帧、宿主原子快照
 * `mobile.sessionState`、排队投影 `inbox.next-turn`、本地状态仓（乐观队列/隐藏项）、
 * 运行花名册 `mobile.runningSessions`（会撒谎，要靠 `mobile.turnState` 复核）。
 * 而三根条各读各的、各算一遍「要不要显示」：
 *
 *   RunStatusBar(todo, jobs, subagents) / GoalBar(goal, busy) / QueueDock(queueItems)
 *
 * 于是同一类毛病反复出现：多重显示（两个源各画一条）、残留（跑完还挂着）、
 * 顺序错乱（旧快照盖掉新帧）、跨页说法不一。补丁从 4 秒观察窗打到 90 秒隐藏表，
 * 本质上都是在给「没有租约、没有优先级、没有单一判断点」打补丁。
 *
 * ## 三条不变量（本模块的全部意义）
 *
 * 1. **单例**：同一时刻「当前回合 / 当前排队项 / 当前目标 / 当前计划 / 任务集合」在状态里
 *    各只有一份。同 id 的排队项去重，回合只有一条。
 * 2. **租约**：任何可见值都必须持有租约 `{until, by}`；事件只能延长租约，过期即失效。
 *    「要不要显示」只看租约，不看布尔标志。
 * 3. **固定优先级 + 过期降级**：`local(4) > snapshot(3) > frame(2) > roster(1) > cache(0)`。
 *    低优先级不得覆盖未过期的高优先级值；高优先级过期后低优先级才能接管。
 *
 * ## 阶段 0 的用法
 *
 * 本文件目前**不进生产路径**：ChatView 只把状态喂给它、拿它的结论和现有实现在
 * 控制台对照（`describeBars`），不一致就打印。判据对齐之后再逐条切换 UI。
 */

import type { JobView } from '../api-proxy-types.ts'
import type { QueueItemView } from './api.ts'
import type { TodoSnapshot } from './messages.ts'

/** 数据来源。数字越大越可信。 */
export type StatusSource = 'cache' | 'roster' | 'frame' | 'snapshot' | 'local'

/** 各来源的优先级：本地意图 > 宿主原子快照 > 实时帧 > 花名册 > 缓存。 */
export const SOURCE_PRIORITY: Readonly<Record<StatusSource, number>> = {
  local: 4,
  snapshot: 3,
  frame: 2,
  roster: 1,
  cache: 0,
}

/**
 * 各来源的租约时长。
 *
 * 这些数字不是新发明的：它们对应原先散落在各处的常量 ——
 * 快照 12s(`SNAPSHOT_STALE_MS`)、本地乐观 45s(`OPTIMISTIC_TTL_MS`)、
 * 花名册 15s（一轮校准时延）、实时帧 30s（一帧之后长时间没动静就当它过期）。
 * 收进来是为了让「过期」只有一处定义。
 */
export const SOURCE_LEASE_MS: Readonly<Record<StatusSource, number>> = {
  local: 45_000,
  snapshot: 12_000,
  frame: 30_000,
  roster: 15_000,
  cache: 60_000,
}

/** 某个可见值：值本身 + 它由谁给出、租到什么时候。 */
export interface Leased<T> {
  readonly value: T
  readonly source: StatusSource
  /** 租约截止（毫秒时间戳）。过了这个点 value 不再可信。 */
  readonly until: number
  /** 收到这一版的时间。 */
  readonly at: number
}

/** 回合（谁在跑）。 */
export interface TurnStatus {
  readonly running: boolean
  readonly turnNo?: number
  readonly startedAt?: number
  /** 这一轮跑到第几步（内部用，不再展示给用户）。 */
  readonly step?: number
  /** 最后一次看到输出的时刻：用来判断「是不是卡住了」。 */
  readonly lastActivityAt?: number
  /** 这一轮**被看到在跑**的起始时刻（跨心跳保持不变，用来做卡的宽限期）。 */
  readonly runningSince?: number
}

export interface SessionStatusShape {
  readonly turn?: Leased<TurnStatus>
  readonly queue?: Leased<readonly QueueItemView[]>
  readonly goal?: Leased<unknown>
  readonly goalBusy: boolean
  readonly plan?: Leased<TodoSnapshot | undefined>
  readonly jobs?: Leased<readonly JobView[]>
  readonly subagents?: Leased<readonly unknown[]>
}

export interface SessionStatus extends SessionStatusShape {
  /** 每接受一次变更就 +1（渲染层可以拿它做 memo 依赖）。 */
  readonly revision: number
}

export type StatusEvent =
  | { type: 'open'; at: number }
  | { type: 'turn'; at: number; source: StatusSource; running: boolean; turnNo?: number; startedAt?: number; step?: number; lastActivityAt?: number }
  | { type: 'queue'; at: number; source: StatusSource; items: readonly QueueItemView[] }
  | { type: 'goal'; at: number; source: StatusSource; goal: unknown; busy?: boolean }
  | { type: 'plan'; at: number; source: StatusSource; todo: TodoSnapshot | undefined }
  | { type: 'jobs'; at: number; source: StatusSource; jobs: readonly JobView[]; subagents: readonly unknown[] }
  | { type: 'verify'; at: number; running: boolean; turnNo?: number }

export function createSessionStatus(): SessionStatus {
  return { goalBusy: false, revision: 0 }
}

/** 这一条现在还算数吗？ */
export function leaseAlive<T>(leased: Leased<T> | undefined, now: number): boolean {
  return leased !== undefined && leased.until > now
}

/**
 * 该不该接受这次更新？
 *
 * 规则（顺序即优先级）：
 * 1. 没有现值 → 接受。
 * 2. 现值已过期 → 接受（低优先级也能接管）。
 * 3. 新来源优先级更高 → 接受。
 * 4. 同优先级且更新（`at` 更大）→ 接受。
 * 5. 其余拒绝（这就是「旧快照不许盖新帧」）。
 */
export function shouldAccept<T>(
  current: Leased<T> | undefined,
  incoming: { at: number; source: StatusSource },
  now: number,
): boolean {
  if (current === undefined) return true
  if (current.until <= now) return true
  const currentRank = SOURCE_PRIORITY[current.source]
  const incomingRank = SOURCE_PRIORITY[incoming.source]
  if (incomingRank !== currentRank) return incomingRank > currentRank
  return incoming.at >= current.at
}

function lease<T>(value: T, event: { at: number; source: StatusSource }): Leased<T> {
  return {
    value,
    source: event.source,
    at: event.at,
    until: event.at + SOURCE_LEASE_MS[event.source],
  }
}

/** 排队项按 id 去重（同一 id 保留后到的，因为后到的更可能是编辑后的正文）。 */
export function dedupeQueue(items: readonly QueueItemView[]): readonly QueueItemView[] {
  const seen = new Map<string, QueueItemView>()
  for (const item of items) seen.set(item.id, item)
  return [...seen.values()]
}

export function sessionStatusReducer(state: SessionStatus, event: StatusEvent): SessionStatus {
  switch (event.type) {
    case 'open':
      return createSessionStatus()
    case 'turn': {
      const wasRunning = state.turn !== undefined && state.turn.value.running
      const previousSince = state.turn?.value.runningSince
      const next: TurnStatus = {
        running: event.running,
        // 刚开跑（false → true）记下起点；心跳（一直 true）保持不变。
        ...(event.running
          ? { runningSince: wasRunning ? (previousSince ?? event.at) : event.at }
          : {}),
        ...(event.turnNo === undefined ? {} : { turnNo: event.turnNo }),
        ...(event.startedAt === undefined ? {} : { startedAt: event.startedAt }),
        ...(event.step === undefined ? {} : { step: event.step }),
        ...(event.lastActivityAt === undefined ? {} : { lastActivityAt: event.lastActivityAt }),
      }
      if (!shouldAccept(state.turn, event, event.at)) return state
      return { ...state, turn: lease(next, event), revision: state.revision + 1 }
    }
    case 'queue': {
      if (!shouldAccept(state.queue, event, event.at)) return state
      return { ...state, queue: lease(dedupeQueue(event.items), event), revision: state.revision + 1 }
    }
    case 'goal': {
      if (!shouldAccept(state.goal, event, event.at)) return state
      return {
        ...state,
        goal: lease(event.goal, event),
        // busy 是本地的「刚点下去、回执还没来」，不参与源竞争。
        goalBusy: event.busy ?? state.goalBusy,
        revision: state.revision + 1,
      }
    }
    case 'plan': {
      if (!shouldAccept(state.plan, event, event.at)) return state
      return { ...state, plan: lease(event.todo, event), revision: state.revision + 1 }
    }
    case 'jobs': {
      if (!shouldAccept(state.jobs, event, event.at)) return state
      const jobs = lease(event.jobs, event)
      return {
        ...state,
        jobs,
        subagents: { ...jobs, value: event.subagents },
        revision: state.revision + 1,
      }
    }
    case 'verify': {
      // 宿主复核（`mobile.turnState`）压过一切推断：它问的是「现在到底跑不跑」。
      // 复核结果用 `local` 优先级入账，避免被慢吞吞的花名册再盖回去。
      const next: TurnStatus = {
        ...(state.turn?.value ?? {}),
        running: event.running,
        ...(event.turnNo === undefined ? {} : { turnNo: event.turnNo }),
      }
      return {
        ...state,
        turn: lease(next, { at: event.at, source: 'local' }),
        revision: state.revision + 1,
      }
    }
    default:
      return state
  }
}

/** 过期清扫：把失效的值摘掉（渲染层随后自然什么都不显示）。 */
export function sweepExpired(state: SessionStatus, now: number): SessionStatus {
  let changed = false
  const next: Record<string, unknown> = { ...state }
  for (const key of ['turn', 'queue', 'goal', 'plan', 'jobs', 'subagents'] as const) {
    const entry = state[key] as Leased<unknown> | undefined
    if (entry !== undefined && entry.until <= now) {
      delete next[key]
      changed = true
    }
  }
  if (!changed) return state
  return { ...(next as object), revision: state.revision + 1 } as SessionStatus
}

export interface BarsView {
  /** 运行状态条要显示的文字；undefined = 不显示。 */
  readonly statusBar?: string
  /** 排队条显示的条目数；0 = 不显示。 */
  readonly queueBar: number
  /** 目标条要显示的目标；undefined = 不显示。 */
  readonly goalBar?: unknown
  /**
   * 状态条上除了「回合运行中」没有别的内容。
   *
   * UI 据此把它换成更有用的一句（已跑多久），而不是和底部的「输出中」说同一件事。
   */
  readonly runningOnly?: boolean
}

/** 短时长：`35 秒` / `4 分12秒`。 */
function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${minutes} 分` : `${minutes} 分${rest} 秒`
}

/** 计数：任务完成/总数（与 RunStatusBar 同口径）。 */
function planCounts(todo: TodoSnapshot | undefined): { done: number; total: number } {
  if (todo === undefined) return { done: 0, total: 0 }
  let done = 0
  for (const item of todo.items) if (item.status === 'completed') done += 1
  return { done, total: todo.items.length }
}

/**
 * 三根条「该长什么样」的唯一判据。
 *
 * 渲染层以后只调这一个函数，不再各自判断 —— 这就是「零判断渲染」的落点。
 * 阶段 0 里它只用于和现有实现对照。
 */
export function describeBars(state: SessionStatus, now: number): BarsView {
  const queueAlive = leaseAlive(state.queue, now)
  const goalAlive = leaseAlive(state.goal, now)
  const planAlive = leaseAlive(state.plan, now)
  const jobsAlive = leaseAlive(state.jobs, now)
  const subsAlive = leaseAlive(state.subagents, now)
  const turnAlive = leaseAlive(state.turn, now)

  const queue = queueAlive ? state.queue?.value ?? [] : []
  const todo = planAlive ? state.plan?.value ?? undefined : undefined
  const { done, total } = planCounts(todo)
  const jobs = jobsAlive ? state.jobs?.value ?? [] : []
  const subagents = subsAlive ? state.subagents?.value ?? [] : []
  const liveJobs = jobs.filter(job => job.status === 'running').length
  const liveSubagents = subagents.filter(entry => (entry as { activity?: string }).activity === 'running').length
  const turnRunning = turnAlive && state.turn?.value.running === true

  // 口径（2026-10-29 真机修正）：
  // ① **回合在跑本身就是信息** —— 没有任务、没有后台任务时也要显示「回合运行中」。
  //    以前这条只由任务/后台任务推导，于是进一个正在跑的会话「状态条根本不出现」，
  //    或者计划恰好全勾完的那几秒里消失。
  // ② 只有**回合已结束**且没有后台任务/子代理时才收起（"跑完凭空挂一条"仍然要治好）。
  // ③ 有任务 → 「任务 d/t」，在做的第几项也说出来。
  const parts: string[] = []
  if (todo !== undefined && todo.items.length > 0) {
    const activeIndex = todo.items.findIndex(item => item.status === 'in_progress')
    parts.push(activeIndex >= 0 ? `任务 ${done}/${total} · 正在做第 ${activeIndex + 1} 项` : `任务 ${done}/${total}`)
  }
  if (jobs.length > 0) {
    parts.push(liveJobs > 0 ? `后台任务 ${liveJobs} 个运行中` : `后台任务 ${jobs.length} 个`)
  }
  if (liveSubagents > 0) parts.push(`子代理 ${liveSubagents} 个运行中`)

  const allDone = total > 0 && done === total && liveJobs === 0 && liveSubagents === 0
  const idle = !turnRunning && allDone
  if (idle) parts.length = 0
  else if (parts.length === 0 && turnRunning) {
    // 正常输出中**什么都不说**：过程条有相位与用时、底部有「输出中」，再加一条就是噪音。
    // 只有「看起来卡住了」才值得占一行 —— 那才是用户在等、而且别处看不到的信息。
    const lastActivity = turnAlive ? state.turn?.value.lastActivityAt : undefined
    const startedAt = turnAlive ? state.turn?.value.startedAt : undefined
    const runningSince = turnAlive ? state.turn?.value.runningSince : undefined
    const since = lastActivity ?? startedAt
    // 宽限期：这一轮才刚开跑（< 20 秒）就不可能是「卡住」。
    // 真机（2026-10-29）：「点了发送，状态条先闪一下『已 30 秒没有新输出』再消失」——
    // 那一刻队列里最新的行还是上一轮的旧行，事件时间自然是几十秒前。
    const settledEnough = runningSince === undefined || now - runningSince >= STALL_HINT_MS
    if (since !== undefined && settledEnough && now - since >= STALL_HINT_MS) {
      parts.push(`已 ${formatElapsed(now - since)}没有新输出`)
    }
  }

  const runningOnly = parts.length === 1 && parts[0] === '回合运行中'
  return {
    ...(parts.length > 0 ? { statusBar: parts.join(' · ') } : {}),
    ...(runningOnly ? { runningOnly: true } : {}),
    queueBar: queue.length,
    ...(goalAlive && state.goal !== undefined && state.goal.value != null ? { goalBar: state.goal.value } : {}),
  }
}

/** 供影子对照用的紧凑签名（一眼能比出差异）。 */
export function barsSignature(view: BarsView): string {
  const bits: string[] = []
  bits.push(view.statusBar === undefined ? 'status:-' : `status:${view.statusBar}`)
  bits.push(`queue:${view.queueBar}`)
  bits.push(view.goalBar === undefined ? 'goal:-' : 'goal:+')
  return bits.join('|')
}

/* ────────────────────────── 排队条的可见判定 ────────────────────────── */

/**
 * 排队条的三个 TTL 常量，收进来后的统一口径（阶段 1 会替换 `session-store` 里那三份）。
 *
 * 它们本来各管一件事，但语义是同一个：**「先这么显示，最多显示这么久」**。
 * 收成租约之后，队列里每一项自己带截止时刻，不再靠外部的隐藏表 + 观察窗拼出来。
 */
/** 多久没有新输出才值得提示「卡住了」。20 秒：比正常的思考间隔长，又不至于让人干等。 */
export const STALL_HINT_MS = 20_000
export const QUEUE_HIDDEN_MS = 90_000
export const QUEUE_OPTIMISTIC_MS = 45_000
export const QUEUE_EMPTY_HOLD_MS = 4_000

/** 本地乐观项（发送后、宿主快照回来之前先画）。 */
export interface QueueIntent {
  readonly pendingId: string
  readonly text: string
  readonly placement: 'queued' | 'steering'
  readonly at: number
}

export interface QueueInputs {
  /** 宿主给的队列（权威快照或投影）。 */
  readonly host: readonly QueueItemView[]
  /** 本地乐观项（带自己的时间戳，过期自动退场）。 */
  readonly optimistic: readonly QueueIntent[]
  /**
   * 已经确定的隐藏项（由调用方按「宿主版本追上了没有」判断）。
   *
   * 版本判据留在状态仓里是有意的：它需要知道快照版本，属于存储层知识；
   * 而「隐藏能撑多久」由这里的 TTL 兜底 —— 两份判据各管一件事，不重复。
   */
  readonly hiddenIds?: ReadonlySet<string>
  /** 本地已经删掉/插队掉的 id → 隐藏时刻（TTL 兜底，避免宿主永不收敛时永久屏蔽）。 */
  readonly hiddenAt: ReadonlyMap<string, number>
  /** 上一次非空队列与「读到空」的观察窗截止时刻。 */
  readonly emptyHold?: { readonly items: readonly QueueItemView[]; readonly until: number }
  /** 已经进了对话的正文（宿主认领成这一轮的用户消息），乐观项据此退场。 */
  readonly spokenTexts?: ReadonlySet<string>
  /** 正文归一化（默认原样比较）。 */
  readonly normalize?: (text: string) => string
}

/** 乐观项退场判据：宿主队列里出现同一条正文、或已经进了对话、或超时。 */
export function optimisticAlive(intent: QueueIntent, inputs: QueueInputs, now: number): boolean {
  if (now - intent.at >= QUEUE_OPTIMISTIC_MS) return false
  const normalize = inputs.normalize ?? ((text: string): string => text)
  const text = normalize(intent.text)
  if (inputs.host.some(item => normalize(item.text) === text)) return false
  if (inputs.spokenTexts?.has(text) === true) return false
  return true
}

/**
 * 排队条**该显示哪些**（唯一判据）。
 *
 * 顺序就是优先级：宿主队列在前，本地乐观项补在后面（还没被宿主接管的那些）。
 * 隐藏、乐观超时、空队列观察窗全部按「时刻比较」处理 —— 不需要任何额外的布尔开关，
 * 也不会出现「时间到了但没人来清」的残留。
 */
export function visibleQueue(inputs: QueueInputs, now: number): readonly QueueItemView[] {
  const hidden = (id: string): boolean => {
    if (inputs.hiddenIds?.has(id) === true) {
      const at = inputs.hiddenAt.get(id)
      // 版本判据说它该隐藏；再看 TTL 是否还没撑过（防止宿主永不收敛时永久屏蔽）。
      return at === undefined || now - at < QUEUE_HIDDEN_MS
    }
    const at = inputs.hiddenAt.get(id)
    return at !== undefined && now - at < QUEUE_HIDDEN_MS
  }
  const normalize = inputs.normalize ?? ((text: string): string => text)
  // 宿主条目按 id 去重（投影可能把同一条列两次）。
  const seenHost = new Set<string>()
  const host = inputs.host.filter(item => {
    if (hidden(item.id)) return false
    if (seenHost.has(item.id)) return false
    seenHost.add(item.id)
    return true
  })
  // 乐观项按**正文**去重：同一条消息被点了两次「排队」（弱网下双击很常见）会塞进两条
  // 只差本地 id 的乐观项，屏幕上就是「莫名其妙多出来一个一模一样的」。同文只留最新那份。
  const seenText = new Set<string>()
  const extra: QueueItemView[] = []
  for (const intent of [...inputs.optimistic].sort((a, b) => b.at - a.at)) {
    if (!optimisticAlive(intent, { ...inputs, host: inputs.host }, now)) continue
    const key = normalize(intent.text)
    if (seenText.has(key)) continue
    seenText.add(key)
    extra.push({
      id: intent.pendingId,
      placement: intent.placement,
      text: intent.text,
      editable: true,
    })
  }
  const combined = [...host, ...extra]
  if (combined.length > 0) return combined
  // 读到空：观察窗内仍然显示上一次的非空队列（宿主刷新中的瞬时空态）。
  if (inputs.emptyHold !== undefined && inputs.emptyHold.until > now) {
    return inputs.emptyHold.items.filter(item => !hidden(item.id))
  }
  return []
}
