/**
 * 「运行中」页首屏缓存：进页面先按上次的样子画，过期就不要了。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  RUN_OVERVIEW_CACHE_MS,
  cachedRunOverview,
  rememberRunOverview,
  resetRunOverviewCacheForTest,
} from './run-overview-cache.ts'

beforeEach(() => {
  resetRunOverviewCacheForTest()
})

describe('运行中页的首屏缓存', () => {
  it('记下来之后能原样读回（在跑集合/标题/详情三样）', () => {
    rememberRunOverview({
      liveIds: ['s-1', 's-2'],
      titles: { 's-1': '调试搜索零结果', 's-2': '长回合探针' },
      details: { 's-1': { step: 78, elapsedMs: 2_591_000 } },
    })
    const cache = cachedRunOverview()
    expect(cache?.liveIds).toEqual(['s-1', 's-2'])
    expect(cache?.titles['s-1']).toBe('调试搜索零结果')
    expect(cache?.details['s-1']).toEqual({ step: 78, elapsedMs: 2_591_000 })
  })

  it('超过有效期就作废（过期的"正在跑"比空着更误导）', () => {
    rememberRunOverview({ liveIds: ['s-1'], titles: {}, details: {} })
    expect(cachedRunOverview(Date.now() + RUN_OVERVIEW_CACHE_MS + 1)).toBeUndefined()
  })

  it('没存过就是 undefined（第一次进来走原来的空初始态）', () => {
    expect(cachedRunOverview()).toBeUndefined()
  })

  it('存坏了的 JSON 不影响页面启动', () => {
    globalThis.localStorage?.setItem('dsh-palm.run-overview.v1', '{不是 json')
    expect(cachedRunOverview()).toBeUndefined()
  })
})
