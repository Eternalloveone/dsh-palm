// @vitest-environment jsdom
/**
 * 终态锁定（`useTurnState` 的 `applyTurnVerdict`）—— 真机回归：
 *
 * 1. 收工后迟到的「同一轮在跑」不许把它点回来（done→running 的入口之一）；
 * 2. 「宿主说在跑」若是**新的一轮**（轮号更大 / 起点更晚）必须采纳 —— 2026-11-09
 *    真机实测：拿本机 Date.now() 跟宿主的 turnStartAt 比，把真在跑的会话挡成了
 *    「已完成」；
 * 3. 没有轮号也没有起点的时间戳（花名册回放）不许复活已收工的回合；
 * 4. 换会话时台账归零（上一场的收工不能挡住这一场）。
 *
 * 全部走 hook 的真实入口，不看内部实现。
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { StreamState, UseTurnStateOptions } from '../state/stream-state.ts'
import { useTurnState } from './use-turn-state.ts'

const stream: StreamState = {
  liveBuffer: [],
  liveBufferOverflow: false,
  dropWindow: undefined,
  autoExtended: false,
  openChainPages: 0,
  folder: undefined,
  loadedPage: false,
  tailLoading: false,
  eventBatch: [],
}

const options: UseTurnStateOptions = {
  sessionId: 's1',
  stream,
  messages: [],
  refreshInboxRef: { current: () => undefined },
  normalizeTurnEndTodo: () => undefined,
  foreground: true,
  reloadTailRef: { current: () => undefined },
}

const run = () => renderHook(() => useTurnState(options))

describe('applyTurnVerdict：终态锁定按宿主时钟判新旧', () => {
  it('收工后迟到的「同一轮在跑」(无轮号无起点) 被丢弃', () => {
    const { result } = run()
    act(() => result.current.resetTurnState(true))
    act(() => result.current.applyTurnVerdict({ running: true, turn: 367, startAt: 1_000 }))
    expect(result.current.running).toBe(true)
    // turn/end：轮号 + 宿主收工时刻。
    act(() => result.current.applyTurnVerdict({ running: false, turn: 367, at: 5_000 }))
    expect(result.current.running).toBe(false)
    // 回放式的「在跑」：既没有轮号也没有起点 —— 不许复活。
    act(() => result.current.applyTurnVerdict({ running: true }))
    expect(result.current.running).toBe(false)
  })

  it('同一轮的 turn/start 回放（轮号更旧或相同）被丢弃', () => {
    const { result } = run()
    act(() => result.current.resetTurnState(false))
    act(() => result.current.applyTurnVerdict({ running: false, turn: 367, at: 5_000 }))
    act(() => result.current.applyTurnVerdict({ running: true, turn: 367, startAt: 1_000 }))
    expect(result.current.running).toBe(false)
    act(() => result.current.applyTurnVerdict({ running: true, turn: 300, startAt: 900 }))
    expect(result.current.running).toBe(false)
  })

  it('真在跑的新一轮必须采纳：起点比收工时刻新（宿主时钟同域）', () => {
    const { result } = run()
    act(() => result.current.resetTurnState(false))
    act(() => result.current.applyTurnVerdict({ running: false, turn: 366, at: 1_700_000_000_000 }))
    act(() => result.current.applyTurnVerdict({ running: true, startAt: 1_700_000_120_000 }))
    expect(result.current.running).toBe(true)
    expect(result.current.runningTurn).toBeUndefined()
  })

  it('真在跑的新一轮必须采纳：轮号更大', () => {
    const { result } = run()
    act(() => result.current.resetTurnState(false))
    act(() => result.current.applyTurnVerdict({ running: false, turn: 366, at: 1_700_000_000_000 }))
    act(() => result.current.applyTurnVerdict({ running: true, turn: 367, startAt: 1_700_000_120_000 }))
    expect(result.current.running).toBe(true)
    expect(result.current.runningTurn).toBe(367)
  })

  it('force 的「停止纠正」永远生效（不被任何锁定挡住）', () => {
    const { result } = run()
    act(() => result.current.resetTurnState(true))
    act(() => result.current.applyTurnVerdict({ running: true, turn: 9, startAt: 1_000 }))
    act(() => result.current.applyTurnVerdict({ running: false, force: true }))
    expect(result.current.running).toBe(false)
    // 停止纠正之后，同一轮的「在跑」不许点回来。
    act(() => result.current.applyTurnVerdict({ running: true, turn: 9, startAt: 1_000 }))
    expect(result.current.running).toBe(false)
  })

  it('换会话（resetTurnState）：上一场的收工不能挡住这一场的在跑', () => {
    const { result } = run()
    act(() => result.current.resetTurnState(false))
    act(() => result.current.applyTurnVerdict({ running: false, turn: 367, at: 1_700_000_000_000 }))
    act(() => result.current.resetTurnState(true))
    expect(result.current.running).toBe(true)
  })
})
