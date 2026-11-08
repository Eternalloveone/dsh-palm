/**
 * 任务状态机：把现有的会话/回合数据推导成状态条要的 `kind / progress / steps`。
 *
 * ## 为什么要有它
 *
 * 状态条（`ui/status-strip.tsx`）只认三个字段：种类、进度、步数。而这三件事在
 * 现有数据里散着：宿主回合状态（`sessionState.turn` / `session/status` 帧）、
 * 计划快照（`render` 层折出来的 `TodoItem[]`）、最近一条助手行（`tools` 里
 * `state === 'running'` 的那条、`pending`、`reasoning`）、审批与排队。视图如果
 * 自己拼，就会重演「三根条各判一遍」的老问题；所以规则全部关在这里，**纯函数**
 * 只吃数据、不读时钟、不碰 React，能脱离 DOM 单测。
 *
 * ## 五条兜底（就是本模块的全部意义）
 *
 * 1. **终态锁定**：`completed` / `failed` / `cancelled` 任一到就是终态
 *    （`done` / `failed` / `stopped`）；同一轮后续再收到「在跑」也不许复活。
 * 2. **卡住**：在跑但 90 秒没有新事件 → `stuck`（`TASK_STUCK_AFTER_MS`）。
 *    刚开跑的那 90 秒不算 —— 上一轮的旧事件时间不能冒充这一轮的静默。
 * 3. **可重建**：状态是纯数据（`encodeTaskStatus` / `decodeTaskStatus`），
 *    重连后从存储读回来接着推，不依赖任何内存里的动画/定时器状态。
 * 4. **新一轮收尾上一轮**：收到更大的轮号而上一轮还开着 → 上一轮按终态收尾
 *    （记进 `previous`），新轮从零开始。
 * 5. **进度单调**：同一轮里 `progress = max(旧, 新)`；换轮才重置。
 *
 * ## 不编数据
 *
 * 拿不到的就不给：没有计划 → 没有 `steps` / `progress`（界面走 `unknown` 的
 * 游走块）；没有正在跑的工具 → 不猜「在读/在改」；没有终态证据 → 不进终态。
 *
 * @module dsh-palm/mobile/session/task-status
 */
import type { RenderMessage, TodoItem } from '../projections/types.ts'
import { classifyStep } from '../render/step-view.ts'
import type { StatusStripKind, StatusStripSteps } from '../ui/status-strip.tsx'

/** 状态条的任务种类（与 `ui/status-strip.tsx` 的视觉词表是同一套）。 */
export type TaskKind = StatusStripKind

/** 刻度轨的步数（`done` 已完成、`total` 总步数）。 */
export type TaskSteps = StatusStripSteps

/** 收尾证据（`turn/end` 的原因或宿主给的最后状态）。 */
export type TaskOutcome = 'completed' | 'failed' | 'cancelled'

/** 一轮的实时状态（来自 `sessionState.turn` / mux 的回合投影）。 */
export interface TaskTurnSignal {
  /** 宿主对「这一轮还开着吗」的回答。 */
  readonly running: boolean
  /** 轮号：用于识别「新一轮开始」。 */
  readonly turnNo?: number
  /** 这一轮的起点（宿主从日志补的锚点）。 */
  readonly startedAt?: number
  /** 最新事件时间（"多久没动静"的判据）。 */
  readonly lastActivityAt?: number
}

/** 最近一条助手行上的证据（用 {@link taskActivityOf} 从行列表折出来）。 */
export interface TaskActivity {
  /** 正在跑的工具（`state === 'running'` 的那条）。 */
  readonly tool?: { readonly name: string; readonly arguments?: string }
  /** 这一行还在出字（`pending === true`）。 */
  readonly streaming?: boolean
  /** 这一行有推理文本。 */
  readonly reasoning?: boolean
}

/** 状态机的输入：全部来自现有投影，缺字段就传 undefined。 */
export interface TaskStatusInput {
  /** 当前时刻（注入，保持纯函数）。 */
  readonly now: number
  /** 宿主回合状态（必填：它是「在不在跑」的唯一权威）。 */
  readonly turn: TaskTurnSignal
  /** 这一轮的计划（`TodoItem[]`；没有计划就别传）。 */
  readonly plan?: { readonly items: readonly TodoItem[] }
  /** 会话里挂着待你决定的审批/提问。 */
  readonly approval?: boolean
  /** 排队消息条数（宿主 inbox 投影）。 */
  readonly queued?: number
  /** 最近一条助手行上的证据。 */
  readonly activity?: TaskActivity
  /** 收尾证据；没有就说明「还不知道结果」。 */
  readonly outcome?: TaskOutcome
}

/**
 * 状态机的持久状态（纯数据，可 JSON 往返）。
 *
 * 只存「已经确认过的事实」：轮号、种类、终态、进度、步数、时间锚点。
 * 不存动画相位、定时器、上一次渲染用的任何东西 —— 这正是重连后能重建的原因。
 */
