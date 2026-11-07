/**
 * 轮次大纲的内存副本。
 *
 * `mobile.turnOutline` 一次给回整个会话的轮次清单——几百轮的会话就是几十 KB。
 * 它在手机上的用途只有一个：让轮次清单能列出"还没加载的那些轮"。用户从列表点进
 * 会话、返回、再点进去，是手机端最常见的动作，每次都重新下载同一份大纲既慢又
 * 浪费流量（弱网下这一趟就是一两秒）。
 *
 * 只留内存、按会话存一份、5 分钟后过期：换设备或重开 App 自然重新取，不会出现
 * "清单里有、宿主已经不认"的陈旧项；条数封顶，长会话来回切也不会把内存撑大。
 *
 * 过期与淘汰由 Cache 内核负责（W4）——这层只管"存什么"。
 */
import { createCache } from './kernels/cache.ts'
import { CACHE_POLICIES } from './kernels/cache-policies.ts'

const entries = createCache<unknown>({
  ttlMs: CACHE_POLICIES.turnOutline.ttlMs,
  maxEntries: CACHE_POLICIES.turnOutline.maxEntries,
})

/** 取一份还没过期的大纲；没有（或过期）返回 undefined。 */
export function getCachedOutline(sessionId: string): unknown | undefined {
  return entries.get(sessionId)
}

/** 记下这次取到的大纲；空值不缓存——宿主那时还没有快照，下次打开应该再问一次。 */
export function setCachedOutline(sessionId: string, turns: unknown): void {
  if (turns === null || turns === undefined) return
  entries.set(sessionId, turns)
}

/** 清空（切换会话集合、退出配对、测试之间）。 */
export function clearOutlineCache(): void {
  entries.clear()
}
