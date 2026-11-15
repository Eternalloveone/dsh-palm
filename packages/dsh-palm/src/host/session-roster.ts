/**
 * **host · 会话花名册的缓存与落盘**（W5-1：从 `mobile-api.ts` 抽出的第十个域）。
 *
 * 手机一进会话列表就要有内容：宿主这边把上次的会话清单**落盘**一份，进程起来先水合，
 * 于是冷启动不是空的。这份快照有 16 MB 上限（超过就当作没有，宁可慢一次也不读一个
 * 撑爆内存的文件），并且每次刷新都要记下刷新时刻——列表刷新有最小间隔，否则反复进出
 * 页面会把宿主压垮。
 *
 * 状态全部**模块私有**，对外只给访问器：dispatch 原来直接写这几个变量，搬走之后
 * 导入绑定不可赋值（TS2632），而且"谁能改缓存"本来就该只有一处。
 *
 * @module dsh-palm/host/session-roster
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ApiProxy } from '../api-proxy-types'
import type { RosterItem } from './session-list.ts'

/** 会话清单快照的字节上限。 */
export const ROSTER_SNAPSHOT_MAX_BYTES = 16_000_000

/**
 * 会话归属：workspaceId → 该工作区拥有的 sessionId 集合。与 sessionListTtlCache 在
 * 同一次 workspace.list 枚举里一起刷新，因此续页复用旧快照时依然能按工作区过滤。
 */
let sessionListOwnedCache: Map<string, Set<string>> | undefined

/** 落盘花名册快照的文件名（位置由插件的 perfDir 决定，源码里不出现任何本机路径）。 */
let sessionRosterCacheFile: string | undefined

/** 落盘快照只回读一次；读不到就走全量枚举。 */
let sessionRosterHydrated = false

let sessionRosterLastRefreshAt = 0

let sessionListTtlCache: {
  at: number
  proxy: ApiProxy
  rawItems: RosterItem[]
  archivedIds: Set<string>
} | undefined

/** 账本文件路径（未配置就是 undefined）。 */
export function rosterFileOf(): string | undefined {
  return sessionRosterCacheFile
}

/** 设置账本文件路径（启动时由 deps 注入一次）。 */
export function setRosterFile(file: string | undefined): void {
  sessionRosterCacheFile = file
}

/** 是否已经尝试过水合（同一个进程只试一次）。 */
export function isRosterHydrated(): boolean {
  return sessionRosterHydrated
}

/** 记下"已尝试水合"。 */
export function markRosterHydrated(): void {
  sessionRosterHydrated = true
}

/** 上次刷新会话列表的时刻（0 = 还没刷过）。 */
export function rosterLastRefreshAt(): number {
  return sessionRosterLastRefreshAt
}

/** 记下这次刷新时刻。 */
export function markRosterRefreshed(at: number = Date.now()): void {
  sessionRosterLastRefreshAt = at
}

/**
 * 宿主归档应答带回来的全量归档集（比枚举新时优先采用）。
 *
 * 为什么要有：一次全量枚举（`sessions.list` + `workspace.list`）要 6~23 秒，
 * 期间手机完全可以删掉一条会话。删完 `invalidateRosterCaches()` 只把 TTL 缓存清了，
 * **已经在飞的那次枚举**还会照常把结果装回去，而它手里的 `archivedSessionIds` 是
 * 删之前的 —— 刚删掉的会话又被装进快照、还落了盘：手机接下来最多 90 秒（TTL 30s +
 * 刷新节流 60s）都能看到它，重启后还会从落盘快照读回来（2026-11-15 真机）。
 *
 * `workspace.archiveSession` 的应答本身就带全量 `archivedSessionIds`，所以删完当场
 * 就有权威归档集，不必再花一次枚举。装快照时按时间戳二选一（{@link preferArchivedIds}）。
 */
let archivedOverride: { at: number; ids: Set<string> } | undefined

