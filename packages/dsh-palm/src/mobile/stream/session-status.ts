/**
 * 会话状态机：三根条（状态 / 排队 / 目标）的**唯一判据**。
 *
 * 以前「现在什么状态」有 5 个来源各自说话（mux 实时帧、宿主原子快照、排队投影、
 * 本地状态仓、运行花名册），三根条又各算一遍「要不要显示」，于是多重显示、跑完
 * 残留、旧快照盖新帧反复出现。这里收成三条不变量：
 *
 * 1. **单例**：回合 / 排队项 / 目标 / 计划 / 任务集合在状态里各只有一份（同 id 去重）。
 * 2. **租约**：任何可见值都带 `{until, source}`，事件只能延长租约，过期即失效；
 *    「要不要显示」只看租约，不看布尔标志。
 * 3. **固定优先级 + 过期降级**：local > snapshot > frame > roster；低优先级不得覆盖
 *    未过期的高优先级值，高优先级过期后低优先级才能接管。
 */

import type { JobView } from '../../api-proxy-types.ts'
import type { QueueItemView } from '../api.ts'
import type { TodoSnapshot } from '../render/messages.ts'

/** 数据来源。数字越大越可信。 */
export type StatusSource = 'roster' | 'frame' | 'snapshot' | 'local'

/** 各来源的优先级：本地意图 > 宿主原子快照 > 实时帧 > 花名册。 */
export const SOURCE_PRIORITY: Readonly<Record<StatusSource, number>> = {
  local: 3,
  snapshot: 2,
  frame: 1,
  roster: 0,
}

/**
 * 各来源的租约时长：快照 12s（`SNAPSHOT_STALE_MS`）、本地乐观 45s（`OPTIMISTIC_TTL_MS`）、
 * 花名册 15s（一轮校准时延）、实时帧 30s（一帧之后长时间没动静就当它过期）。
 * 收进来是为了让「过期」只有一处定义。
 */
export const SOURCE_LEASE_MS: Readonly<Record<StatusSource, number>> = {
  local: 45_000,
  snapshot: 12_000,
  frame: 30_000,
  roster: 15_000,
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
  | { type: 'turn'; at: number; source: StatusSource; running: boolean; turnNo?: number; startedAt?: number; step?: number; lastActivityAt?: number }
  | { type: 'queue'; at: number; source: StatusSource; items: readonly QueueItemView[] }
  | { type: 'goal'; at: number; source: StatusSource; goal: unknown; busy?: boolean }
  | { type: 'plan'; at: number; source: StatusSource; todo: TodoSnapshot | undefined }
  | { type: 'jobs'; at: number; source: StatusSource; jobs: readonly JobView[]; subagents: readonly unknown[] }

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
  // 2026-11-10 删掉「已 N 秒没有新输出」这一句：
  // ① 它是**否定式**文案（读起来像报错），而它描述的事实（慢）在过程条与状态条时钟上已经有了；
  // ② 输入框上方那一行整行下线，任务/子代理改由顶栏徽标 + 运行详情面板承担。
  // 判据仍留在下面：正常运行中这一条**什么都不说**。

  return {
    ...(parts.length > 0 ? { statusBar: parts.join(' · ') } : {}),
    queueBar: queue.length,
    ...(goalAlive && state.goal !== undefined && state.goal.value != null ? { goalBar: state.goal.value } : {}),
  }
}

/** 紧凑签名：渲染层据此只在「条的内容真的变了」时 setState。 */
export function barsSignature(view: BarsView): string {
  const bits: string[] = []
  bits.push(view.statusBar === undefined ? 'status:-' : `status:${view.statusBar}`)
  bits.push(`queue:${view.queueBar}`)
  bits.push(view.goalBar === undefined ? 'goal:-' : 'goal:+')
  return bits.join('|')
}

/* ────────────────────────── 排队条的可见判定 ────────────────────────── */

export interface QueueInputs {
  /** 宿主的权威队列（快照 / 应答 / 投影）。 */
  readonly host: readonly QueueItemView[]
}
/** 多久没有新输出才值得提示「卡住了」。20 秒（状态条现在已不再使用这句话，常量留给调用方）。 */
export const STALL_HINT_MS = 20_000

export function visibleQueue(inputs: QueueInputs): readonly QueueItemView[] {
  // C1b（2026-11-11）：这里只剩一件事 —— 按 id 去重。
  // 隐藏表、空队列观察窗、正文比对全部删除：队列的真值来自宿主的权威应答与快照，
  // 陈旧数据由 `applySnapshot` / `applyQueueItems` 的版本栅栏挡住。
  const seen = new Set<string>()
  const view: QueueItemView[] = []
  for (const item of inputs.host) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    view.push(item)
  }
  return view
}
