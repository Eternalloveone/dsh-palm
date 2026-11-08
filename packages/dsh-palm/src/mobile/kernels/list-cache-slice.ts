/**
 * 列表缓存的写穿与冷启动播种（P3：从 SessionListView 抽出的取数逻辑之二）。
 *
 * 列表页有两类缓存：
 * - **名册页**（`sessionListCache`）：内存里按 workspace 存一页；
 * - **行摘要**（`sessionPreviewCache`）：跨挂载存活，聊完回来还在。
 *
 * 两者都要写穿到 localStorage，但方式不同：名册页是**整块重写**，摘要表也是
 * 一整块 blob——所以两处都走"延迟 + 合并"的队列，绝不在产生它们的 fetch/帧
 * 回调里直接落盘（那样一次首屏会触发几十次整块重写）。
 *
 * PWA 冷启动时内存缓存全空，由 `ensureSeeded()` 从持久层回灌一次。
 *
 * @module dsh-palm/mobile/kernels/list-cache-slice
 */

/** 名册页的形状。 */
export interface CachedListPage {
  rows: readonly unknown[]
  cursor?: string
  hasMore: boolean
  /** 持久层会补 v/savedAt 等字段，这里不限制。 */
  [key: string]: unknown
}

/** 切片依赖的持久化与内存缓存。 */
export interface ListCacheDeps {
  /** 内存里的名册页缓存（带 at 时间戳）。 */
  sessionListCache: Map<string, CachedListPage & { at: number }>
  /** 读持久化的行摘要。 */
  loadPersistedPreviews: () => Iterable<[string, string]>
  /** 维护持久层（过期清理等），冷启动跑一次。 */
  maintainPersistedCaches: () => void
  /** 延迟写名册页（整块重写，故合并）。 */
  queuePersistedList: (workspaceId: string, value: CachedListPage) => void
  /** 延迟写摘要表（一整块 blob）。 */
  queuePersistedPreviews: (cache: ReadonlyMap<string, string>) => void
}

/** 列表缓存切片。 */
export interface ListCacheSlice {
  /** 行摘要缓存：跨挂载存活（导出给视图与测试用）。 */
  sessionPreviewCache: Map<string, string>
  /** 冷启动播种一次（幂等）。 */
  ensureSeeded: () => void
  /** 写名单页：内存 + 延迟持久化。 */
  writeList: (workspaceId: string, value: CachedListPage) => void
  /** 把摘要表发布到持久层（延迟 + 合并）。 */
  syncPreviews: () => void
}

/** 建一个列表缓存切片。 */
export function createListCacheSlice(deps: ListCacheDeps): ListCacheSlice {
  const sessionPreviewCache = new Map<string, string>()
  let seeded = false

  const ensureSeeded = (): void => {
    if (seeded) return
    seeded = true
    if (sessionPreviewCache.size === 0) {
      for (const [sessionId, summary] of deps.loadPersistedPreviews()) sessionPreviewCache.set(sessionId, summary)
    }
    deps.maintainPersistedCaches()
  }

  const writeList = (workspaceId: string, value: CachedListPage): void => {
    deps.sessionListCache.set(workspaceId, { ...value, at: Date.now() })
    // 延迟（list-persist）：名册页是整块重写，不能跑在产生它的 fetch/帧上。
    deps.queuePersistedList(workspaceId, value)
  }

  const syncPreviews = (): void => {
    deps.queuePersistedPreviews(sessionPreviewCache)
  }

  return { sessionPreviewCache, ensureSeeded, writeList, syncPreviews }
}
