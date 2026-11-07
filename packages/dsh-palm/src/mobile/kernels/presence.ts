/**
 * Presence 内核（W3-4）：一条会话"现在什么状态"，全站只有一个答案。
 *
 * 病灶：同一个问题——"这条会话还在跑吗"——现在有**三条独立实现**：
 *
 * | 位置 | 依据 | 谁在用 |
 * |---|---|---|
 * | `mux.ts` 的 `RunningMirror` | 实时帧 + 宿主探针 | 连接层自己 |
 * | `shared/session-state.ts` 的 `resolveSessionRunning` | hostSaid / reported / quiet | 会话列表 |
 * | `session-status-store.ts` 的 `runningOf` | 带租约的帧状态 | App 的活跃集合、运行总览 |
 *
 * 三处判据不同，于是"列表里显示在跑、点进去却显示已结束"这类问题结构性存在。
 * 这里先做**唯一出口**：三个屏都问 {@link presenceOf}，语义统一由这里定义；
 * 内部先复用现有实现（行为不变），后续再把三份判据真正合并成一套。
 *
 * @module dsh-palm/mobile/kernels/presence
 */
import { finishedRuns } from '../recent-finished.ts'
import { runningOf, statusSessionIds, subscribeStatus } from '../session-status-store.ts'

/** 一条会话的对外状态。 */
export interface SessionPresence {
  /**
   * 是否在跑。`undefined` = **没有证据**（没人发布过状态），调用方应退回自己的兜底判断，
   * 而不是当成"没在跑"。
   */
  readonly running: boolean | undefined
  /** 最近一次已结束的运行（如果有），用于列表上的"3 分钟前结束"。 */
  readonly finishedAt?: number
  /** 那次结束的结局：正常收工 / 出错 / 被中断。 */
  readonly finishedStatus?: 'done' | 'error' | 'stopped'
  /** 这次判断的依据来源，排查不一致时有用。 */
  readonly source: 'frames' | 'none'
}

/**
 * 读一条会话的状态。
 *
 * @param sessionId - 会话 id
 * @param now - 注入时间（测试用；默认取当前时间）
 */
export function presenceOf(sessionId: string, now: number = Date.now()): SessionPresence {  const running = runningOf(sessionId, now)
  const finished = finishedRuns(now).find(entry => entry.sessionId === sessionId)
  return {
    running,
    ...(finished === undefined ? {} : { finishedAt: finished.finishedAt, finishedStatus: finished.status }),
    source: running === undefined ? 'none' : 'frames',
  }
}

/**
 * 三态读法（`boolean | undefined`）：给需要保留"没有证据"语义的调用方用。
 * 与 {@link effectiveRunning} 的区别只在于**不兜底**。
 */
export function presenceRunning(sessionId: string, now: number = Date.now()): boolean | undefined {
  return runningOf(sessionId, now)
}

/**
 * 三态合并：**共享状态优先，没有证据才用兜底**。
 *
 * 三屏各自的兜底判据不同（会话列表看花名册+心跳，运行总览看实时帧，App 看花名册），
 * 但"谁说了算"必须是同一条规则 —— 这条函数就是那条规则，别在各处重写 `??`。
 */
export function mergeRunning(
  shared: boolean | undefined,
  fallback: boolean | undefined,
): boolean | undefined {
  return shared === undefined ? fallback : shared
}

/**
 * "这一轮到底跑不跑"的**唯一**规则：共享状态优先，没有状态才用调用方的兜底。
 *
 * 聊天页是唯一的生产者（它同时握着实时帧、原子快照和本地意图）；首页徽标与
 * 运行中页都问这一条，于是"聊天页说停了、运行中页还挂着"这类跨页矛盾没有来源。
 *
 * @param fallback - 没有共享状态时的判断（通常是调用方自己的花名册/帧结论）
 */
export function effectiveRunning(sessionId: string, fallback: boolean, now: number = Date.now()): boolean {
  return mergeRunning(runningOf(sessionId, now), fallback) ?? false
}

/**
 * 订阅"某条会话状态变了"。
 *
 * 目前合并状态存储；已结束账本的变化由运行总览自己订阅（它需要整本账，不只是一条）。
 * 返回值是退订函数。
 */
export function subscribePresence(listener: (sessionId: string) => void): () => void {
  return subscribeStatus(listener)
}

/**
 * 有证据"在跑"的会话集合。
 *
 * 给 App 的活跃集合用：**只收明确在跑的**，`undefined` 不算 —— 与
 * {@link SessionPresence.running} 的"没有证据不表态"保持一致。
 */
export function activeSessionIds(now: number = Date.now()): Set<string> {
  const active = new Set<string>()
  for (const sessionId of statusSessionIds()) {
    if (runningOf(sessionId, now) === true) active.add(sessionId)
  }
  return active
}