export interface TaskStatus {
  readonly kind: TaskKind
  /** 终态：`done` / `failed` / `stopped` 之一。 */
  readonly terminal: boolean
  /** 这一轮的轮号。 */
  readonly turn?: number
  /** 0..1，同一轮内单调不减。 */
  readonly progress?: number
  /** 刻度轨步数。 */
  readonly steps?: TaskSteps
  /** 这一轮的起点。 */
  readonly startedAt?: number
  /** 见过的最新事件时间（只增不减，乱序的旧事件不会把它拉回去）。 */
  readonly lastEventAt?: number
  /** 进入终态的时刻。 */
  readonly closedAt?: number
  /** 上一轮被新一轮顶掉时的收尾记录（兜底 4 的凭据）。 */
  readonly previous?: { readonly turn?: number; readonly kind: TaskKind; readonly at: number }
}

/** 90 秒没有新事件 → 可能卡住了（与 `run-detail` 的 `RUN_STALE_MS` 同一口径）。 */
export const TASK_STUCK_AFTER_MS = 90_000

/** 收尾证据 → 终态种类。 */
const OUTCOME_KINDS: Readonly<Record<TaskOutcome, TaskKind>> = {
  completed: 'done',
  failed: 'failed',
  cancelled: 'stopped',
}

/** 全部合法种类（解码时校验用）。 */
const ALL_KINDS: readonly TaskKind[] = [
  'think', 'read', 'edit', 'test', 'approve', 'stuck',
  'unknown', 'done', 'failed', 'stopped', 'queued',
]

/** 测试/命令行里值得算「跑测试」的关键词（其余 bash 归到「改/跑」那一档）。 */
const TEST_COMMAND = /\b(?:test|tests|vitest|jest|spec|lint|tsc|typecheck|build|check|verify)\b/i

/** 计划 → 步数（没有计划 / 空计划 → undefined，不编 0/0）。 */
export function planStepsOf(plan: { readonly items: readonly TodoItem[] } | undefined): TaskSteps | undefined {
  const items = plan?.items ?? []
  if (items.length === 0) return undefined
  let done = 0
  for (const item of items) if (item.status === 'completed') done += 1
  return { done, total: items.length }
}

/** 计划 → 进度：已完成 + 进行中的半格；没有计划 → undefined。 */
export function planProgressOf(plan: { readonly items: readonly TodoItem[] } | undefined): number | undefined {
  const items = plan?.items ?? []
  if (items.length === 0) return undefined
  let done = 0
  let active = 0
  for (const item of items) {
    if (item.status === 'completed') done += 1
    else if (item.status === 'in_progress') active += 1
  }
  return Math.min(1, (done + (active > 0 ? 0.5 : 0)) / items.length)
}

/**
 * 最近一条助手行 → 状态机的活动证据。
 *
 * 只读现有投影字段（`kind` / `pending` / `reasoning` / `tools[].state`），
 * 不假设宿主一定给了工具参数：缺了就只给名字。
 *
 * @param rows - 当前窗口里的渲染行
 * @returns 活动证据（什么都不知道时是空对象）
 */
export function taskActivityOf(rows: readonly RenderMessage[]): TaskActivity {
  let last: RenderMessage | undefined
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (row !== undefined && row.kind === 'assistant') {
      last = row
      break
    }
  }
  if (last === undefined) return {}

  let tool: { readonly name: string; readonly arguments?: string } | undefined
  const calls = last.tools ?? []
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index]
    if (call === undefined || call.state !== 'running') continue
    tool = { name: call.name, ...(call.arguments === undefined ? {} : { arguments: call.arguments }) }
    break
  }

  const reasoning = (last.reasoning ?? '') !== ''
  return {
    ...(tool === undefined ? {} : { tool }),
    ...(last.pending === true ? { streaming: true } : {}),
    ...(reasoning ? { reasoning: true } : {}),
  }
}

/**
 * 正在跑的工具 → 状态条种类。
 *
 * `search`/`read` 归「读」，`write`/`edit` 归「改」；`bash`/`run_code` 看命令
 * 里有没有测试/构建类关键词，没有就归「改/跑」那一档（同一张眯眼脸）。
 * 认不出名字的工具 → undefined（让上层退回 `unknown`，不硬猜）。
 *
 * @param tool - 工具名与原始参数
 * @returns 对应的种类；认不出来时 undefined
 */
export function taskKindOfTool(tool: { readonly name: string; readonly arguments?: string }): TaskKind | undefined {
  const variant = classifyStep(tool.name)
  if (variant === 'read' || variant === 'search') return 'read'
  if (variant === 'write' || variant === 'edit') return 'edit'
  if (variant === 'bash' || variant === 'code') {
    return TEST_COMMAND.test(tool.arguments ?? '') ? 'test' : 'edit'
  }
  return undefined
}

