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
