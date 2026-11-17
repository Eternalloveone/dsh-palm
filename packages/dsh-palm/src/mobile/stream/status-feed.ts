/**
 * 状态条投影：把「这一拍该给状态机喂什么」与「喂完它说该显示什么」分成两步纯计算。
 *
 * 为什么（T2）：`ChatView` 里原来是一个 50 行的 effect —— 先在闭包里算 `activeTurn` /
 * `turnStep` / `lastActivityAt`，再连发 5 次 `shadowEvent(...)` 喂同一个 ref，最后
 * `sweepExpired` + `describeBars` + 签名比对落状态。判据、喂法、落状态三件事混在一起，
 * 出问题时（真机「有任务那条状态条 12 秒后自己消失」）没法单独验。
 *
 * 拆成：
 * 1. {@link deriveStatusFrame} —— 纯函数，从行与实时值算出这一帧的快照；
 * 2. {@link feedStatusFrame} —— 纯函数，把同一帧按固定顺序喂给状态机并扫过期。
 *
 * 顺序就是语义（租约、优先级都在 `session-status.ts` 里），所以顺序写在这里，不再散在视图里。
 *
 * @module dsh-palm/mobile/stream/status-feed
 */
import type { TodoSnapshot } from '../render/messages.ts'
import type { JobView } from '../../api-proxy-types.ts'
import type { QueueItemView } from '../api.ts'
import {
  sessionStatusReducer, sweepExpired,
  type SessionStatus, type StatusEvent,
} from './session-status.ts'

/** 一帧状态快照（喂状态机的全部输入）。 */
export interface StatusFrame {
  running: boolean
  /** 这一轮里出现过的最大 step（过程条头只显示用时，不显示步序）。 */
  turnStep: number | undefined
  /** 新近 8 行里最大的 `time`：判断这一轮是不是卡住了。 */
  lastActivityAt: number | undefined
  queueItems: readonly QueueItemView[]
  goal: unknown
  goalBusy: boolean
  todo: TodoSnapshot | undefined
  jobs: readonly JobView[]
  subagents: readonly unknown[]
  /** 喂给状态机的轮号（帧里没有时的兜底，可以是 undefined）。 */
  turnNo: number | undefined
}

/** 参与投影的最小行形状（只读这几个字段，不绑死 RenderMessage）。 */
export interface StatusRow {
  turn?: number
  step?: number
  time?: number
}

export interface StatusFrameInput {
  running: boolean
  /** 帧里报告的轮号。 */
  runningTurn: number | undefined
  messages: readonly StatusRow[]
  /** **未合并**的原始行（合并后的一步卡只留第一步的 step，拿它数步序永远是 1）。 */
  rawRows: readonly StatusRow[]
  queueItems: readonly QueueItemView[]
  goal: unknown
  goalBusy: boolean
  todo: TodoSnapshot | undefined
  jobs: readonly JobView[]
  subagents: readonly unknown[]
}

/**
 * 算这一帧的快照。纯函数：同样的输入永远同样的输出。
 *
 * @param input - 见 {@link StatusFrameInput}
 * @returns 见 {@link StatusFrame}
 */
export function deriveStatusFrame(input: StatusFrameInput): StatusFrame {
  const { running, runningTurn, messages, rawRows, queueItems, goal, goalBusy, todo, jobs, subagents } = input

  // 轮号不一定拿得到（有的宿主只给行的状态），此时用「最靠后那一行所在的轮」兜底 ——
  // 正在跑的那一轮永远在列表末尾。
  let activeTurn = runningTurn
  if (activeTurn === undefined && running) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const turn = messages[index]?.turn
      if (turn !== undefined) { activeTurn = turn; break }
    }
  }

  let turnStep: number | undefined
  if (activeTurn !== undefined) {
    for (const row of rawRows) {
      if (row.turn !== activeTurn || row.step === undefined) continue
      if (turnStep === undefined || row.step > turnStep) turnStep = row.step
    }
  }

  let lastActivityAt: number | undefined
  for (let index = Math.max(0, messages.length - 8); index < messages.length; index += 1) {
    const time = messages[index]?.time
    if (typeof time === 'number' && (lastActivityAt === undefined || time > lastActivityAt)) lastActivityAt = time
  }

  return {
    running,
    turnStep,
    lastActivityAt,
    queueItems,
    goal,
    goalBusy,
    todo,
    jobs,
    subagents,
    turnNo: runningTurn,
  }
}

/**
 * 把一帧喂给状态机，并扫掉过期租约。顺序即语义，不要重排。
 *
 * @param state - 上一帧的状态机
 * @param frame - 见 {@link StatusFrame}
 * @param now - 现在（毫秒）
 * @returns 新状态机（不修改入参）
 */
export function feedStatusFrame(state: SessionStatus, frame: StatusFrame, now: number): SessionStatus {
  const events: StatusEvent[] = [
    // 帧来源优先级最高：它是"现在在跑没跑"的权威。
    {
      type: 'turn',
      at: now,
      source: 'frame',
      running: frame.running,
      ...(frame.turnNo === undefined ? {} : { turnNo: frame.turnNo }),
      ...(frame.turnStep === undefined ? {} : { step: frame.turnStep }),
      ...(frame.lastActivityAt === undefined ? {} : { lastActivityAt: frame.lastActivityAt }),
    },
    { type: 'queue', at: now, source: 'snapshot', items: frame.queueItems },
    { type: 'goal', at: now, source: 'snapshot', goal: frame.goal, busy: frame.goalBusy },
    { type: 'plan', at: now, source: 'snapshot', todo: frame.todo },
    { type: 'jobs', at: now, source: 'snapshot', jobs: frame.jobs, subagents: frame.subagents },
  ]
  let next = state
  for (const event of events) next = sessionStatusReducer(next, event)
  return sweepExpired(next, now)
}
