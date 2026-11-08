/**
 * 帧分发器的边界处理器单测（S7a-4c）。
 *
 * 只测「搬到 frame-effects 之后，判据与写入顺序没变」——它们是回合状态的唯一入口，
 * 出错的表现是"指示器/秒表/计划条/交付卡"四类真机问题，不是类型错误。
 */
import { describe, expect, it, vi } from 'vitest'
import type { FrameContext } from './frame-effects.ts'
import { onTurnEnd, onTurnStart } from './frame-effects.ts'
import type { WireEvent } from '../../../render/messages.ts'

/** 一个记录调用顺序的假 ctx：所有写入方都是 spy，值型状态用可变盒子。 */
function makeCtx() {
  const order: string[] = []
  const record = (name: string) => (...args: never[]): void => { order.push(name); void args }
  const spies = {
    applyTurnVerdict: vi.fn(record('applyTurnVerdict')),
    beginTurn: vi.fn(record('beginTurn')),
    refreshSubagents: vi.fn(record('refreshSubagents')),
    claimQueueHead: vi.fn(record('claimQueueHead')),
    refreshInbox: vi.fn(record('refreshInbox')),
    setQueueItems: vi.fn(record('setQueueItems')),
    setTodo: vi.fn(record('setTodo')),
    shadowEvent: vi.fn(record('shadowEvent')),
    clearActiveTurn: vi.fn(record('clearActiveTurn')),
    normalizeTurnEndTodo: vi.fn(record('normalizeTurnEndTodo')),
  }
  const noop = (): void => {}
  const ctx: FrameContext = {
    sessionId: 's-1',
    clearHostLost: noop,
    isRunning: () => false,
    applyTurnVerdict: spies.applyTurnVerdict as never,
    clearActiveTurn: spies.clearActiveTurn as never,
    beginTurn: spies.beginTurn as never,
    normalizeTurnEndTodo: spies.normalizeTurnEndTodo as never,
    reconcileRunning: noop,
    enqueueLiveEvent: noop,
    reloadTail: noop,
    syncHostClock: noop,
    shadowEvent: spies.shadowEvent as never,
    setTodo: spies.setTodo as never,
    adoptTodoLatest: noop,
    refreshSubagents: spies.refreshSubagents as never,
    refreshInbox: spies.refreshInbox as never,
    claimQueueHead: spies.claimQueueHead as never,
    queueView: () => [{ id: 'q-1' } as never],
    setQueueItems: spies.setQueueItems as never,
    applyQueueItems: noop,
    setJobs: noop,
    setPermissions: noop,
    setContextPressure: noop,
    applyInbox: noop,
    applyGoal: noop,
    setGoal: noop,
    setPendingApprovals: noop,
    setPendingQuestions: noop,
    answeredApprovals: () => new Set<string>(),
    answeredQuestions: () => new Set<string>(),
    liveClosedTurns: new Set<number>(),
    lastSessionEventAt: { current: 0 },
  }
  return { ctx, order, spies }
}

function boundaryEvent(type: 'turn/start' | 'turn/end', turn: number, time: number, seq = 42): WireEvent {
  return { type, seq, time, data: { turn } } as unknown as WireEvent
}

