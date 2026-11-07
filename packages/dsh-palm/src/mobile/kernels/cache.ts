/**
 * Cache 内核（W4）：**淘汰与过期只写一次**。
 *
 * 现状是每个缓存各写一遍：轮次大纲自己数着 TTL 和条数删、聊天缓存自己算字节、
 * 运行总览自己看时间戳。四份实现，四套边界条件——最典型的是"先 delete 再 set"
 * 这种手工 LRU 手法，谁少写一行就退化成永不过期。
 *
 * 这里只提供两件事：**什么时候算过期**、**满了先淘汰谁**。值怎么序列化、存内存还是
 * localStorage，仍然由各自的模块决定（内核不碰 DOM，也不碰 React）。
 *
 * @module dsh-palm/mobile/kernels/cache
 */

export interface CachePolicy<V = unknown> {
  /** 一条记录最多活多久（毫秒）；不填表示不过期。 */
  ttlMs?: number
  /** 最多留几条；不填表示不限。 */
  maxEntries?: number
  /**
   * 总量最多多少（单位由 {@link sizeOf} 定，通常是字节）。
   *
   * 这是 localStorage 那类存储的真实约束：条数不多但每条很大照样会把配额吃满。
   */
  maxBytes?: number
  /** 怎么量一条记录的大小；给了 `maxBytes` 就必须给。 */
  sizeOf?: (value: V) => number
  /** 注入时钟（测试用，默认 `Date.now`）。 */
  now?: () => number
}

export interface CacheStore<V> {
  /** 取一条；过期会被顺手删掉并返回 undefined。 */
  get(key: string): V | undefined
  /** 有没有（同样认过期）。 */
  has(key: string): boolean
  /** 写一条：同 key 覆盖，并把它的"最近用过"顺序推到最新。 */
  set(key: string, value: V): void
  /** 只删一条。 */
  delete(key: string): void
  clear(): void
  /** 当前条数（不含已过期未清理的——`size()` 会顺手清）。 */
  size(): number
  keys(): string[]
}

interface Entry<V> {
  value: V
  at: number
}

/**
 * 造一个带 TTL 与容量上限的缓存。
 *
 * 淘汰顺序是**插入顺序**（Map 的天然顺序）：`set` 一个已存在的 key 会先删再加，
 * 于是它变成"最新用过"的那条。容量满时淘汰最老的那条。
 */
export function createCache<V>(policy: CachePolicy<V> = {}): CacheStore<V> {
  const ttlMs = policy.ttlMs
  const maxEntries = policy.maxEntries
  const maxBytes = policy.maxBytes
  const sizeOf = policy.sizeOf
  const now = policy.now ?? (() => Date.now())
  const entries = new Map<string, Entry<V>>()

  const expired = (entry: Entry<V>, at: number): boolean =>
    ttlMs !== undefined && at - entry.at > ttlMs

  /** 顺手清掉过期的（`get`/`size`/`keys` 都走它，避免"看起来还有几条"的错觉）。 */
  const sweep = (at: number): void => {
    if (ttlMs === undefined) return
    for (const [key, entry] of entries) {
      if (expired(entry, at)) entries.delete(key)
    }
  }

  return {
    get(key: string): V | undefined {
      const entry = entries.get(key)
      if (entry === undefined) return undefined
      if (expired(entry, now())) {
        entries.delete(key)
        return undefined
      }
      return entry.value
    },
    set(key: string, value: V): void {
      const at = now()
      entries.delete(key)
      entries.set(key, { value, at })
      if (maxEntries !== undefined) {
        while (entries.size > maxEntries) {
          const oldest = entries.keys().next()
          if (oldest.done === true) break
          entries.delete(oldest.value)
        }
      }
      // 字节预算：从最老的开始砍，直到装得下。刚写进来的那条不砍（否则大对象
      // 永远存不进去，调用方还以为缓存生效了）。
      if (maxBytes !== undefined && sizeOf !== undefined) {
        let total = 0
        for (const entry of entries.values()) total += sizeOf(entry.value)
        for (const oldest of [...entries.keys()]) {
          if (total <= maxBytes || oldest === key) break
          const dropped = entries.get(oldest)
          if (dropped !== undefined) total -= sizeOf(dropped.value)
          entries.delete(oldest)
        }
      }
    },
    has(key: string): boolean {
      return this.get(key) !== undefined
    },
    delete(key: string): void {
      entries.delete(key)
    },
    clear(): void {
      entries.clear()
    },
    size(): number {
      sweep(now())
      return entries.size
    },
    keys(): string[] {
      sweep(now())
      return [...entries.keys()]
    },
  }
}