/**
 * 是不是「可能卡住了」。
 *
 * @param now - 当前时刻
 * @param lastEventAt - 最新事件时间（可省）
 * @param startedAt - 这一轮的起点（可省；用来给刚开跑的回合宽限）
 * @returns 在跑但静默超过 {@link TASK_STUCK_AFTER_MS} 时为 true
 */
export function taskStuck(
  now: number,
  lastEventAt: number | undefined,
  startedAt: number | undefined,
): boolean {
  if (!Number.isFinite(now)) return false
  const anchor = lastEventAt ?? startedAt
  if (anchor === undefined || !Number.isFinite(anchor)) return false
  // 刚开跑的那 90 秒不判卡住：上一轮的旧事件时间会冒充这一轮的静默
  // （真机踩过：「点了发送，条先闪一下『可能卡住了』」）。
  if (startedAt !== undefined && Number.isFinite(startedAt) && now - startedAt < TASK_STUCK_AFTER_MS) {
    return false
  }
  return now - anchor >= TASK_STUCK_AFTER_MS
}

/** 同一轮内进度取大（兜底 5）。 */
function mergeProgress(previous: number | undefined, next: number | undefined): number | undefined {
  if (previous === undefined) return next
  if (next === undefined) return previous
  return Math.max(previous, next)
}

/** 时间锚点取新（乱序的旧事件不许把它拉回去）。 */
function latestTime(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.max(a, b)
}

/** 组装一条状态（可选字段没值就不写，避免出现 `undefined` 字段）。 */
function buildStatus(parts: {
  kind: TaskKind
  terminal: boolean
  turn: number | undefined
  carry: TaskStatus | undefined
  steps: TaskSteps | undefined
  derivedProgress: number | undefined
  startedAt: number | undefined
  lastEventAt: number | undefined
  closedAt: number | undefined
  closed: TaskStatus['previous']
}): TaskStatus {
  // 完成态一律 100%；其余在同一轮内取大。
  const progress = parts.terminal && parts.kind === 'done'
    ? 1
    : mergeProgress(parts.carry?.progress, parts.derivedProgress)
  const steps = parts.steps ?? parts.carry?.steps
  return {
    kind: parts.kind,
    terminal: parts.terminal,
    ...(parts.turn === undefined ? {} : { turn: parts.turn }),
    ...(steps === undefined ? {} : { steps }),
    ...(progress === undefined ? {} : { progress }),
    ...(parts.startedAt === undefined ? {} : { startedAt: parts.startedAt }),
    ...(parts.lastEventAt === undefined ? {} : { lastEventAt: parts.lastEventAt }),
    ...(parts.closedAt === undefined ? {} : { closedAt: parts.closedAt }),
    ...(parts.closed === undefined ? {} : { previous: parts.closed }),
  }
}

/**
 * 推进一步：吃「上一版状态 + 这一版证据」，吐出新的状态。
 *
 * 纯函数：同一个 `previous` 与同一个 `input` 永远得到同一个结果；乱序的旧轮
 * 信号被丢弃，重复的同一版输入是幂等的。
 *
 * @param previous - 上一版状态（重连后从存储读回来的那一份）
 * @param input - 这一版的回合/计划/审批/排队/活动证据
 * @returns 新状态
 */
