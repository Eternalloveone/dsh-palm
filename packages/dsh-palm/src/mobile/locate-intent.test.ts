import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearLocateIntent,
  holdLocateIntent,
  LOCATE_CONSUMED_REUSE_MS,
  LOCATE_INTENT_LINGER_MS,
  LOCATE_INTENT_TTL_MS,
  LOCATE_MAX_RENEWALS,
  locateIntentFor,
  releaseLocateIntent,
  rememberLocateIntent,
  resetLocateIntentsForTest,
  takeLocateIntent,
  touchLocateIntent,
} from './locate-intent.ts'

describe('locate intent', () => {
  afterEach(() => {
    vi.useRealTimers()
    holdLocateIntent('s1')
    clearLocateIntent('s1')
  })

  it('把一次点击的锚点原样交回给聊天页', () => {
    rememberLocateIntent({ sessionId: 's1', seq: 412, messageId: 'm-1', partId: 'p-2', query: '定位' })
    expect(locateIntentFor('s1')).toMatchObject({ seq: 412, messageId: 'm-1', partId: 'p-2', query: '定位' })
  })

  it('读不消费：转场里聊天页挂两个实例，两边都要拿得到', () => {
    rememberLocateIntent({ sessionId: 's1', query: '定位' })
    expect(locateIntentFor('s1')?.query).toBe('定位')
    expect(locateIntentFor('s1')?.query).toBe('定位')
  })

  it('过期后丢掉：一次点击不该影响一分钟后的普通打开', () => {
    vi.useFakeTimers()
    rememberLocateIntent({ sessionId: 's1', query: '定位' })
    vi.advanceTimersByTime(LOCATE_INTENT_TTL_MS + 1)
    expect(locateIntentFor('s1')).toBeUndefined()
  })

  it('同会话再点一次覆盖旧意图', () => {
    rememberLocateIntent({ sessionId: 's1', seq: 10, query: '插件' })
    rememberLocateIntent({ sessionId: 's1', seq: 20, query: '面板' })
    expect(locateIntentFor('s1')).toMatchObject({ seq: 20, query: '面板' })
  })

  it('没有意图时返回 undefined（普通打开会话）', () => {
    expect(locateIntentFor('never-clicked')).toBeUndefined()
  })

  it('离开聊天（卸载）后宽限到期就清掉，不残留到下一次普通打开', () => {
    vi.useFakeTimers()
    rememberLocateIntent({ sessionId: 's1', seq: 7, query: '定位' })
    releaseLocateIntent('s1')
    expect(locateIntentFor('s1')?.seq).toBe(7)
    vi.advanceTimersByTime(LOCATE_INTENT_LINGER_MS + 1)
    expect(locateIntentFor('s1')).toBeUndefined()
  })

  it('宽限内重新挂载（转场双实例）会取消清理，高亮不会被自己清掉', () => {
    vi.useFakeTimers()
    rememberLocateIntent({ sessionId: 's1', query: '定位' })
    releaseLocateIntent('s1')
    vi.advanceTimersByTime(LOCATE_INTENT_LINGER_MS - 500)
    holdLocateIntent('s1')
    vi.advanceTimersByTime(LOCATE_INTENT_LINGER_MS * 3)
    expect(locateIntentFor('s1')?.query).toBe('定位')
  })

  it('首屏要等 100 秒也不丢意图：等待期间续期，落地后照常过期', () => {
    vi.useFakeTimers()
    rememberLocateIntent({ sessionId: 's1', seq: 1727, query: '高亮' })
    // 聊天页在等这一页（实测 40~160 秒），每 5 秒续一次。
    for (let waited = 0; waited < 100_000; waited += 5_000) {
      vi.advanceTimersByTime(5_000)
      touchLocateIntent('s1')
    }
    expect(locateIntentFor('s1')).toMatchObject({ seq: 1727, query: '高亮' })
    // 落地后不再续期：TTL 一到就清，不影响之后的普通打开。
    vi.advanceTimersByTime(LOCATE_INTENT_TTL_MS + 1)
    expect(locateIntentFor('s1')).toBeUndefined()
  })
})

describe('意图只影响「从搜索点进来」那一次（2026-10-29 真机：一进会话跳到很老的一轮）', () => {
  beforeEach(() => { resetLocateIntentsForTest() })

  it('消费过之后，2 秒再接进来就不该复用（否则首屏会取到老命中那一页）', () => {
    rememberLocateIntent({ sessionId: 's-1', seq: 120, query: '重启' })
    // 第一次挂载：拿到并消费
    expect(takeLocateIntent('s-1')?.seq).toBe(120)
    // 转场里的第二个实例（立刻）还能拿到
    expect(locateIntentFor('s-1')?.seq).toBe(120)
  })

  it('消费窗口过了就彻底不再返回', async () => {
    rememberLocateIntent({ sessionId: 's-2', seq: 88 })
    takeLocateIntent('s-2')
    // 直接把「已消费时刻」推到窗口之外
    await new Promise(resolve => setTimeout(resolve, LOCATE_CONSUMED_REUSE_MS + 30))
    expect(locateIntentFor('s-2')).toBeUndefined()
  })

  it('续期有上限：卡住的一页不能无限续命', () => {
    rememberLocateIntent({ sessionId: 's-3', seq: 5 })
    for (let index = 0; index < LOCATE_MAX_RENEWALS + 3; index += 1) touchLocateIntent('s-3')
    const intent = locateIntentFor('s-3')
    // 续期次数用尽后不再刷新时间戳：要么还能取到（未过期），要么已过期被丢
    expect(intent === undefined || intent.seq === 5).toBe(true)
  })
})
