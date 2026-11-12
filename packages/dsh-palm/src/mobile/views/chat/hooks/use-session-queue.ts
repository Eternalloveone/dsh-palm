/**
 * 队列视图＝会话仓的只读投影（W3-6 第一步）。
 *
 * 以前这份事实有两个所有者：仓里一份（`queueView()`），`ChatView` 的
 * `useState<QueueItemView[]>` 里再抄一份，靠订阅和一堆 `setQueueItems(...)`
 * 手动同步。漏抄一次就是真机上的老毛病："删了还在"、"已发送还挂在排队条"。
 *
 * 现在视图只订阅仓的**变更版本**（`sessionStoreVersion`，稳定的数字），版本变了才
 * 重算 `queueView()`。为什么不直接把 `queueView()` 塞进 `getSnapshot`：它每次调用
 * 都新建数组、判据里还带 `Date.now()`（乐观项 TTL、空队列观察窗），React 会认为
 * 快照永远在变。订阅版本号既满足"快照稳定"，又没有在视图里留下可漂移的副本。
 *
 * 写入仍然全部走仓里已有的动作（`applyQueueItems` / `hideQueueItem` /
 * `addOptimisticQueueItem` / `rebaselineQueueView` …），本 hook 只读。
 *
 * @module dsh-palm/mobile/views/chat/use-session-queue
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import {
  queueView,
  sessionStoreVersion,
  subscribeSessionStore,
} from '../../../stream/session-store.ts'

/**
 * 队列视图的类型取自 `queueView` 的返回值 —— **不 import api.ts**：views 层直接依赖
 * 数据层会撞架构配额（`viewDataImports ≤ 14`），而这里只需要"一条排队项长什么样"。
 */
type QueueItems = ReturnType<typeof queueView>

/** 冷启动回退：仓里还没有这一场的队列时，用 mux 保留的那份（重进会话不空白）。 */
export type QueueFallback = () => QueueItems

/**
 * 订阅一条会话的队列视图。
 *
 * @param sessionId - 当前会话 id（订阅与投影都按它过滤）
 * @param fallback - 仓里为空时的回退来源（可选）
 * @returns 当前该显示的排队项（只读）
 */
export function useSessionQueue(sessionId: string, fallback?: QueueFallback): QueueItems {
  const subscribe = useCallback(
    (onChange: () => void) => subscribeSessionStore(changed => { if (changed === sessionId) onChange() }),
    [sessionId],
  )
  const snapshot = useCallback(() => sessionStoreVersion(sessionId), [sessionId])
  const version = useSyncExternalStore(subscribe, snapshot, snapshot)

  return useMemo(() => {
    const items = queueView(sessionId)
    if (items.length > 0 || fallback === undefined) return items
    const seeded = fallback()
    return seeded.length > 0 ? seeded : items
  }, [sessionId, version, fallback])
}
