/**
 * `session.list` 的实现与花名册刷新（P2：整方法外移）。
 *
 * 这里是手机端最热的一次调用，注释里记着真机埋点的代价：
 * - 枚举一次要 6~23 秒（3395 个会话，宿主侧逐行读投影）；
 * - 旧策略"首屏永远强制新鲜"⇒ 每次进入列表都付一次全量枚举，12 秒看门狗必然误报超时。
 *
 * 现在的策略是 SWR：有快照就毫秒级返回 + 后台刷新；没快照才等一次。
 * 续页一律复用同一快照，保证同一稳定切面，翻页不会漏行/重行。
 *
 * @module dsh-palm/mobile/api/session-list-handler
 */
import type { ApiProxy } from '../../api-proxy-types.ts'
import {
  hydrateSessionRoster,
  markRosterRefreshed,
  persistSessionRoster,
  rosterLastRefreshAt,
  rosterOwnedCache,
  rosterTtlCache,
  setRosterOwnedCache,
  setRosterTtlCache,
} from '../../host/session-roster.ts'
import {
  afterCursor,
  parseSessionListCursor,
  sessionListCursor,
  toRosterItems,
  trimSessionListRow,
  visibleSessionRows,
} from '../../host/session-list.ts'
import type { RosterItem } from '../../host/session-list.ts'
import { SESSION_LIST_REFRESH_MIN_MS, SESSION_LIST_TTL_MS, SESSION_PAGE_SIZE } from './constants.ts'
import { processState } from './process-state.ts'

/** session.list 需要的上下文。 */
export interface SessionListContext {
  apiProxy: ApiProxy
  rpcId: string
  request: unknown
  payload?: unknown
}

/** 一次枚举：会话全量 + 工作区归属，写进 TTL 缓存与快照。 */
function refreshSessionRoster(apiProxy: ApiProxy, request: unknown): Promise<{ failure?: unknown }> {
  const existing = processState.sessionRosterInFlight
  if (existing !== undefined) return existing
  markRosterRefreshed()
  const run = (async (): Promise<{ failure?: unknown }> => {
    try {
      const [full, wsList] = await Promise.all([
        apiProxy.sessions.list(request as never),
        apiProxy.workspace.list(request as never).catch(() => undefined),
      ])
      if (!full.result.ok) return { failure: full.result }
      const wsValue = (wsList?.result.ok === true ? wsList.result.value : undefined) as
        | { archivedSessionIds?: string[]; items?: Array<{ workspaceId: string; sessionIds?: string[] }> }
        | undefined
      // 顺手留下每行的投影（枚举结果本来就带），尾页读取查表即得，不用为此再枚举一次。
      // 整体替换而不是合并：删掉的会话不该在表里留下投影。
      const items = full.result.value.items as Array<{
        sessionId?: unknown
        projections?: { asOfSeq?: number; values?: Record<string, unknown> }
      }>
      const enumeratedAt = Date.now()
      const snapshots = new Map<string, { at: number; block: { asOfSeq?: number; values?: Record<string, unknown> } }>()
      for (const item of items) {
        if (typeof item.sessionId === 'string' && item.projections !== undefined) {
          snapshots.set(item.sessionId, { at: enumeratedAt, block: item.projections })
        }
      }
      processState.sessionProjectionSnapshots = snapshots
      setRosterTtlCache({
        at: Date.now(),
        proxy: apiProxy,
        rawItems: toRosterItems(full.result.value.items as RosterItem[]),
        archivedIds: new Set((wsValue?.archivedSessionIds ?? []).map(id => String(id))),
      })
      setRosterOwnedCache(new Map(
        (wsValue?.items ?? []).map(item => [
          String(item.workspaceId),
          new Set((item.sessionIds ?? []).map(id => String(id))),
        ]),
      ))
      persistSessionRoster()
      return {}
    } catch {
      return {}
    } finally {
      processState.sessionRosterInFlight = undefined
    }
  })()
  processState.sessionRosterInFlight = run
  return run
}