/**
 * 最近一次**可信**的全量归档集：成功枚举读到的，或归档应答带来的。
 *
 * 只为一种退化兜底：`workspace.list` 这次没拿到（超时/失败）时，归档集曾经被当成
 * 空集 —— 那等于"所有归档会话一起回到手机列表"。宁可沿用上一份，也不退回空集。
 */
let lastKnownArchivedIds: Set<string> | undefined

/**
 * 记下宿主刚答复的全量归档集。
 *
 * @param ids - 宿主应答里的全量归档 id
 * @param at - 应答到达时刻（用来和枚举的 `workspace.list` 落地时刻比先后）
 */
export function recordArchivedIds(ids: readonly string[], at: number = Date.now()): void {
  const set = new Set(ids.map(String))
  archivedOverride = { at, ids: set }
  lastKnownArchivedIds = set
}

/**
 * 这次枚举该用哪一份归档集。
 *
 * 判据是**两个时刻**，不是"谁后写谁赢"：
 * - `wsSeenAt` = 这次枚举的 `workspace.list` 落地时刻。那一刻宿主的归档集是什么样，
 *   枚举看到的就是什么样；比它更晚到达的归档应答，枚举一定没看到。
 * - 所以只有 `archivedOverride.at > wsSeenAt` 时才改用应答那份。
 *
 * `wsSeenAt` 为 undefined = 这次没拿到工作区列表（失败/应答不 ok）：退回最近一次
 * 可信的归档集，绝不退回空集（空集会让所有归档会话重新出现在列表里）。
 *
 * @param wsSeenAt - 本次 `workspace.list` 成功落地时刻（拿不到传 undefined）
 * @param enumerated - 枚举读到的归档集（没拿到时是空集）
 * @returns 应当装进快照的归档集
 */
export function preferArchivedIds(wsSeenAt: number | undefined, enumerated: Set<string>): Set<string> {
  if (wsSeenAt === undefined) {
    // 没读到工作区列表：用最近一次可信值，连"更旧"也比空集强。
    return lastKnownArchivedIds === undefined ? enumerated : new Set(lastKnownArchivedIds)
  }
  if (archivedOverride !== undefined && archivedOverride.at > wsSeenAt) {
    lastKnownArchivedIds = archivedOverride.ids
    return new Set(archivedOverride.ids)
  }
  // 应答不比这次枚举新：它已经体现在枚举结果里了，覆盖值用完即弃。
  archivedOverride = undefined
  lastKnownArchivedIds = enumerated
  return enumerated
}

/**
 * 读一次**活**归档集。
 *
 * `workspace.list` 在本进程里是一次缓存读（`WorkspaceListAdapter`），它的归档集由
 * `workspace.follow` 增量维护 —— 桌面或另一台手机删了会话，这里一帧就有。而花名册
 * 快照里那份最多旧 60 秒（TTL 30s + 刷新节流 60s），于是"桌面删掉的会话"要在手机上
 * 滞留一分钟才开始消失。读列表时顺手取活值：比快照新就用它（不必再等一次枚举）。
 *
 * @param apiProxy - 宿主代理
 * @param snapshotAt - 这份快照是什么时候抄的（`rosterTtlCache().at`；落盘水合是 0）
 * @returns 比快照新的归档集；不值得换（还没 baseline / 没变 / 老适配器 / 读失败）时 undefined
 */
export async function readLiveArchivedIds(apiProxy: ApiProxy, snapshotAt: number | undefined): Promise<Set<string> | undefined> {
  try {
    const response = await apiProxy.workspace.list({} as never)
    if (response.result.ok !== true) return undefined
    const value = response.result.value as { archivedSessionIds?: unknown; archivedChangedAt?: unknown }
    const changedAt = value.archivedChangedAt
    // 0/缺省 = 还没收到 baseline（或老适配器）：此刻的归档集不可信，宁可继续用快照。
    if (typeof changedAt !== 'number' || changedAt <= 0) return undefined
    // 快照就是在这之后抄的 ⇒ 它已经包含这次变化。
    if (snapshotAt !== undefined && changedAt <= snapshotAt) return undefined
    if (!Array.isArray(value.archivedSessionIds)) return undefined
    return new Set((value.archivedSessionIds as unknown[]).map(String))
  } catch {
    return undefined
  }
}

