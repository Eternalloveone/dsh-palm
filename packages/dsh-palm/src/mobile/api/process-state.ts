/**
 * 进程级可变状态的唯一容器（P2 拆分）。
 *
 * 为什么不是放进 `MobileApiCtx`：ctx 是「一个路由实例一份」，而这些状态必须
 * 「进程一份」——模块级函数与请求分支共用同一个值。
 * 搬进 ctx 会让两处各持一份，表现为「缓存偶尔失效」这类不报错的 bug。
 *
 * 迁移规则：每次只搬一个变量，搬完立刻跑全量测试；
 * `src/mobile/platform/api-state.test.ts` 的基线同步减一。
 *
 * @module dsh-palm/mobile/api/process-state
 */
import type { ApiProxy } from '../../api-proxy-types.ts'
import type { SearchIndexer } from '../../search-indexer.ts'
import type { UsageView } from '../../usage/usage-check.ts'

/** 一条搜索命中的会话（普通搜索路径的中间形状）。 */
export interface OrdinarySearchSession {
  sessionId: string
  updatedAt: number
  title?: string
}

/** 普通搜索的进程内快照。 */
export interface OrdinarySearchSnapshot {
  sessions: OrdinarySearchSession[]
  byId: Map<string, OrdinarySearchSession>
  workspace: Map<string, string>
  workspaceTitle: Map<string, string>
  rosterPartial: boolean
}

/** TTL 缓存的通用形状：记录写入时间与当时的应答。 */
interface TtlResponse {
  at: number
  proxy: ApiProxy
  response: { rpcId: string; result: unknown }
}

export const processState: {
  /** 已完成回合的落盘文件；`deps.perfDir === undefined` 时为 undefined。 */
  finishedRunsFile: string | undefined
  /** 用量视图缓存（进程内共享，避免每次请求都重新算）。 */
  usageCache: { at: number; view: UsageView } | undefined
  /**
   * 用量正在后台刷新。
   *
   * 宿主是单线程：全量查一次用量实测 3.3 s，那段时间所有 `/m/api` 都在排队
   * （用户点会话就"卡一下"）。所以过期后走 stale-while-revalidate —— 先回旧值，
   * 后台刷；这个标记防同一时刻起多个刷新。
   */
  usageRefreshing: boolean
  /** 会话投影快照（seq → 视图块）。 */
  sessionProjectionSnapshots: Map<
    string,
    { at: number; block: { asOfSeq?: number; values?: Record<string, unknown> } }
  >
  /** 「这条会话在哪个工作区」的定位缓存。 */
  locateSessionCache:
    | {
      at: number
      workspace: Map<string, string>
      title: Map<string, string>
      workspaceTitle: Map<string, string>
    }
    | undefined
  /** 普通搜索结果快照缓存。 */
  ordinarySearchSnapshotCache:
    | { at: number; proxy: ApiProxy; value: OrdinarySearchSnapshot }
    | undefined
  /** 会话列表排序结果缓存（key 变化即失效）。 */
  sessionListSortedCache:
    | { key: string; items: Array<{ updatedAt: number; sessionId: string }> }
    | undefined
  /**
   * `session.list` 的 contentKey 记忆。
   *
   * 3395 个会话时 key 是 ~100 KB 的字符串；旧实现每一页都重拼一遍。
   * 花名册刷新会换掉 `roster` 数组引用，用它当版本号即可 O(1) 判「没变」。
   */
  sessionListKeyCache:
    | {
      roster: readonly unknown[]
      workspaceId: string | undefined
      owned: ReadonlySet<string> | undefined
      key: string
    }
    | undefined
  /** 会话列表里「运行中」行的短 TTL 核对缓存（2 秒，见 session-list-handler）。 */
  sessionListRunningCache: Map<string, { at: number; running: boolean }>
  /** workspace.list 的 TTL 缓存。 */
  workspaceListTtlCache: TtlResponse | undefined
  /** agentPreset.list 的 TTL 缓存。 */
  agentPresetTtlCache: TtlResponse | undefined
  /** 搜索索引同步的防抖计时器。 */
  searchSyncTimer: ReturnType<typeof setTimeout> | undefined
  /** 影子模式下已启动的索引器实例。 */
  activeSearchIndexer: SearchIndexer | undefined
  /** 普通搜索结果快照的刷新 promise（并发去重）。 */
  ordinarySearchSnapshotRefresh: Promise<unknown> | undefined
  /** 花名册刷新中的 promise（并发去重）。 */
  sessionRosterInFlight: Promise<{ failure?: unknown }> | undefined
} = {
  finishedRunsFile: undefined,
  usageCache: undefined,
  usageRefreshing: false,
  sessionProjectionSnapshots: new Map(),
  locateSessionCache: undefined,
  ordinarySearchSnapshotCache: undefined,
  sessionListSortedCache: undefined,
  sessionListKeyCache: undefined,
  sessionListRunningCache: new Map(),
  workspaceListTtlCache: undefined,
  agentPresetTtlCache: undefined,
  searchSyncTimer: undefined,
  activeSearchIndexer: undefined,
  ordinarySearchSnapshotRefresh: undefined,
  sessionRosterInFlight: undefined,
}