describe('onTurnStart（turn/start 边界）', () => {
  it('走唯一裁决入口 + 锚定秒表 + 刷新计划/队列（顺序保持）', () => {
    const { ctx, order, spies } = makeCtx()
    onTurnStart(ctx, boundaryEvent('turn/start', 7, 1_700_000_000_000, 42))

    // 防的回归：各处直接 setRunning → 运行态忽亮忽灭（#1017）。
    expect(spies.applyTurnVerdict).toHaveBeenCalledWith({
      running: true,
      turn: 7,
      startAt: 1_700_000_000_000,
      seq: 42,
    })
    // 防的回归：秒表从挂载时刻起算，中途重载回零（desktop parity）。
    expect(spies.beginTurn).toHaveBeenCalledWith(1_700_000_000_000)
    // 防的回归：subagent 拉起后树不刷新。
    expect(spies.refreshSubagents).toHaveBeenCalledTimes(1)
    // 防的回归：队首被认领后仍留在本地（幻影行），或清完不立刻问真值。
    expect(spies.claimQueueHead).toHaveBeenCalledWith('s-1')
    expect(spies.refreshInbox).toHaveBeenCalledWith({ fresh: true })
    // 写入顺序与搬走前一致：裁决 → 锚点 → 树 → 计划 → 队列 → 问真值。
    expect(order).toEqual([
      'applyTurnVerdict',
      'beginTurn',
      'refreshSubagents',
      'setTodo',
      'claimQueueHead',
      'setQueueItems',
      'refreshInbox',
    ])
  })

  it('清计划条但**保留 seq 水位**（防更旧的历史把上一轮计划塞回来）', () => {
    const { ctx, spies } = makeCtx()
    onTurnStart(ctx, boundaryEvent('turn/start', 3, 1))

    const updater = spies.setTodo.mock.calls[0]?.[0] as (previous: unknown) => unknown
    // 有上一轮：条目清空、水位留着（串轮回归）。
    expect(updater({ seq: 9, items: [{ id: 'a' }] })).toEqual({ seq: 9, items: [] })
    // 没有上一轮：保持 undefined，不要凭空造一个空快照。
    expect(updater(undefined)).toBeUndefined()
  })

  it('帧里没有合法 time 时退回 Date.now（时钟锚点不能是 undefined）', () => {
    const { ctx, spies } = makeCtx()
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_234_567)
    onTurnStart(ctx, { type: 'turn/start', seq: 5, data: { turn: 1 } } as unknown as WireEvent)
    expect(spies.beginTurn).toHaveBeenCalledWith(1_234_567)
    expect(spies.applyTurnVerdict).toHaveBeenCalledWith(expect.objectContaining({ startAt: 1_234_567 }))
    now.mockRestore()
  })
})

describe('onTurnEnd（turn/end 边界）', () => {
  it('记「亲眼看到收工」+ 落 running + 清活跃轮次 + 归一化待办', () => {
    const { ctx, order, spies } = makeCtx()
    onTurnEnd(ctx, boundaryEvent('turn/end', 7, 1_700_000_000_000, 43))

    // 防的回归：交付卡不出现（只有「亲眼看到收工」的轮号才允许出卡）。
    expect(ctx.liveClosedTurns.has(7)).toBe(true)
    // 防的回归：指示器不熄灭 / 过程条停在「运行中」（秒表继续数）；轮号一起交给
    // 裁决入口 —— 它就是「终态锁定」的凭据（迟到的「在跑」据此丢弃）。
    expect(spies.applyTurnVerdict).toHaveBeenCalledWith({ running: false, seq: 43, turn: 7, at: 1_700_000_000_000 })
    expect(spies.clearActiveTurn).toHaveBeenCalledTimes(1)
    // 防的回归：计划条停在上一轮（宿主同款归一化没跑）。
    expect(spies.normalizeTurnEndTodo).toHaveBeenCalledTimes(1)
    // 三根条按 frame 优先级发布，且带上轮号。
    expect(spies.shadowEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'turn',
      source: 'frame',
      running: false,
      turnNo: 7,
    }))
    // 顺序：先裁决 → 发布 → 清指针 → 归一化。
    expect(order).toEqual(['applyTurnVerdict', 'shadowEvent', 'clearActiveTurn', 'normalizeTurnEndTodo'])
  })

  it('轮号缺失时不乱记（liveClosedTurns 不加 undefined）', () => {
    const { ctx, spies } = makeCtx()
    onTurnEnd(ctx, { type: 'turn/end', seq: 44, time: 1, data: {} } as unknown as WireEvent)
    expect(ctx.liveClosedTurns.size).toBe(0)
    // 仍然要落 running：边界帧本身就是收工证据。
    expect(spies.applyTurnVerdict).toHaveBeenCalledWith({ running: false, seq: 44, at: 1 })
    expect(spies.shadowEvent).toHaveBeenCalledWith(expect.not.objectContaining({ turnNo: expect.anything() }))
  })
})
