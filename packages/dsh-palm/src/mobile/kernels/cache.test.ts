/**
 * Cache 内核的契约（W4）：过期与淘汰的边界条件。
 *
 * 这些边界以前散在四个缓存模块里，各写一遍；任何一条写错都表现为"数据一直在"或
 * "刚存进去就没了"，而且都不报错。
 */
import { describe, expect, it } from 'vitest'
import { createCache, fitByteBudget } from './cache.ts'

/** 可控时钟。 */
function clock(start = 1_700_000_000_000) {
  let value = start
  return { now: () => value, advance: (ms: number) => { value += ms } }
}

describe('createCache · TTL', () => {
  it('没过期就取得到', () => {
    const time = clock()
    const cache = createCache<string>({ ttlMs: 1_000, now: time.now })
    cache.set('a', '甲')
    time.advance(999)
    expect(cache.get('a')).toBe('甲')
  })

  it('过期后取不到，并被顺手删掉（不是留着占容量）', () => {
    const time = clock()
    const cache = createCache<string>({ ttlMs: 1_000, now: time.now })
    cache.set('a', '甲')
    time.advance(1_001)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.size()).toBe(0)
  })

  it('不填 ttlMs 就永不过期', () => {
    const time = clock()
    const cache = createCache<string>({ now: time.now })
    cache.set('a', '甲')
    time.advance(10 * 365 * 24 * 3600_000)
    expect(cache.get('a')).toBe('甲')
  })

  it('size()/keys() 不会把过期项算进去', () => {
    const time = clock()
    const cache = createCache<string>({ ttlMs: 1_000, now: time.now })
    cache.set('a', '甲')
    cache.set('b', '乙')
    time.advance(500)
    cache.set('b', '乙2')            // b 重新计时
    time.advance(600)                // a 已过期，b 还没
    expect(cache.size()).toBe(1)
    expect(cache.keys()).toEqual(['b'])
  })
})

describe('createCache · 容量', () => {
  it('满了淘汰最老的（插入顺序）', () => {
    const time = clock()
    const cache = createCache<string>({ maxEntries: 2, now: time.now })
    cache.set('a', '甲')
    time.advance(1)
    cache.set('b', '乙')
    time.advance(1)
    cache.set('c', '丙')
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe('乙')
    expect(cache.get('c')).toBe('丙')
  })

  it('重写一个已有的 key 会让它变成最新（不会被下一个挤掉）', () => {
    const time = clock()
    const cache = createCache<string>({ maxEntries: 2, now: time.now })
    cache.set('a', '甲')
    time.advance(1)
    cache.set('b', '乙')
    time.advance(1)
    cache.set('a', '甲2')            // a 变成最新
    time.advance(1)
    cache.set('c', '丙')             // 该淘汰 b 而不是 a
    expect(cache.get('a')).toBe('甲2')
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe('丙')
  })

  it('不填 maxEntries 就不限条数', () => {
    const cache = createCache<number>({ now: clock().now })
    for (let i = 0; i < 500; i += 1) cache.set(`k${i}`, i)
    expect(cache.size()).toBe(500)
  })
})

describe('createCache · 基本操作', () => {
  it('delete / clear', () => {
    const cache = createCache<string>({ now: clock().now })
    cache.set('a', '甲')
    cache.set('b', '乙')
    cache.delete('a')
    expect(cache.get('a')).toBeUndefined()
    cache.clear()
    expect(cache.size()).toBe(0)
  })

  it('没存过的 key 取不到（不抛）', () => {
    const cache = createCache<string>({ now: clock().now })
    expect(cache.get('never')).toBeUndefined()
  })

  it('undefined 作为值也能被区分出来（靠 has 语义看 keys）', () => {
    const cache = createCache<string | undefined>({ now: clock().now })
    cache.set('a', undefined)
    expect(cache.keys()).toEqual(['a'])
    expect(cache.get('a')).toBeUndefined()
  })
})

describe('createCache · 字节预算', () => {
  it('总量超上限时从最老的开始砍', () => {
    const time = clock()
    const cache = createCache<string>({ maxBytes: 100, sizeOf: v => v.length, now: time.now })
    cache.set('a', 'x'.repeat(40))
    time.advance(1)
    cache.set('b', 'y'.repeat(40))
    time.advance(1)
    cache.set('c', 'z'.repeat(40))          // 120 > 100，砍掉最老的 a
    expect(cache.has('a')).toBe(false)
    expect(cache.has('b')).toBe(true)
    expect(cache.has('c')).toBe(true)
  })

  it('刚写进来的那条不会被自己砍掉（大对象也要能存住）', () => {
    const cache = createCache<string>({ maxBytes: 10, sizeOf: v => v.length, now: clock().now })
    cache.set('big', 'x'.repeat(50))
    expect(cache.has('big')).toBe(true)
  })

  it('只给 maxBytes 不给 sizeOf 时不参与淘汰', () => {
    const cache = createCache<string>({ maxBytes: 1, now: clock().now })
    cache.set('a', 'x'.repeat(50))
    expect(cache.has('a')).toBe(true)
  })
})

describe('createCache · has', () => {
  it('认过期：过期的 has 是 false', () => {
    const time = clock()
    const cache = createCache<string>({ ttlMs: 100, now: time.now })
    cache.set('a', '甲')
    expect(cache.has('a')).toBe(true)
    time.advance(101)
    expect(cache.has('a')).toBe(false)
  })
})

describe('fitByteBudget', () => {
  /** 每条 10 个字符，编码后 JSON 长度可预估。 */
  const encode = (items: readonly string[]): string => JSON.stringify(items)

  it('装得下就原样返回（不裁）', () => {
    const items = ['a', 'b']
    expect(fitByteBudget(items, encode, 1_000)).toEqual(items)
  })

  it('装不下就从最老的（头部）开始丢，保尾部', () => {
    const items = Array.from({ length: 50 }, (_, i) => `row-${i}`)
    const kept = fitByteBudget(items, encode, 200)
    expect(kept).toBeDefined()
    expect(kept!.length).toBeLessThan(items.length)
    // 最后一条必须还在（缓存存的是"最近的一屏"）
    expect(kept![kept!.length - 1]).toBe('row-49')
    expect(encode(kept!).length).toBeLessThanOrEqual(200)
  })

  it('连最小条数都装不下时返回 undefined（宁可整个放弃，不存残缺的）', () => {
    const items = ['x'.repeat(100), 'y'.repeat(100)]
    expect(fitByteBudget(items, encode, 10, 2)).toBeUndefined()
  })

  it('下限之内能装下就返回下限条数', () => {
    const items = Array.from({ length: 30 }, (_, i) => `r${i}`)
    const kept = fitByteBudget(items, encode, 60, 4)
    expect(kept).toBeDefined()
    expect(encode(kept!).length).toBeLessThanOrEqual(60)
    expect(kept!.length).toBeGreaterThanOrEqual(4)
  })

  it('空数组永远装得下', () => {
    expect(fitByteBudget([], encode, 0)).toEqual([])
  })
})
