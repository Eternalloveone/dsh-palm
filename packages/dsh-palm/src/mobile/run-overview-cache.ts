/**
 * 「运行中」页的**首屏缓存**。
 *
 * 这个页子里所有卡片细节（第几步 / 已跑多久 / 几个子代理）都是进页面之后才去问宿主的，
 * 于是每次进入都是「先空壳、再一条条长出来」—— 真机观感就是「一进来 UI 就乱跳」。
 * 这里把上次稳定下来的样子整份存下来，下次进入**先按它画**，再在后台对齐；
 * 对齐只做增量替换，不清空，于是屏幕上不会出现空档。
 *
 * 只在内存里（模块级）+ localStorage 一份：跨刷新也能秒开。
 * 超过 {@link RUN_OVERVIEW_CACHE_MS} 就作废 —— 过期的"正在跑"比空着更误导。
 *
 * @module dsh-palm/mobile/run-overview-cache
 */

const STORAGE_NAME = 'dsh-palm.run-overview.v1'

/** 缓存最长可用时间：超过就当作没有，宁可空一下也不显示过时状态。 */
export const RUN_OVERVIEW_CACHE_MS = 10 * 60_000

export interface RunOverviewCacheEntry {
  /** 在跑的会话 id。 */
  readonly liveIds: readonly string[]
  /** 会话 id → 标题。 */
  readonly titles: Readonly<Record<string, string>>
  /** 会话 id → 详情（第几步/已跑多久/动作），原样存，读了原样用。 */
  readonly details: Readonly<Record<string, unknown>>
  readonly savedAt: number
}

let memory: RunOverviewCacheEntry | undefined

function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/** 上次稳定下来的样子；过期或没存过就是 undefined。 */
export function cachedRunOverview(now = Date.now()): RunOverviewCacheEntry | undefined {
  if (memory !== undefined && now - memory.savedAt <= RUN_OVERVIEW_CACHE_MS) return memory
  const store = storage()
  if (store === undefined) return undefined
  try {
    const raw = store.getItem(STORAGE_NAME)
    if (raw === null) return undefined
    const parsed = JSON.parse(raw) as Partial<RunOverviewCacheEntry>
    if (typeof parsed.savedAt !== 'number' || now - parsed.savedAt > RUN_OVERVIEW_CACHE_MS) return undefined
    if (!Array.isArray(parsed.liveIds)) return undefined
    const entry: RunOverviewCacheEntry = {
      liveIds: parsed.liveIds.filter((id): id is string => typeof id === 'string'),
      titles: (parsed.titles ?? {}) as Record<string, string>,
      details: (parsed.details ?? {}) as Record<string, unknown>,
      savedAt: parsed.savedAt,
    }
    memory = entry
    return entry
  } catch {
    return undefined
  }
}

/** 记下现在这一屏（节流由调用方控制）。 */
export function rememberRunOverview(entry: Omit<RunOverviewCacheEntry, 'savedAt'>): void {
  const value: RunOverviewCacheEntry = { ...entry, savedAt: Date.now() }
  memory = value
  const store = storage()
  if (store === undefined) return
  try {
    store.setItem(STORAGE_NAME, JSON.stringify(value))
  } catch {
    // 配额满/隐私模式：内存里那份仍然有效，不影响本次会话。
  }
}

/** 测试用：清掉内存与持久化两份。 */
export function resetRunOverviewCacheForTest(): void {
  memory = undefined
  storage()?.removeItem(STORAGE_NAME)
}
