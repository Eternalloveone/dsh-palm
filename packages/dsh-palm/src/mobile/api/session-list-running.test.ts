// @vitest-environment node
/**
 * 快照行上的「运行中」修正（2026-11-11 用户：「任务都结束了，侧边栏还显示进行中」）。
 *
 * 花名册是 60 秒快照，`running` 会滞留一个 TTL。`correctStaleRunning` 只核对快照里
 * 说"在跑"的行，核对出没在跑才改；核对失败保留原值（宁可短暂显示运行中，也不要把
 * 真在跑的说成停了）。
 */
import { describe, expect, it, vi } from 'vitest'
import { correctStaleRunning } from './session-list-handler.ts'

type Row = { sessionId: string; running?: boolean; updatedAt: number }

describe('会话列表：running 修正', () => {
  it('只核对运行中的行；核对出没在跑就改 false，其余行原样', async () => {
    const rows: Row[] = [
      { sessionId: 'a', running: true, updatedAt: 3 },
      { sessionId: 'b', running: false, updatedAt: 2 },
      { sessionId: 'c', updatedAt: 1 },
    ]
    const verify = vi.fn(async (sessionId: string) => sessionId !== 'a')
    const fixed = await correctStaleRunning(rows, verify)
    expect(verify).toHaveBeenCalledTimes(1)
    expect(verify).toHaveBeenCalledWith('a')
    expect(fixed[0]).toEqual({ sessionId: 'a', running: false, updatedAt: 3 })
    expect(fixed[1]).toBe(rows[1])
    expect(fixed[2]).toBe(rows[2])
    // 不改传入数组（快照本身要留着，下次枚举才是真值）。
    expect(rows[0]!.running).toBe(true)
  })

  it('核对说"确实在跑"就保留运行中', async () => {
    const rows: Row[] = [{ sessionId: 'a', running: true, updatedAt: 1 }]
    const fixed = await correctStaleRunning(rows, async () => true)
    expect(fixed[0]).toBe(rows[0])
  })

  it('核对抛错时保留原值（不把在跑的说成停了）', async () => {
    const rows: Row[] = [{ sessionId: 'a', running: true, updatedAt: 1 }]
    const fixed = await correctStaleRunning(rows, async () => { throw new Error('evidence unavailable') })
    expect(fixed[0]!.running).toBe(true)
  })
})