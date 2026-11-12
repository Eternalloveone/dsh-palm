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
  ownedByWorkspaces,
  parseSessionListCursor,
  sessionListCursor,
  toRosterItems,
  trimSessionListRow,
  visibleSessionRows,
} from '../../host/session-list.ts'
import type { RosterItem } from '../../host/session-list.ts'
import { SESSION_LIST_REFRESH_MIN_MS, SESSION_LIST_TTL_MS, SESSION_PAGE_SIZE } from './constants.ts'
import { computeTurnState } from '../../host/running-evidence.ts'
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
        | {
            archivedSessionIds?: string[]
            items?: Array<{ workspaceId: string; path?: string; sessionIds?: string[] }>
          }
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
      setRosterOwnedCache(ownedByWorkspaces(
        wsValue?.items ?? [],
        toRosterItems(full.result.value.items as RosterItem[]),
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
  // 用 RosterItem 而不是就地写窄类型：行上还有 running / blank / cwd / projections，
  // running 要在下面现场核对。
  let rawItems: RosterItem[]
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
  const ownedCache = rosterOwnedCache()
  const ownedIds = workspaceId === undefined ? undefined : ownedCache?.get(workspaceId)
  /*
   * 2026-11-10「切换不了工作区 / 会话列表显示失效」的宿主侧一半：
   *
   * 原来只有两条路 —— 有归属表就按它过滤，没有就把**全量**发回去。于是归属表
   * （`workspace.list` 的 `sessionIds`）里没有这个工作区时，手机收到的是"所有工作区
   * 的会话"，每个工作区看起来都一样，等于没切；而它在表里是空集时又直接空页。
   *
   * 现在把三种情况分开：归属表整个没有（老宿主 / 枚举失败）→ 不过滤，保持兼容；
   * 归属表存在但没有这个工作区 → 回空页（宁可空，也不能把别的会话塞过来 ——
   * 客户端还会用 `workspace.sessionIds` 再滤一次，见 App.tsx 的 scopedToWorkspace）。
   */
  const unknownWorkspace = workspaceId !== undefined && ownedCache !== undefined && ownedIds === undefined
  if (unknownWorkspace || (workspaceId !== undefined && ownedIds !== undefined && ownedIds.size === 0)) {
    return { type: 'server-response', rpcId, result: { ok: true, value: { items: [], hasMore: false } } }
  }
  const scopedItems = ownedIds === undefined
    ? mainItems
    : mainItems.filter(item => ownedIds.has(String(item.sessionId)))
  // contentKey 必须并入 workspaceId，否则切换工作区会复用到另一条（错误的）序列。
  //
  // 2026-11-11：3395 个会话时这串 key 约 100 KB，旧实现**每一页**都重拼一遍，
  // 翻十页就拼十遍。花名册刷新会换掉 `rawItems` 的数组引用，用它当版本号：
  // 同一份花名册 + 同一工作区 → 直接复用上次的 key。
  const keyCache = processState.sessionListKeyCache
  let contentKey: string
  if (
    keyCache !== undefined
    && keyCache.roster === rawItems
    && keyCache.workspaceId === workspaceId
    && keyCache.owned === ownedIds
  ) {
    contentKey = keyCache.key
  } else {
    contentKey = `${workspaceId ?? ''}|${scopedItems.map(item => `${item.sessionId}:${item.updatedAt}`).join(',')}`
    processState.sessionListKeyCache = { roster: rawItems, workspaceId, owned: ownedIds, key: contentKey }
  }
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
  /*
   * 2026-11-11 用户：「任务都结束了，侧边栏那里还显示进行中」。
   *
   * 花名册是**快照**（枚举一次 6~23 秒，TTL 60 秒 + 刷新节流）：行上的 `running` 是
   * 枚举那一刻的值，收工后最多还要滞留一个 TTL。这里对"快照说是运行中"的行做一次
   * 现场核对 —— 只查这几行（通常 0~1 行），不碰其余行，也不改快照本身。判据直接用
   * `computeTurnState`，与会话页状态条同一套证据规则，避免两处各判一遍互相打架。
   */
  const checkedPage = await correctStaleRunning(page, async (sessionId) => {
    const nowCheck = Date.now()
    const hit = processState.sessionListRunningCache.get(sessionId)
    // 2 秒内的结论复用：翻页/轮询不会对同一行反复读尾页；收工最多晚 2 秒显示。
    // 不拿运行镜像直接短路：镜像本身也可能滞后（断流时 turn/end 丢了），
    // 而这条路径存在的意义就是"花名册说在跑、其实已经收工"时以日志为准。
    if (hit !== undefined && nowCheck - hit.at < 2_000) return hit.running
    const state = await computeTurnState(sessionId)
    if (processState.sessionListRunningCache.size > 128) processState.sessionListRunningCache.clear()
    processState.sessionListRunningCache.set(sessionId, { at: nowCheck, running: state.running === true })
    return state.running === true
  })
  const last = checkedPage[checkedPage.length - 1]
  const nextCursor = last !== undefined && start + checkedPage.length < items.length
    ? sessionListCursor(last.updatedAt, last.sessionId)
    : undefined
  return {
    type: 'server-response',
    rpcId,
    result: {
      ok: true,
      value: {
        items: checkedPage,
        hasMore: nextCursor !== undefined,
        ...(nextCursor !== undefined ? { nextCursor } : {}),
      },
    },
  }
}

/**
 * 快照里说"运行中"的行，逐行现场核对一次。
 *
 * 花名册是 60 秒快照，`running` 是枚举那一刻的值；收工后它会滞留一个 TTL，
 * 侧边栏就一直写着「运行中」。这里只查 `running === true` 的行（通常 0~1 行），
 * 核对结果是"没在跑"才改成 false；核对抛错就保留原值 —— 宁可短暂显示运行中，
 * 也不要把真在跑的说成停了。
 *
 * @param rows - 一页会话行（快照）
 * @param verify - 现场核对：返回这一行此刻是否真的在跑
 * @returns 修正后的行（不修改传入数组）
 */
export async function correctStaleRunning<T extends { sessionId: string; running?: boolean }>(
  rows: readonly T[],
  verify: (sessionId: string) => Promise<boolean>,
): Promise<T[]> {
  return Promise.all(rows.map(async row => {
    if (row.running !== true) return row
    try {
      const live = await verify(String(row.sessionId))
      return live ? row : { ...row, running: false }
    } catch {
      return row
    }
  }))
}
