/**
 * 会话状态首帧跳变的三条不变量（真机：进会话/切会话先「已完成」，一秒后跳「运行中」）：
 *
 * 1. **unknown 态**：没有权威裁决（宿主快照没到 / 已过期）→ 只许 `unknown`，
 *    任何「缺字段」的路径都不许落到 `done`；
 * 2. **水合门**：`taskAuthority` 是「能不能下结论」的唯一判据（12s 新鲜窗）；
 * 3. **单调**：同一轮终态之后不许变回 running，只有轮号变大才允许重新点亮；
 *    乱序（更旧的轮号）整条丢弃。
 *
 * 全是纯函数：`now` 注入，不碰 DOM、不读时钟。
 */
import { describe, expect, it } from 'vitest'
import {
  deriveTaskStatus,
  foldTaskStatus,
  TASK_SNAPSHOT_FRESH_MS,
  taskActivityOf,
  taskAuthority,
  type TaskStatusInput,
} from './task-status.ts'

const AT = 1_700_000_000_000

function inputOf(overrides: Partial<TaskStatusInput> = {}): TaskStatusInput {
  return { now: AT, turn: { running: true, turnNo: 1 }, ...overrides }
}

describe('① unknown = 无权威数据（不许默认成 done）', () => {
  it('没有裁决（running 缺席）+ 没有终态证据 → unknown，且不是终态', () => {
    const status = deriveTaskStatus({ now: AT, turn: { turnNo: 7 } })
    expect(status.kind).toBe('unknown')
    expect(status.terminal).toBe(false)
    expect(status.progress).toBeUndefined()
    expect(status.steps).toBeUndefined()
  })

  it('没有裁决时，即使有计划、有推理文本也不进任何结论态', () => {
    const status = deriveTaskStatus({
      now: AT,
      turn: { turnNo: 7, lastActivityAt: AT },
      activity: { reasoning: true, streaming: true },
      plan: { items: [{ content: '改一行', status: 'completed' }, { content: '跑测试', status: 'pending' }] },
    })
    expect(status.kind).toBe('unknown')
    expect(status.terminal).toBe(false)
  })

  it('上次已知的非终态被保留（快照过期不该把状态退回空白）', () => {
    const think = deriveTaskStatus(inputOf({ activity: { streaming: true } }))
    expect(think.kind).toBe('think')
    const stale = foldTaskStatus(think, { now: AT + 30_000, turn: { turnNo: 1 } })
    expect(stale).toEqual(think)
  })

  it('显式终态事件不需要水合：turn/end 盖下的失败照样落到 failed', () => {
    const status = deriveTaskStatus({ now: AT, turn: { turnNo: 3 }, outcome: 'failed' })
    expect(status.kind).toBe('failed')
    expect(status.terminal).toBe(true)
  })
})

describe('② 水合门（taskAuthority）', () => {
  it('没有快照 → 没资格下结论', () => {
    expect(taskAuthority(undefined, AT)).toBe(false)
  })

  it('快照新鲜（含窗口边界）→ 有资格；过期 → 没资格', () => {
    expect(taskAuthority({ asOf: AT - 1_000 }, AT)).toBe(true)
    expect(taskAuthority({ asOf: AT - TASK_SNAPSHOT_FRESH_MS }, AT)).toBe(true)
    expect(taskAuthority({ asOf: AT - TASK_SNAPSHOT_FRESH_MS - 1 }, AT)).toBe(false)
  })

  it('快照时间戳坏掉（NaN）按没到处理，不冒充权威', () => {
    expect(taskAuthority({ asOf: Number.NaN }, AT)).toBe(false)
  })
})

describe('③ 单调：同轮终态锁定 / 只有轮号变大才允许 running', () => {
  it('done 收到迟到的 running（同一轮）仍为 done', () => {
    const done = deriveTaskStatus(inputOf({ outcome: 'completed', turn: { running: false, turnNo: 5 } }))
    expect(done.kind).toBe('done')
    const late = foldTaskStatus(done, inputOf({
      turn: { running: true, turnNo: 5, startedAt: AT },
      activity: { streaming: true },
    }))
    expect(late.kind).toBe('done')
    expect(late.terminal).toBe(true)
    expect(late).toEqual(done)
  })

  it('failed / stopped 同样不许被 running 复活', () => {
    for (const outcome of ['failed', 'cancelled'] as const) {
      const closed = deriveTaskStatus(inputOf({ outcome, turn: { running: false, turnNo: 2 } }))
      const revived = foldTaskStatus(closed, inputOf({ turn: { running: true, turnNo: 2 } }))
      expect(revived.kind, outcome).toBe(closed.kind)
      expect(revived.terminal, outcome).toBe(true)
    }
  })

  it('轮号变大才允许重新点亮：上一轮按终态收尾，新一轮从零开始', () => {
    const done = deriveTaskStatus(inputOf({ outcome: 'completed', turn: { running: false, turnNo: 5 } }))
    const next = foldTaskStatus(done, inputOf({ turn: { running: true, turnNo: 6, startedAt: AT } }))
    expect(next.kind).toBe('think')
    expect(next.terminal).toBe(false)
    expect(next.turn).toBe(6)
    expect(next.steps).toBeUndefined()
    expect(next.previous?.kind).toBe('done')
  })

  it('乱序：更旧的轮号整条丢弃（晚到的旧对账不许改口）', () => {
    const live = deriveTaskStatus(inputOf({ turn: { running: true, turnNo: 9, startedAt: AT }, activity: { streaming: true } }))
    const older = foldTaskStatus(live, inputOf({ turn: { running: false, turnNo: 8 }, outcome: 'completed' }))
    expect(older).toEqual(live)
    expect(older.turn).toBe(9)
  })

  it('同一轮里终态优先：先收工再收到计划/活动也不改口', () => {
    const done = deriveTaskStatus(inputOf({ outcome: 'completed', turn: { running: false, turnNo: 4 } }))
    const noisy = foldTaskStatus(done, inputOf({
      turn: { running: true, turnNo: 4, lastActivityAt: AT },
      activity: taskActivityOf([{ id: 'a1', kind: 'assistant', text: '', seq: 1, time: AT, pending: true }]),
    }))
    expect(noisy.kind).toBe('done')
  })
})
