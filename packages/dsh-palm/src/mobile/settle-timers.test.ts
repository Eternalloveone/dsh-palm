import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scheduleSettleBurst } from './settle-timers.ts'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('scheduleSettleBurst', () => {
  it('runs every tick when nothing stops the burst', () => {
    const tick = vi.fn((_index: number) => false)
    scheduleSettleBurst([60, 180, 400], tick)
    vi.advanceTimersByTime(500)
    expect(tick).toHaveBeenCalledTimes(3)
    expect(tick.mock.calls.map(call => call[0])).toEqual([0, 1, 2])
  })

  it('stops the remaining ticks when the callback reports done', () => {
    const tick = vi.fn((index: number) => index === 0)
    scheduleSettleBurst([60, 180, 400], tick)
    vi.advanceTimersByTime(1_000)
    expect(tick).toHaveBeenCalledTimes(1)
  })

  it('cancel() clears ticks that have not fired yet', () => {
    const tick = vi.fn(() => false)
    const burst = scheduleSettleBurst([60, 180, 400], tick)
    vi.advanceTimersByTime(100)
    burst.cancel()
    vi.advanceTimersByTime(1_000)
    expect(tick).toHaveBeenCalledTimes(1)
    expect(burst.ran).toBe(1)
  })

  it('treats a throwing tick as done and cancels the rest', () => {
    const tick = vi.fn(() => { throw new Error('boom') })
    scheduleSettleBurst([60, 180], tick)
    vi.advanceTimersByTime(1_000)
    expect(tick).toHaveBeenCalledTimes(1)
  })

  it('cancel is idempotent', () => {
    const burst = scheduleSettleBurst([60], vi.fn(() => false))
    burst.cancel()
    burst.cancel()
    expect(burst.ran).toBe(0)
  })
})