/**
 * 归档应答到达后**就地修快照**：换掉归档集、把被归档的行摘掉，不整份作废。
 *
 * 为什么不在写操作后一律作废整份快照（原做法）：作废之后下一次读列表要等一次
 * 冷枚举 —— 实测 6~23 秒（3395 个会话逐行读投影），手机那头就是"删完再开抽屉，
 * 先看到旧行、然后转圈十几秒"。归档应答自带全量归档集，就地摘行就够：
 * 下一次读列表立刻正确，把重枚举留给 TTL 到点后的后台刷新。
 *
 * @param archivedIds - 归档应答里的全量归档 id
 * @returns 有没有可修的快照（false = 还没有快照，调用方走整份作废/冷启动）
 */
export function patchRosterAfterArchive(archivedIds: ReadonlySet<string>): boolean {
  const snapshot = sessionListTtlCache
  if (snapshot === undefined) return false
  const ids = new Set([...archivedIds].map(String))
  sessionListTtlCache = {
    ...snapshot,
    // 归档只改"哪些行可见"，其余行与顺序原样留着。
    rawItems: snapshot.rawItems.filter(row => !ids.has(String(row.sessionId))),
    archivedIds: ids,
  }
  persistSessionRoster()
  return true
}

/** 会话列表 TTL 缓存（读）。 */
export function rosterTtlCache(): typeof sessionListTtlCache {
  return sessionListTtlCache
}

/** 会话列表 TTL 缓存（写；写 undefined 即作废）。 */
export function setRosterTtlCache(value: typeof sessionListTtlCache): void {
  sessionListTtlCache = value
}

/** 工作区归属缓存（读）。 */
export function rosterOwnedCache(): Map<string, Set<string>> | undefined {
  return sessionListOwnedCache
}

/** 工作区归属缓存（写）。 */
export function setRosterOwnedCache(value: Map<string, Set<string>> | undefined): void {
  sessionListOwnedCache = value
}

/**
 * 首帧前把落盘的花名册快照读回内存 —— 这是"跨 DSH 重启也不冷启动"的关键：重启后
 * 第一次 session.list 直接毫秒返回，新鲜度交给随后的后台刷新补。`at: 0` 是刻意的：
 * 让这次返回立刻触发一次后台刷新（标准 SWR）。
 */
export function hydrateSessionRoster(apiProxy: ApiProxy): void {
  if (sessionRosterHydrated) return
  sessionRosterHydrated = true
  const file = sessionRosterCacheFile
  if (file === undefined) return
  try {
    if (statSync(file).size > ROSTER_SNAPSHOT_MAX_BYTES) return
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      rawItems?: RosterItem[]
      archivedIds?: string[]
      owned?: Array<[string, string[]]>
    }
    if (!Array.isArray(parsed.rawItems)) return
    sessionListTtlCache = {
      at: 0,
      proxy: apiProxy,
      rawItems: parsed.rawItems,
      archivedIds: new Set((parsed.archivedIds ?? []).map(String)),
    }
    sessionListOwnedCache = new Map(
      (parsed.owned ?? []).map(([id, ids]) => [String(id), new Set(ids.map(String))] as [string, Set<string>]),
    )
  } catch { /* 没有可用的落盘快照：走全量枚举 */ }
}

/** 把花名册快照落盘（失败静默）。DSH 重启后靠它免掉冷启动那一次 6~30 秒的全量枚举。 */
export function persistSessionRoster(): void {
  const file = sessionRosterCacheFile
  const snapshot = sessionListTtlCache
  if (file === undefined || snapshot === undefined) return
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({
      at: snapshot.at,
      rawItems: snapshot.rawItems,
      archivedIds: [...snapshot.archivedIds],
      owned: [...(sessionListOwnedCache ?? new Map<string, Set<string>>())].map(([id, ids]) => [id, [...ids]]),
    }))
  } catch { /* 落盘失败不影响内存缓存 */ }
}
