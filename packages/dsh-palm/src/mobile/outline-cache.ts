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
 */
const OUTLINE_TTL_MS = 5 * 60 * 1000
const OUTLINE_MAX_ENTRIES = 8

interface OutlineEntry {
  at: number
  turns: unknown
}

const entries = new Map<string, OutlineEntry>()

/** 取一份还没过期的大纲；没有（或过期）返回 undefined。 */
export function getCachedOutline(sessionId: string): unknown | undefined {
  const entry = entries.get(sessionId)
  if (entry === undefined) return undefined
  if (Date.now() - entry.at > OUTLINE_TTL_MS) {
    entries.delete(sessionId)
    return undefined
  }
  return entry.turns
}

/** 记下这次取到的大纲；空值不缓存——宿主那时还没有快照，下次打开应该再问一次。 */
export function setCachedOutline(sessionId: string, turns: unknown): void {
  if (turns === null || turns === undefined) return
  entries.delete(sessionId)
  entries.set(sessionId, { at: Date.now(), turns })
  while (entries.size > OUTLINE_MAX_ENTRIES) {
    const oldest = entries.keys().next()
    if (oldest.done === true) break
    entries.delete(oldest.value)
  }
}

/** 清空（切换会话集合、退出配对、测试之间）。 */
export function clearOutlineCache(): void {
  entries.clear()
}
