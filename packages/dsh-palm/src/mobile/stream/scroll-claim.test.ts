import { describe, expect, it } from 'vitest'
import { CLAIM_TOLERANCE_PX, CLAIM_WINDOW_MS, isClaimedEcho, type ClaimSnapshot } from './scroll-claim.ts'

const claim = (patch: Partial<ClaimSnapshot> = {}): ClaimSnapshot => ({
  armed: false, value: -1, at: 0, until: 0, ...patch,
})

describe('isClaimedEcho', () => {
  it('认领一次刚写完、值对得上的回声', () => {
    expect(isClaimedEcho(claim({ armed: true, value: 400, at: 1_000 }), 400, 1_000)).toBe(true)
    expect(isClaimedEcho(claim({ armed: true, value: 400, at: 1_000 }), 400 + CLAIM_TOLERANCE_PX, 1_050)).toBe(true)
  })

  it('值差一个像素之外就不认（否则会吃掉读者的下手势）', () => {
    const snapshot = claim({ armed: true, value: 400, at: 1_000 })
    expect(isClaimedEcho(snapshot, 400 + CLAIM_TOLERANCE_PX + 1, 1_000)).toBe(false)
  })

  it('过了窗口就不认（迟到的回声不能被当程序化）', () => {
    const snapshot = claim({ armed: true, value: 400, at: 1_000 })
    expect(isClaimedEcho(snapshot, 400, 1_000 + CLAIM_WINDOW_MS)).toBe(false)
  })

  it('区间认领内不问值：平滑滚动的中间位置一律算自己人', () => {
    const span = claim({ until: 2_000 })
    expect(isClaimedEcho(span, 123, 1_500)).toBe(true)
    expect(isClaimedEcho(span, 456, 1_999)).toBe(true)
  })

  it('区间过期后回到点判据', () => {
    expect(isClaimedEcho(claim({ until: 2_000 }), 123, 2_000)).toBe(false)
  })

  it('未认领时一律不算回声', () => {
    expect(isClaimedEcho(claim(), 400, 1_000)).toBe(false)
  })
})