export function foldTaskStatus(previous: TaskStatus | undefined, input: TaskStatusInput): TaskStatus {
  const now = input.now
  const turnNo = input.turn.turnNo ?? previous?.turn
  const running = input.turn.running === true

  // 乱序：更旧的轮号一律丢弃（重连补帧、对账回包晚到都很常见）。
  if (previous?.turn !== undefined && turnNo !== undefined && turnNo < previous.turn) return previous

  // 兜底 4：新一轮顶掉上一轮 —— 上一轮还开着就按终态收尾，状态从零开始。
  let base = previous
  let closed = previous?.previous
  if (previous !== undefined && previous.turn !== undefined && turnNo !== undefined && turnNo > previous.turn) {
    closed = {
      turn: previous.turn,
      kind: previous.terminal ? previous.kind : 'done',
      at: now,
    }
    base = undefined
  }

  const sameTurn = base !== undefined && (turnNo === undefined || base.turn === undefined || base.turn === turnNo)
  const carry = sameTurn ? base : undefined
  const steps = planStepsOf(input.plan)
  const derivedProgress = planProgressOf(input.plan)
  const startedAt = input.turn.startedAt ?? carry?.startedAt
  const lastEventAt = latestTime(carry?.lastEventAt, input.turn.lastActivityAt)

  // 这一轮的时间锚点与「同一轮才继承」的上一版状态，所有分支共用。
  const make = (
    kind: TaskKind,
    terminal: boolean,
    options: { carry?: TaskStatus | undefined; steps?: TaskSteps | undefined; derivedProgress?: number | undefined; closedAt?: number } = {},
  ): TaskStatus => buildStatus({
    kind,
    terminal,
    turn: turnNo,
    carry: 'carry' in options ? options.carry : carry,
    steps: 'steps' in options ? options.steps : steps,
    derivedProgress: 'derivedProgress' in options ? options.derivedProgress : derivedProgress,
    startedAt,
    lastEventAt,
    closedAt: options.closedAt,
    closed,
  })

  // 兜底 1：completed / failed / cancelled 任一到 → 终态。
  if (input.outcome !== undefined) return make(OUTCOME_KINDS[input.outcome], true, { closedAt: now })

  // 兜底 1（续）：同一轮已经收尾 → 后面的活动不许把它重新点着。
  if (carry?.terminal === true) return carry

  // 等你就绪：那一轮正在等你决定，比「在跑」更靠前。
  if (input.approval === true) return make('approve', false)

  // 没在跑：还有排队消息就说「排队」，否则就是「不知道」（不假装成功）。
  if (!running) {
    if ((input.queued ?? 0) > 0) {
      return make('queued', false, { carry: undefined, steps: undefined, derivedProgress: undefined })
    }
    return make('unknown', false)
  }

  // 兜底 2：在跑但静默太久 → 卡住（不是终态：下一帧一到就接着走）。
  if (taskStuck(now, lastEventAt, startedAt)) return make('stuck', false)

  // 在跑：先看工具在干什么，其次看是不是在出字/推理，有计划也算在推进。
  const tool = input.activity?.tool
  if (tool !== undefined) {
    const kind = taskKindOfTool(tool)
    if (kind !== undefined) return make(kind, false)
  }
  if (input.activity?.streaming === true || input.activity?.reasoning === true) return make('think', false)
  if (steps !== undefined) return make('think', false)
  // 什么证据都没有：不猜，走「正在做、没拆出计划」的游走块。
  return make('unknown', false)
}

/** 一次性推导（等于没有上一版的 {@link foldTaskStatus}）。 */
export function deriveTaskStatus(input: TaskStatusInput): TaskStatus {
  return foldTaskStatus(undefined, input)
}

/* ── 存储往返（兜底 3：重连后从存储重建） ─────────────────────────────── */

/**
 * 状态 → 存储字符串。
 *
 * @param status - 当前状态
 * @returns JSON 字符串（调用方负责写进 localStorage / IndexedDB）
 */
export function encodeTaskStatus(status: TaskStatus): string {
  return JSON.stringify(status)
}

function decodeSteps(raw: unknown): TaskSteps | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const done = record['done']
  const total = record['total']
  if (typeof done !== 'number' || !Number.isFinite(done)) return undefined
  if (typeof total !== 'number' || !Number.isFinite(total)) return undefined
  return { done, total }
}

function decodePrevious(raw: unknown): TaskStatus['previous'] {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const kind = record['kind']
  const at = record['at']
  if (typeof kind !== 'string' || !ALL_KINDS.includes(kind as TaskKind)) return undefined
  if (typeof at !== 'number' || !Number.isFinite(at)) return undefined
  const turn = record['turn']
  return {
    ...(typeof turn === 'number' && Number.isFinite(turn) ? { turn } : {}),
    kind: kind as TaskKind,
    at,
  }
}

/**
 * 存储字符串 → 状态（坏数据一律丢弃，绝不抛）。
 *
 * @param raw - 存储里的字符串（null/空串/损坏的 JSON 都返回 undefined）
 * @returns 可继续折叠的状态；读不出来时 undefined（调用方从零开始）
 */
export function decodeTaskStatus(raw: string | null | undefined): TaskStatus | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as Record<string, unknown>
  const kind = record['kind']
  const terminal = record['terminal']
  if (typeof kind !== 'string' || !ALL_KINDS.includes(kind as TaskKind)) return undefined
  if (typeof terminal !== 'boolean') return undefined

  const numberAt = (key: string): number | undefined => {
    const value = record[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  }
  const turn = numberAt('turn')
  const progress = numberAt('progress')
  const startedAt = numberAt('startedAt')
  const lastEventAt = numberAt('lastEventAt')
  const closedAt = numberAt('closedAt')
  const steps = decodeSteps(record['steps'])
  const previous = decodePrevious(record['previous'])
  return {
    kind: kind as TaskKind,
    terminal,
    ...(turn === undefined ? {} : { turn }),
    ...(steps === undefined ? {} : { steps }),
    ...(progress === undefined ? {} : { progress }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(lastEventAt === undefined ? {} : { lastEventAt }),
    ...(closedAt === undefined ? {} : { closedAt }),
    ...(previous === undefined ? {} : { previous }),
  }
}
