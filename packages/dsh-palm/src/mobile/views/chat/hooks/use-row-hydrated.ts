/**
 * 行的「结论资格」（水合门）：该会话的行落定 + 本会话宿主快照到齐且新鲜。
 *
 * 以前是渲染期直接 `cachedSnapshot(sessionId)` —— 读的是仓里的可变引用，而
 * "快照晚到"这件事**没有任何 prop 变化会触发重算**：重进会话时先上屏缓存种子、
 * 网络页后到，`hydrated` 就停在 false，状态条一直判 `unknown`，行上的结论也不画。
 *
 * 现在订阅仓里的**快照引用本身**：它只在快照被替换时才换引用，所以既补上了
 * "晚到"这一事件，又不会因为每一帧 live 事件就把整张列表重渲染一遍
 * （版本号会每帧涨，引用不会）。
 */
import { useCallback, useSyncExternalStore } from 'react'
import { taskAuthority } from '../../../session/task-status.ts'
import { cachedSnapshot, subscribeSessionStore } from '../../../stream/session-store.ts'

export function useRowHydrated(sessionId: string, loading: boolean, hostNowMs: number | undefined): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => subscribeSessionStore(changed => { if (changed === sessionId) onChange() }),
    [sessionId],
  )
  const snapshot = useCallback(() => cachedSnapshot(sessionId), [sessionId])
  const cached = useSyncExternalStore(subscribe, snapshot, snapshot)
  return !loading && taskAuthority(cached, hostNowMs ?? Date.now())
}
