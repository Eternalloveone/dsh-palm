/**
 * 任务状态机的五条兜底 + 单调性 + 乱序/重复事件。
 *
 * 这里不挂 DOM：状态机是纯函数，`now` 是注入的，所以「90 秒后卡住」「重连后
 * 重建」都能在一个毫秒不动的单测里复现。
 */
import { describe, expect, it } from 'vitest'
import type { RenderMessage, TodoItem } from '../projections/types.ts'
import {
  decodeTaskStatus,
  deriveTaskStatus,
  encodeTaskStatus,
  foldTaskStatus,
  planProgressOf,
  planStepsOf,
  TASK_STUCK_AFTER_MS,
  taskActivityOf,
  taskKindOfTool,
  type TaskStatusInput,
  type TaskTurnSignal,
} from './task-status.ts'

const AT = 1_700_000_000_000

function turnOf(running: boolean, turnNo = 1, extra: Partial<TaskTurnSignal> = {}): TaskTurnSignal {
  return { running, turnNo, ...extra }
}

function planOf(...statuses: TodoItem['status'][]): { items: TodoItem[] } {
  return { items: statuses.map((status, index) => ({ content: `第 ${index + 1} 步`, status })) }
}

function inputOf(overrides: Partial<TaskStatusInput> = {}): TaskStatusInput {
  return { now: AT, turn: turnOf(true, 1), ...overrides }
}

describe('兜底 1：completed / failed / cancelled 任一到就是终态', () => {
  it('三种收尾各自落到 done / failed / stopped，并带 closedAt', () => {
    const cases = [
      ['completed', 'done'],
      ['failed', 'failed'],
      ['cancelled', 'stopped'],
    ] as const
    for (const [outcome, kind] of cases) {
      const status = deriveTaskStatus(inputOf({ outcome }))
      expect(status.kind, outcome).toBe(kind)
      expect(status.terminal, outcome).toBe(true)
      expect(status.closedAt).toBe(AT)
    }
  })

  it('完成态进度铺满；同一轮收到「在跑」也不许复活', () => {
    const done = deriveTaskStatus(inputOf({ outcome: 'completed', plan: planOf('completed', 'completed') }))
    expect(done.progress).toBe(1)

    const revived = foldTaskStatus(done, inputOf({ activity: { streaming: true }, plan: planOf('completed', 'in_progress') }))
    expect(revived).toEqual(done)
    expect(revived.terminal).toBe(true)
  })

  it('重复收到同一条收尾证据是幂等的（乱序/重放）', () => {
    const first = deriveTaskStatus(inputOf({ outcome: 'failed' }))
    const replay = foldTaskStatus(first, inputOf({ outcome: 'failed' }))
    expect(replay).toEqual(first)
  })
})

describe('兜底 2：90 秒没有新事件 → stuck', () => {
  it('静默满 90 秒才卡住，差 1 毫秒都还算在跑', () => {
    const silent = (ago: number): TaskStatusInput => inputOf({
      turn: turnOf(true, 1, { startedAt: AT - 10 * TASK_STUCK_AFTER_MS, lastActivityAt: AT - ago }),
      activity: { streaming: true },
    })
    expect(deriveTaskStatus(silent(TASK_STUCK_AFTER_MS)).kind).toBe('stuck')
    expect(deriveTaskStatus(silent(TASK_STUCK_AFTER_MS - 1)).kind).toBe('think')
  })

  it('刚开跑不闪「可能卡住了」：上一轮的旧事件时间不算这一轮的静默', () => {
    const fresh = inputOf({
      turn: turnOf(true, 1, { startedAt: AT - 5_000, lastActivityAt: AT - 5 * TASK_STUCK_AFTER_MS }),
      activity: { streaming: true },
    })
    expect(deriveTaskStatus(fresh).kind).toBe('think')
  })

  it('卡住不是终态：新事件一到就接着走', () => {
    const stuck = deriveTaskStatus(inputOf({
      turn: turnOf(true, 1, { startedAt: AT - 10 * TASK_STUCK_AFTER_MS, lastActivityAt: AT - TASK_STUCK_AFTER_MS }),
    }))
    expect(stuck.kind).toBe('stuck')
    expect(stuck.terminal).toBe(false)

    const resumed = foldTaskStatus(stuck, inputOf({ turn: turnOf(true, 1, { lastActivityAt: AT }), activity: { streaming: true } }))
    expect(resumed.kind).toBe('think')
  })
})

