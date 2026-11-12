/**
 * 抽屉行只认 runningSessions 的权威集合（列表行的 running 会撒谎）。
 */
import { describe, expect, it } from 'vitest'
import { applyRunningState } from './drawer-rows.ts'
import type { SessionView } from '../shared/session-view.ts'

const row = (sessionId: string, running: boolean): SessionView => ({
  sessionId,
  title: sessionId,
  updatedAt: 0,
  running,
  blank: false,
} as SessionView)

describe('applyRunningState', () => {
  it('把列表里说"没在跑"的行改成正在跑（会话刚开跑，列表还没更新）', () => {
    const rows = [row('a', false), row('b', false)]
    const next = applyRunningState(rows, ['b'])
    expect(next.map(item => item.running)).toEqual([false, true])
  })

  it('把列表里说"在跑"但实际已经收工的行改回来（完成 → 运行中 的跳变来源）', () => {
    const rows = [row('a', true), row('b', true)]
    const next = applyRunningState(rows, ['a'])
    expect(next.map(item => item.running)).toEqual([true, false])
  })

  it('集合里没有的会话一律不在跑', () => {
    const rows = [row('a', true), row('b', false)]
    expect(applyRunningState(rows, []).every(item => item.running === false)).toBe(true)
  })

  it('状态没变时返回原数组（不触发无意义的整层重渲染）', () => {
    const rows = [row('a', true), row('b', false)]
    expect(applyRunningState(rows, ['a'])).toBe(rows)
  })

  it('集合里是数字/字符串混着也能对上（宿主侧 id 类型不保证）', () => {
    const rows = [row('123', false)]
    expect(applyRunningState(rows, [123 as unknown as string])[0]!.running).toBe(true)
  })
})
