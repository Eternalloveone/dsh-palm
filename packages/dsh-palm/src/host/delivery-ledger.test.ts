/**
 * 投递账本：宿主受理过的 requestId，是送达判断里唯一不是推断的证据。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { DELIVERY_LEDGER_MAX, DELIVERY_LEDGER_TTL_MS, rememberAccepted, resetDeliveryLedger, wasAccepted } from './delivery-ledger.ts'

afterEach(() => { resetDeliveryLedger() })

describe('delivery ledger', () => {
  it('记过的能查到，没记过的查不到', () => {
    rememberAccepted('s1', 'req-1')
    expect(wasAccepted('s1', 'req-1')).toBe(true)
    expect(wasAccepted('s1', 'req-2')).toBe(false)
    expect(wasAccepted('s2', 'req-1')).toBe(false)
  })

  it('同一 requestId 在不同会话之间不会串（key 带 sessionId）', () => {
    rememberAccepted('s1', 'req-1')
    expect(wasAccepted('s2', 'req-1')).toBe(false)
  })

  it('空 id 不记（避免把 undefined 变成"受理过"）', () => {
    rememberAccepted('', 'req-1')
    rememberAccepted('s1', '')
    expect(wasAccepted('', 'req-1')).toBe(false)
    expect(wasAccepted('s1', '')).toBe(false)
  })

  it('过期之后不再回答"受理过"', () => {
    rememberAccepted('s1', 'req-1', 1_000)
    expect(wasAccepted('s1', 'req-1', 1_000 + DELIVERY_LEDGER_TTL_MS - 1)).toBe(true)
    expect(wasAccepted('s1', 'req-1', 1_000 + DELIVERY_LEDGER_TTL_MS + 1)).toBe(false)
  })

  it('超过上限时淘汰最旧的，不会无限长', () => {
    for (let i = 0; i < DELIVERY_LEDGER_MAX + 5; i += 1) rememberAccepted('s1', `req-${i}`)
    expect(wasAccepted('s1', 'req-0')).toBe(false)
    expect(wasAccepted('s1', `req-${DELIVERY_LEDGER_MAX + 4}`)).toBe(true)
  })
})