describe('兜底 3：重连后能从存储重建（不依赖内存动画状态）', () => {
  const liveInput = (): TaskStatusInput => inputOf({
    plan: planOf('completed', 'completed', 'in_progress', 'pending'),
    activity: { tool: { name: 'read', arguments: '{"path":"a.ts"}' } },
  })

  it('JSON 往返后原样恢复，接着推得出的结论与没断过时一致', () => {
    const live = deriveTaskStatus(liveInput())
    expect(live.kind).toBe('read')
    const restored = decodeTaskStatus(encodeTaskStatus(live))
    expect(restored).toEqual(live)
    expect(foldTaskStatus(restored, liveInput())).toEqual(live)
  })

  it('坏数据一律丢弃，绝不抛（存储写坏了当没存过）', () => {
    expect(decodeTaskStatus(null)).toBeUndefined()
    expect(decodeTaskStatus('')).toBeUndefined()
    expect(decodeTaskStatus('{oops')).toBeUndefined()
    expect(decodeTaskStatus(JSON.stringify({ kind: '不知道', terminal: true }))).toBeUndefined()
    expect(decodeTaskStatus(JSON.stringify({ kind: 'done' }))).toBeUndefined()
  })
})

describe('兜底 4：新一轮开始而上一轮仍 running → 上一轮按终态收尾', () => {
  it('轮号变大时记下上一轮的收尾（默认 done），新轮从零开始', () => {
    const turn1 = foldTaskStatus(undefined, inputOf({ turn: turnOf(true, 1), activity: { streaming: true } }))
    expect(turn1.kind).toBe('think')

    const turn2 = foldTaskStatus(turn1, inputOf({ turn: turnOf(true, 2), activity: { streaming: true } }))
    expect(turn2.turn).toBe(2)
    expect(turn2.kind).toBe('think')
    expect(turn2.previous).toEqual({ turn: 1, kind: 'done', at: AT })
  })

  it('上一轮已有终态时，收尾记录保留那个终态', () => {
    const failed = deriveTaskStatus(inputOf({ turn: turnOf(false, 1), outcome: 'failed' }))
    const next = foldTaskStatus(failed, inputOf({ turn: turnOf(true, 2), activity: { streaming: true } }))
    expect(next.previous).toEqual({ turn: 1, kind: 'failed', at: AT })
  })
})