/**
 * 列会话：稳定切面 + 游标分页 + 工作区归属过滤。
 *
 * 三条不变量：
 * - 子代理会话与已归档会话永不出现在手机端；
 * - 同一 contentKey 下排序结果缓存复用，翻页不重排；
 * - 工作区过滤为空时显式收尾，不能变成"永远有下一页的空页"。
 */
export async function sessionList(ctx: SessionListContext): Promise<unknown> {
  const { apiProxy, payload, rpcId, request } = ctx
  const cursor = (payload as { cursor?: string } | undefined)?.cursor
  const workspaceId = (payload as { workspaceId?: string } | undefined)?.workspaceId
  const now = Date.now()
  // 重启后的第一次调用：先把落盘快照读回内存，首帧就不必等全量枚举。
  hydrateSessionRoster(apiProxy)
  const ttl = rosterTtlCache()
  const needRefresh = ttl !== undefined
    && (ttl.proxy !== apiProxy || now - ttl.at >= SESSION_LIST_TTL_MS)
    // 刷新节流：枚举要 6~30 秒，刷太勤会把宿主 CPU 占住、连带拖慢其他界面。
    && now - rosterLastRefreshAt() >= SESSION_LIST_REFRESH_MIN_MS
  let rawItems: Array<{ updatedAt: number; sessionId: string; origin?: 'subagent' }>
  let archivedIds: Set<string>
  if (ttl !== undefined) {
    rawItems = ttl.rawItems
    archivedIds = ttl.archivedIds
    if (needRefresh) refreshSessionRoster(apiProxy, request)
  } else {
    const { failure } = await refreshSessionRoster(apiProxy, request)
    // 错误路径也要套 server-response 外壳，否则手机端会当成传输层故障。
    if (failure !== undefined) return { type: 'server-response' as const, rpcId, result: failure }
    const snapshot = rosterTtlCache()
    if (snapshot === undefined) {
      // 枚举异常且没有任何旧快照：给空页，别把传输层错误抛给手机端。
      return { type: 'server-response', rpcId, result: { ok: true, value: { items: [], hasMore: false } } }
    }
    rawItems = snapshot.rawItems
    archivedIds = snapshot.archivedIds
  }
  const mainItems = visibleSessionRows(rawItems, archivedIds)
  const ownedIds = workspaceId === undefined ? undefined : rosterOwnedCache()?.get(workspaceId)
  if (workspaceId !== undefined && ownedIds !== undefined && ownedIds.size === 0) {
    return { type: 'server-response', rpcId, result: { ok: true, value: { items: [], hasMore: false } } }
  }
  const scopedItems = ownedIds === undefined
    ? mainItems
    : mainItems.filter(item => ownedIds.has(String(item.sessionId)))
  // contentKey 必须并入 workspaceId，否则切换工作区会复用到另一条（错误的）序列。
  const contentKey = `${workspaceId ?? ''}|${scopedItems.map(item => `${item.sessionId}:${item.updatedAt}`).join(',')}`
  let items = scopedItems
  if (processState.sessionListSortedCache?.key !== contentKey) {
    scopedItems.sort((a, b) => b.updatedAt - a.updatedAt
      || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0))
    processState.sessionListSortedCache = { key: contentKey, items: scopedItems }
    items = scopedItems
  } else {
    items = processState.sessionListSortedCache.items
  }
  const position = cursor === undefined ? undefined : parseSessionListCursor(cursor)
  const from = position === undefined ? 0 : items.findIndex(row => afterCursor(row, position))
  const start = from < 0 ? items.length : from
  const page = items.slice(start, start + SESSION_PAGE_SIZE).map(trimSessionListRow)
  const last = page[page.length - 1]
  const nextCursor = last !== undefined && start + page.length < items.length
    ? sessionListCursor(last.updatedAt, last.sessionId)
    : undefined
  return {
    type: 'server-response',
    rpcId,
    result: {
      ok: true,
      value: {
        items: page,
        hasMore: nextCursor !== undefined,
        ...(nextCursor !== undefined ? { nextCursor } : {}),
      },
    },
  }
}
