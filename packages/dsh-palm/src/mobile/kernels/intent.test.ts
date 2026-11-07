/**
 * Intent 内核的契约（W3-6）：**重复投递 0**。
 *
 * 每条用例对应一类真实故障：连点两下、在途期间换文案再点、换会话发同样的字、
 * 被拒的尝试不许刷新窗口。
 */
import { describe, expect, it } from 'vitest'
import { createSubmitLedger, SUBMIT_DEDUPE_MS, SUBMIT_INFLIGHT_MS } from './intent.ts'

/** 可控时钟。 */
function clock(start = 1_700_000_000_000) {
  let value = start
  return {
    now: () => value,
    advance: (ms: number) => { value += ms },
  }
}

describe('createSubmitLedger', () => {
  it('第一次提交放行', () => {
    const ledger = createSubmitLedger({ now: clock().now })
    expect(ledger.attempt('s1', '你好')).toBe('accept')
  })

  it('在途期间的任何提交都拒（连点两下只发一条）', () => {
    const time = clock()
    const ledger = createSubmitLedger({ now: time.now })
    expect(ledger.attempt('s1', '你好')).toBe('accept')
    expect(ledger.attempt('s1', '你好')).toBe('inflight')
    expect(ledger.attempt('s1', '换了文案也一样')).toBe('inflight')
  })

  it('落定之后可以再发（同一段正文，但已过在途窗口）', () => {
    const time = clock()
    const ledger = createSubmitLedger({ now: time.now })
    expect(ledger.attempt('s1', '你好')).toBe('accept')
    ledger.settle()
    time.advance(SUBMIT_DEDUPE_MS + 1)
    expect(ledger.attempt('s1', '你好')).toBe('accept')
  })

  it('在途窗口过期后放行（网络卡住不会永久锁死发送）', () => {
    const time = clock()
    const ledger = createSubmitLedger({ now: time.now })
    expect(ledger.attempt('s1', '你好')).toBe('accept')
    time.advance(SUBMIT_INFLIGHT_MS + 1)
    expect(ledger.attempt('s1', '再来一条')).toBe('accept')
  })

  it('同会话同正文 1.5 秒内算同一次意图（在途已解除，但去重窗口还在）', () => {
    const time = clock()
    const ledger = createSubmitLedger({ now: time.now })
    expect(ledger.attempt('s1', '你好')).toBe('accept')
    ledger.settle()                       // 请求已落定
    time.advance(500)                      // 但用户又点了一下
    expect(ledger.attempt('s1', '你好')).toBe('duplicate')
    time.advance(SUBMIT_DEDUPE_MS)
    expect(ledger.attempt('s1', '你好')).toBe('accept')
  })

  it('换会话发同样的字不算重复（作用域键隔离）', () => {
    const time = clock()
    const ledger = createSubmitLedger({ now: time.now })
    expect(ledger.attempt('s1', '你好')).toBe('accept')
    ledger.settle()
    time.advance(10)
    expect(ledger.attempt('s2', '你好')).toBe('accept')
  })

  it('只有附件（空正文）不参与去重判据', () => {
    const time = clock()
    const ledger = createSubmitLedger({ now: time.now })
    expect(ledger.attempt('s1', '')).toBe('accept')
    ledger.settle()
    time.advance(10)
    // 两次带图发送是两次独立意图：正文都是空串，不能当成"同一段文字"。
    expect(ledger.attempt('s1', '')).toBe('accept')
  })

  it('被拒的尝试不刷新窗口（连点不会把封锁越推越远）', () => {
    const time = clock()
    const ledger = createSubmitLedger({ now: time.now })
    expect(ledger.attempt('s1', '甲')).toBe('accept')
    time.advance(SUBMIT_INFLIGHT_MS - 10)
    expect(ledger.attempt('s1', '乙')).toBe('inflight')   // 被拒
    time.advance(20)                                       // 越过原窗口
    expect(ledger.attempt('s1', '乙')).toBe('accept')       // 不会因为刚才那次被拒而继续锁
  })

  it('reset 清空一切（换会话/登出）', () => {
    const time = clock()
    const ledger = createSubmitLedger({ now: time.now })
    expect(ledger.attempt('s1', '你好')).toBe('accept')
    ledger.reset()
    expect(ledger.attempt('s1', '你好')).toBe('accept')
  })
})