describe('兜底 5：进度单调（同一轮取 max，换轮才重置）', () => {
  it('计划回退也不许让进度条倒着走', () => {
    const ahead = foldTaskStatus(undefined, inputOf({
      plan: planOf('completed', 'completed', 'completed', 'in_progress', 'pending', 'pending', 'pending'),
    }))
    expect(ahead.progress).toBeCloseTo(3.5 / 7)

    const regressed = foldTaskStatus(ahead, inputOf({
      plan: planOf('completed', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending'),
    }))
    expect(regressed.progress).toBeCloseTo(3.5 / 7)
    // 步数如实反映新计划，只有进度被 max 保住。
    expect(regressed.steps).toEqual({ done: 1, total: 7 })
  })

  it('换到新一轮时进度重置（新任务不继承上一轮的 90%）', () => {
    const ahead = foldTaskStatus(undefined, inputOf({
      plan: planOf('completed', 'completed', 'completed', 'in_progress', 'pending', 'pending', 'pending'),
    }))
    const next = foldTaskStatus(ahead, inputOf({
      turn: turnOf(true, 2),
      plan: planOf('completed', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending'),
    }))
    expect(next.progress).toBeCloseTo(1 / 7)
  })
})

describe('乱序与重复事件', () => {
  it('更旧的轮号整条丢弃（晚到的旧对账不许改口）', () => {
    const turn2 = foldTaskStatus(undefined, inputOf({ turn: turnOf(true, 2), activity: { streaming: true } }))
    const stale = foldTaskStatus(turn2, inputOf({ turn: turnOf(true, 1), outcome: 'completed' }))
    expect(stale).toBe(turn2)
  })

  it('旧的活动时间不把「最新事件时间」拉回去', () => {
    const fresh = foldTaskStatus(undefined, inputOf({ turn: turnOf(true, 1, { lastActivityAt: AT }) }))
    const older = foldTaskStatus(fresh, inputOf({ turn: turnOf(true, 1, { lastActivityAt: AT - 60_000 }) }))
    expect(older.lastEventAt).toBe(AT)
  })

  it('同一版输入重复折叠结果不变（幂等）', () => {
    const input = inputOf({ plan: planOf('completed', 'in_progress', 'pending'), activity: { streaming: true } })
    const once = foldTaskStatus(undefined, input)
    expect(foldTaskStatus(once, input)).toEqual(once)
  })
})

describe('其余判据：审批 / 排队 / 工具 / 无数据', () => {
  it('待你决定优先于「在跑」', () => {
    const status = deriveTaskStatus(inputOf({ approval: true, activity: { streaming: true } }))
    expect(status.kind).toBe('approve')
    expect(status.terminal).toBe(false)
  })

  it('没在跑但有排队消息 → queued；在跑时排队条不抢状态', () => {
    expect(deriveTaskStatus(inputOf({ turn: turnOf(false, 1), queued: 2 })).kind).toBe('queued')
    expect(deriveTaskStatus(inputOf({ queued: 2, activity: { streaming: true } })).kind).toBe('think')
  })

  it('工具分类：读 / 搜索→read，写 / 改→edit，命令看关键词，认不出不猜', () => {
    expect(taskKindOfTool({ name: 'read' })).toBe('read')
    expect(taskKindOfTool({ name: 'grep' })).toBe('read')
    expect(taskKindOfTool({ name: 'edit' })).toBe('edit')
    expect(taskKindOfTool({ name: 'bash', arguments: '{"command":"pnpm test"}' })).toBe('test')
    expect(taskKindOfTool({ name: 'bash', arguments: '{"command":"ls -la"}' })).toBe('edit')
    expect(taskKindOfTool({ name: 'mystery' })).toBeUndefined()
  })

  it('拿不到计划就不给 steps/progress，状态落到 unknown', () => {
    const status = deriveTaskStatus(inputOf({}))
    expect(status.kind).toBe('unknown')
    expect(status.steps).toBeUndefined()
    expect(status.progress).toBeUndefined()
  })

  it('计划只有空表时同样不给 steps/progress', () => {
    expect(planStepsOf(undefined)).toBeUndefined()
    expect(planStepsOf({ items: [] })).toBeUndefined()
    expect(planProgressOf({ items: [] })).toBeUndefined()
    expect(planStepsOf(planOf('completed', 'pending'))).toEqual({ done: 1, total: 2 })
    expect(planProgressOf(planOf('completed', 'in_progress'))).toBe(0.75)
  })

  it('活动证据只读现有投影字段：最近一条助手行 + 还在跑的工具', () => {
    const rows: RenderMessage[] = [
      { id: 'u1', kind: 'user', text: '改一下', seq: 1, time: AT },
      {
        id: 'a1',
        kind: 'assistant',
        text: '',
        seq: 2,
        time: AT,
        pending: true,
        reasoning: '先看看跳转',
        tools: [
          { callId: 'c1', name: 'bash', state: 'ok' },
          { callId: 'c2', name: 'read', state: 'running', arguments: '{"path":"a.ts"}' },
        ],
      },
    ]
    expect(taskActivityOf(rows)).toEqual({
      tool: { name: 'read', arguments: '{"path":"a.ts"}' },
      streaming: true,
      reasoning: true,
    })
    expect(taskActivityOf([])).toEqual({})
  })
})
