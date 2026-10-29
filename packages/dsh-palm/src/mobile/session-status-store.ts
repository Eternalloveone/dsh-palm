/**
 * 会话状态的跨页共享（阶段 P1）。
 *
 * ## 分工
 *
 * 聊天页是**生产者**：只有它同时握着 mux 实时帧、宿主原子快照和本地意图，也只有它
 * 知道「这一轮到底跑不跑」的最新判决。本模块只是把它的 `SessionStatus` 发布出来，
 * 供运行中页、首页徽标读取 —— 这样「同一回合，两个页面两种说法」从根上没有来源。
 *
 * 为什么不做成双向总线：读的一方（运行中页）没有实时帧，写回去只会制造第二个
 * 「谁最后写谁算数」的竞争。**单一生产者 + 多消费者**足够，也最好推理。
 *
 * ## 与 `session-store.ts` 的区别
 *
 * `session-store` 管的是**数据**（行、队列、快照）；这里管的是**判断结果**
 * （三根条该显示什么、回合跑不跑）。数据可以有多个来源，判断只该有一个。
 */

import {
  barsSignature,
  describeBars,
  sessionStatusReducer,
  sweepExpired,
  type BarsView,
  type SessionStatus,
  type StatusEvent,
} from './session-status.ts'

/** 同时记住几个会话的状态（手机不会同时开很多会话）。 */
export const STATUS_STORE_MAX = 8

interface Entry {
  status: SessionStatus
  bars: BarsView
  signature: string
  touchedAt: number
}

const entries = new Map<string, Entry>()
const listeners = new Set<(sessionId: string) => void>()

function publish(sessionId: string): void {
  for (const listener of listeners) listener(sessionId)
}

function evict(): void {
  while (entries.size > STATUS_STORE_MAX) {
    let oldestId: string | undefined
    let oldestAt = Number.POSITIVE_INFINITY
    for (const [id, entry] of entries) {
      if (entry.touchedAt < oldestAt) {
        oldestAt = entry.touchedAt
        oldestId = id
      }
    }
    if (oldestId === undefined) return
    entries.delete(oldestId)
  }
}

/** 投一个事件（生产者调用）。返回这次是否真的改变了对外可见的结论。 */
export function dispatchStatusEvent(sessionId: string, event: StatusEvent): boolean {
  const previous = entries.get(sessionId)
  const base = previous?.status ?? sessionStatusReducer(undefined as never, { type: 'open', at: event.at })
  const next = sessionStatusReducer(base, event)
  const now = event.type === 'open' ? event.at : event.at
  const swept = sweepExpired(next, now)
  const bars = describeBars(swept, now)
  const signature = barsSignature(bars)
  const changed = signature !== (previous?.signature ?? '')
  entries.set(sessionId, { status: swept, bars, signature, touchedAt: now })
  evict()
  if (changed) publish(sessionId)
  return changed
}

/** 读三根条的结论（消费者调用）。 */
export function barsOf(sessionId: string): BarsView | undefined {
  return entries.get(sessionId)?.bars
}

/** 读整份状态（消费者调用）。 */
export function statusOf(sessionId: string): SessionStatus | undefined {
  return entries.get(sessionId)?.status
}

/**
 * 这一轮现在是否在跑。
 *
 * 消费者的兜底语义：**没有状态就不表态**（返回 undefined），由调用方退回自己的
 * 花名册判断 —— 不能因为「没人发布过」就假装它没在跑。
 */
export function runningOf(sessionId: string, now: number = Date.now()): boolean | undefined {
  const entry = entries.get(sessionId)
  if (entry === undefined) return undefined
  const turn = entry.status.turn
  if (turn === undefined || turn.until <= now) return undefined
  return turn.value.running
}

export function subscribeStatus(listener: (sessionId: string) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 测试用：清空。 */
export function resetStatusStoreForTest(): void {
  entries.clear()
  listeners.clear()
}
