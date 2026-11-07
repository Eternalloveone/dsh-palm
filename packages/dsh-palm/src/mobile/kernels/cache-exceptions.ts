/**
 * **缓存例外清单**（W4-5 收口）。
 *
 * W4-5 的目标是「11 个各写各的缓存 → 1 个内核」。绝大多数缓存都能表达成
 * `createCache({ ttlMs, maxEntries, maxBytes })`，但有一类不行，必须写清楚为什么，
 * 否则下次有人看到「还有模块没用内核」就当成漏网之鱼去硬改——那会把真机行为改坏。
 *
 * 判定标准：**freshness 来自记录自己的时间戳**（要跨刷新/跨进程存活），而不是"写进来
 * 那一刻"。内核按插入时间计 TTL，表达不了这种语义；硬塞进去等于偷偷改行为。
 *
 * @module dsh-palm/mobile/kernels/cache-exceptions
 */

export interface CacheException {
  /** 模块路径（相对 `src/mobile/`）。 */
  readonly module: string
  /** 它为什么不能直接用内核。 */
  readonly why: string
  /** freshness 从哪儿来（内核按插入时间，这里不行）。 */
  readonly freshnessFrom: string
}

/**
 * 明确不走内核的缓存。**只允许增加，且必须带 why**——测试会检查这里没有过期条目
 * （模块删了、或者后来改成用内核了，条目必须一起删）。
 */
export const CACHE_EXCEPTIONS: readonly CacheException[] = [
  {
    module: 'run-overview-cache.ts',
    why:
      '它存的是一屏**渲染快照**（在跑的会话 id、标题、每张卡片的细节），要跨刷新秒开；' +
      '写入是写穿式的，没有"取数"这回事，内核的 has()/wrap() 语义套不上',
    freshnessFrom: '记录自带的 savedAt（写进 payload，随 localStorage 一起过夜）',
  },
  {
    module: 'history-cache.ts',
    why:
      '落盘在 **IndexedDB**（大页、异步、几十 KB/会话），内核是内存 Map；' +
      '它的 TTL/容量/页版本已经统一读策略表（`CACHE_POLICIES.historyArchive`），' +
      '差的只是存储后端，不是策略',
    freshnessFrom: '页记录自带的 savedAt + 页形状版本号 CACHE_PAGE_VERSION',
  },
]

/** 某模块是否是已登记的例外。 */
export function isCacheException(module: string): boolean {
  return CACHE_EXCEPTIONS.some(entry => entry.module === module)
}
