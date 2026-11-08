/**
 * 搜索用的普通会话快照（P2：从 mobile-api.ts 前置搬出）。
 *
 * 一次 `sessions.list` + 一次 `workspace.list`，折叠成「会话 → 工作区 / 工作区标题」
 * 两张表，供 `mobile.search` 给每条命中补上归属。三层缓存策略：
 * - TTL 内直接返回；
 * - 过期但未过陈旧线：**立刻**返回旧值并在后台刷新（失败就吞掉，否则后台
 *   Promise 变成 unhandledRejection 会把宿主进程带走）；
 * - 完全过期：等新值。
 *
 * @module dsh-palm/mobile/api/search-snapshot
 */
import { RpcId } from '../../api-proxy-types.ts'
import { SESSION_LIST_TTL_MS, SESSION_SNAPSHOT_STALE_MS } from './constants.ts'
import { processState } from './process-state.ts'
import type { OrdinarySearchSession, OrdinarySearchSnapshot } from './process-state.ts'

/** 会话/工作区列表里本域用到的最小面。 */
type SnapshotProxy = {
  sessions: { list: (request: never) => Promise<unknown> }
  workspace?: { list: (request: never) => Promise<unknown> }
}

/** 取快照（带缓存与后台刷新）。 */
export async function ordinarySearchSnapshot(apiProxy: unknown): Promise<OrdinarySearchSnapshot> {
  const proxy = apiProxy as never
  const cached = processState.ordinarySearchSnapshotCache
  const fresh = cached !== undefined && cached.proxy === apiProxy && Date.now() - cached.at < SESSION_LIST_TTL_MS
  if (fresh) return cached.value
  const stale = cached !== undefined && cached.proxy === apiProxy && Date.now() - cached.at < SESSION_SNAPSHOT_STALE_MS
  if (stale) {
    processState.ordinarySearchSnapshotRefresh ??= loadOrdinarySearchSnapshot(proxy)
      .catch(() => undefined)
      .finally(() => { processState.ordinarySearchSnapshotRefresh = undefined })
    return cached.value
  }
  const pending = loadOrdinarySearchSnapshot(proxy)
  processState.ordinarySearchSnapshotRefresh = pending.catch(() => undefined).finally(() => { processState.ordinarySearchSnapshotRefresh = undefined })
  return await pending
}

/** 现读一次名册与工作区，折叠成快照。 */
async function loadOrdinarySearchSnapshot(apiProxy: never): Promise<OrdinarySearchSnapshot> {
  const proxy = apiProxy as unknown as SnapshotProxy
  const [sessionResponse, workspaceResponse] = await Promise.all([
    proxy.sessions.list({ rpcId: RpcId('dsh-palm-search-roster'), payload: {} } as never),
    proxy.workspace?.list === undefined ? undefined : proxy.workspace.list({ rpcId: RpcId('dsh-palm-search-workspaces'), payload: {} } as never).catch(() => undefined),
  ])
  const sessionResult = (sessionResponse as { result?: { ok?: boolean; value?: { items?: Array<{ sessionId: string; updatedAt?: number; cwd?: string; origin?: string; projections?: { values?: Record<string, unknown> } }>; hasMore?: boolean } } }).result
  if (sessionResult?.ok !== true) throw new Error('search session classification unavailable')
  const workspaceResult = (workspaceResponse as { result?: { ok?: boolean; value?: { items?: Array<{ workspaceId: string; path?: string; title?: string; sessionIds?: string[] }>; archivedSessionIds?: string[] } } } | undefined)?.result
  const archived = new Set(workspaceResult?.ok === true ? (workspaceResult.value?.archivedSessionIds ?? []).map(String) : [])
  const workspace = new Map<string, string>()
  const workspaceTitle = new Map<string, string>()
  const workspacePaths: Array<{ workspaceId: string; path: string }> = []
  const normalizePath = (value: string): string => value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
  if (workspaceResult?.ok === true) {
    for (const item of workspaceResult.value?.items ?? []) {
      if (typeof item.title === 'string' && item.title !== '') workspaceTitle.set(item.workspaceId, item.title)
      if (typeof item.path === 'string' && item.path !== '') workspacePaths.push({ workspaceId: item.workspaceId, path: normalizePath(item.path) })
      for (const sessionId of item.sessionIds ?? []) workspace.set(String(sessionId), item.workspaceId)
    }
  }
  const sessions: OrdinarySearchSession[] = []
  for (const item of sessionResult.value?.items ?? []) {
    const sessionId = String(item.sessionId)
    // 花名册里没有的（子代理 / 已归档 / 已删除）一律不进快照，和列表口径一致。
    if (item.origin === 'subagent' || archived.has(sessionId)) continue
    const projectedTitle = item.projections?.values?.title
    sessions.push({
      sessionId,
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
      ...(typeof projectedTitle === 'string' && projectedTitle !== '' ? { title: projectedTitle } : {}),
    })
    if (!workspace.has(sessionId) && typeof item.cwd === 'string' && item.cwd !== '') {
      const cwd = normalizePath(item.cwd)
      const owner = workspacePaths
        .filter(entry => cwd === entry.path || cwd.startsWith(`${entry.path}/`))
        .sort((a, b) => b.path.length - a.path.length)[0]
      if (owner !== undefined) workspace.set(sessionId, owner.workspaceId)
    }
  }
  const value: OrdinarySearchSnapshot = {
    sessions,
    byId: new Map(sessions.map(item => [item.sessionId, item])),
    workspace,
    workspaceTitle,
    rosterPartial: sessionResult.value?.hasMore === true,
  }
  processState.ordinarySearchSnapshotCache = { at: Date.now(), proxy: apiProxy, value }
  return value
}
