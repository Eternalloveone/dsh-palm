// @vitest-environment jsdom
/**
 * errors-report.ts — the automatic error outbox.
 *
 * What matters: a quiet window debounces bursts before anything leaves the
 * device, each distinct failure is sent at most once, nothing is sent when
 * nothing was captured, and a failing sender cannot sabotage the others.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorClear, recordError } from './errors.ts'
import { installErrorReporter } from './errors-report.ts'

beforeEach(() => {
  vi.useFakeTimers()
  errorClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('installErrorReporter', () => {
  it('debounces: a burst collapses into a single flush after the quiet window', () => {
    const sent = vi.fn()
    const stop = installErrorReporter({ send: sent, delayMs: 2000 })
    recordError({ kind: 'error', message: 'a' })
    recordError({ kind: 'rejection', message: 'b' })
    // Nothing before the quiet window closes.
    vi.advanceTimersByTime(1999)
    expect(sent).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(sent).toHaveBeenCalledTimes(2)
    stop()
  })

  it('sends each record at most once, even when it repeats before the flush', () => {
    const sent = vi.fn()
    const stop = installErrorReporter({ send: sent, delayMs: 2000 })
    // Three rapid occurrences of the SAME failure fold into one ring entry;
    // the reporter must hand it over once, carrying the final count.
    recordError({ kind: 'error', message: 'loop' })
    recordError({ kind: 'error', message: 'loop' })
    recordError({ kind: 'error', message: 'loop' })
    vi.advanceTimersByTime(2000)
    expect(sent).toHaveBeenCalledTimes(1)
    const [record] = sent.mock.calls[0] as [{ count: number }]
    expect(record.count).toBe(3)
    stop()
  })

  it('zero requests when nothing is recorded', () => {
    const sent = vi.fn()
    const stop = installErrorReporter({ send: sent, delayMs: 2000 })
    vi.advanceTimersByTime(10_000)
    expect(sent).not.toHaveBeenCalled()
    stop()
  })

  it('a failing send does not stop later records from being sent', () => {
    const sent = vi.fn()
    sent.mockImplementationOnce(() => { throw new Error('network down') })
    const stop = installErrorReporter({ send: sent, delayMs: 2000 })
    recordError({ kind: 'error', message: 'first' })
    recordError({ kind: 'error', message: 'second' })
    vi.advanceTimersByTime(2000)
    expect(sent).toHaveBeenCalledTimes(2)
    const [first, second] = sent.mock.calls.map(call => call[0]) as [{ message: string }, { message: string }]
    expect(first.message).toBe('first')
    expect(second.message).toBe('second')
    stop()
  })

  it('stop() unsubscribes and inactivates the pending timer', () => {
    const sent = vi.fn()
    const stop = installErrorReporter({ send: sent, delayMs: 2000 })
    recordError({ kind: 'error', message: 'one' })
    stop()
    vi.advanceTimersByTime(5000)
    // The timer was cleared on stop, and the receiver was unsubscribed.
    expect(sent).not.toHaveBeenCalled()
  })

  it('一个被拒的异步 send 不会变成 unhandled rejection（否则会被当成新错误再上报）', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    const stop = installErrorReporter({
      send: () => Promise.reject(new Error('错误报告 source 不是 file:line:col')),
      delayMs: 2000,
    })
    try {
      recordError({ kind: 'resource', message: 'img 加载失败', source: 'pic.png:0:0' })
      vi.advanceTimersByTime(2000)
      // 让 node 把「真的没人接」的 rejection 报出来（fake timers 下 nextTick 仍是真时钟）。
      vi.useRealTimers()
      await new Promise(resolve => { setTimeout(resolve, 0) })
      await new Promise(resolve => { setTimeout(resolve, 0) })
      expect(unhandled).toHaveLength(0)
    } finally {
      stop()
      process.off('unhandledRejection', onUnhandled)
    }
  })
})
