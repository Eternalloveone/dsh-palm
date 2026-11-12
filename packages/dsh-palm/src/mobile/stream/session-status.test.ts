import { describe, expect, it } from 'vitest'
import {
  barsSignature,
  createSessionStatus,
  dedupeQueue,
  describeBars,
  leaseAlive,
  sessionStatusReducer,
  shouldAccept,
  visibleQueue,
  SOURCE_LEASE_MS,
  STALL_HINT_MS,
  sweepExpired,
  type StatusEvent,
} from './session-status.ts'
import type { QueueItemView } from '../api.ts'

const at = 1_000_000
const item = (id: string, text = 'hi'): QueueItemView => ({ id, placement: 'queued', text, editable: true })

const reduce = (events: readonly StatusEvent[], now = at) => events.reduce(sessionStatusReducer, createSessionStatus())

describe('状态源优先级', () => {
  it('低优先级不许覆盖未过期的高优先级值（旧快照不能盖新帧）', () => {
    expect(shouldAccept({ value: 1, source: 'snapshot', at, until: at + 12_000 }, { at: at + 100, source: 'frame' }, at)).toBe(false)
  })

  it('高优先级可以覆盖低优先级', () => {
    expect(shouldAccept({ value: 1, source: 'frame', at, until: at + 30_000 }, { at: at + 100, source: 'snapshot' }, at)).toBe(true)
  })

  it('同优先级：更新的赢，同刻也接受（幂等重放）', () => {
    expect(shouldAccept({ value: 1, source: 'frame', at, until: at + 30_000 }, { at: at + 50, source: 'frame' }, at)).toBe(true)
    expect(shouldAccept({ value: 1, source: 'frame', at, until: at + 30_000 }, { at: at, source: 'frame' }, at)).toBe(true)
    expect(shouldAccept({ value: 1, source: 'frame', at: at + 100, until: at + 30_000 }, { at: at + 50, source: 'frame' }, at)).toBe(false)
  })

  it('现值过期后，低优先级也能接管（过期降级）', () => {
    const stale = { value: 1, source: 'snapshot' as const, at, until: at + 1_000 }
    expect(shouldAccept(stale, { at: at + 5_000, source: 'roster' }, at + 5_000)).toBe(true)
  })
})

describe('租约与清扫', () => {
  it('接受即上租约，时长按来源算', () => {
    const state = reduce([{ type: 'turn', at, source: 'snapshot', running: true, turnNo: 9 }])
    expect(state.turn?.until).toBe(at + SOURCE_LEASE_MS.snapshot)
    expect(leaseAlive(state.turn, at + 1)).toBe(true)
    expect(leaseAlive(state.turn, at + SOURCE_LEASE_MS.snapshot)).toBe(false)
  })

  it('过期清扫把值摘掉：条自然不显示了（残留的根因）', () => {
    const state = reduce([
      { type: 'turn', at, source: 'frame', running: true, turnNo: 3 },
      { type: 'queue', at, source: 'snapshot', items: [item('m1')] },
    ])
    const later = sweepExpired(state, at + SOURCE_LEASE_MS.snapshot + 1)
    expect(later.queue).toBeUndefined()
    expect(later.turn).toBeDefined()
    expect(barsSignature(describeBars(later, at + SOURCE_LEASE_MS.snapshot + 1))).not.toContain('queue:1')
  })

  it('动作一旦过期，渲染层不需要任何额外判断', () => {
    const state = reduce([{ type: 'goal', at, source: 'snapshot', goal: { objective: 'x' } }])
    expect(describeBars(state, at + 100).goalBar).toBeDefined()
    expect(describeBars(state, at + SOURCE_LEASE_MS.snapshot + 1).goalBar).toBeUndefined()
  })
})

describe('单例与去重', () => {
  it('排队项按 id 去重，后到的正文算数（编辑场景）', () => {
    // 顺序按首次出现的位置，内容取后到的那份（编辑后的正文）。
    expect(dedupeQueue([item('a', '旧'), item('b'), item('a', '新')]).map(entry => entry.text)).toEqual(['新', 'hi'])
  })

  it('回合只有一份：最新一次入账覆盖旧的', () => {
    const state = reduce([
      { type: 'turn', at, source: 'frame', running: true, turnNo: 3 },
      { type: 'turn', at: at + 10, source: 'frame', running: false, turnNo: 3 },
    ])
    expect(state.turn?.value).toEqual({ running: false, turnNo: 3 })
  })

})

describe('describeBars：三根条的唯一判据', () => {
  it('全收工且无后台任务 → 不收状态条', () => {
    const state = reduce([{ type: 'turn', at, source: 'snapshot', running: false }])
    expect(describeBars(state, at + 1).statusBar).toBeUndefined()
  })

  it('有任务 → 状态条显示任务进度', () => {
    const state = reduce([{
      type: 'plan',
      at,
      source: 'snapshot',
      todo: { seq: 1, items: [
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'in_progress' },
      ] } as never,
    }])
    expect(describeBars(state, at + 1).statusBar).toBe('任务 1/2 · 正在做第 2 项')
  })

  it('正常运行中：状态条什么都不说（过程条的相位与用时已经够了）', () => {
    const state = reduce([{ type: 'turn', at, source: 'frame', running: true, step: 12, lastActivityAt: at }])
    expect(describeBars(state, at + 5_000).statusBar).toBeUndefined()
  })

  /** 生产环境每 5 秒会重投一次 turn（租约续期）；这里用同样的方式模拟。 */
  // 生产环境的心跳会同时续租 turn / plan / jobs（否则任务条 12 秒后自己过期消失）。
  const heartbeat = (state: ReturnType<typeof reduce>, at2: number, lastActivityAt: number) => {
    const withTurn = sessionStatusReducer(state, { type: 'turn', at: at2, source: 'frame', running: true, lastActivityAt })
    const plan = withTurn.plan
    return plan === undefined
      ? withTurn
      : sessionStatusReducer(withTurn, { type: 'plan', at: at2, source: 'snapshot', todo: plan.value })
  }

  it('很久没有新输出也不再说「已 N 秒没有新输出」（2026-11-10 整句下线）', () => {
    // 那句话是否定式文案，且它描述的事实（慢）在过程条与时钟上已经有了。
    // 现在这条判据只剩一个作用：**正常运行中状态条什么都不说**。
    const checkAt = at + STALL_HINT_MS + 15_000
    const state = heartbeat(reduce([{ type: 'turn', at, source: 'frame', running: true, lastActivityAt: at }]), checkAt, at)
    expect(describeBars(state, checkAt).statusBar).toBeUndefined()
  })

  it('刚开跑就发消息：不许闪一下「已 N 秒没有新输出」', () => {
    // 真机：点了发送，状态条先出现「已 30 秒没有新输出」再消失。
    // 原因是上一轮的旧行事件时间冒充了「最后一次活动」；现在用 runningSince 做宽限期。
    const state = reduce([{ type: 'turn', at, source: 'local', running: true, lastActivityAt: at - 30_000 }])
    // 开跑 5 秒：旧行时间戳虽然很老，但不该说卡住
    expect(describeBars(state, at + 5_000).statusBar).toBeUndefined()
    // 开跑 25 秒后仍没有新输出：2026-11-10 起也不再说那句话了。
    const later = sessionStatusReducer(state, { type: 'turn', at: at + 25_000, source: 'frame', running: true, lastActivityAt: at - 30_000 })
    expect(later.turn?.value.runningSince).toBe(at)
    expect(describeBars(later, at + 25_000).statusBar).toBeUndefined()
  })

  it('长时等待（分钟级）同样不说话', () => {
    const checkAt = at + 4 * 60_000
    const state = heartbeat(reduce([{ type: 'turn', at, source: 'frame', running: true, lastActivityAt: at }]), checkAt, at)
    expect(describeBars(state, checkAt).statusBar).toBeUndefined()
  })

  it('有任务时优先说任务（卡住提示不该顶掉进度）', () => {
    const checkAt = at + 60_000
    const state = heartbeat(reduce([
      { type: 'turn', at, source: 'frame', running: true, lastActivityAt: at },
      { type: 'plan', at, source: 'snapshot', todo: { seq: 1, items: [{ content: 'a', status: 'in_progress' }] } as never },
    ]), checkAt, at)
    expect(describeBars(state, checkAt).statusBar).toBe('任务 0/1 · 正在做第 1 项')
  })

  it('计划全勾完但回合还在跑 → 状态条不许消失', () => {
    const state = reduce([
      { type: 'turn', at, source: 'frame', running: true },
      { type: 'plan', at, source: 'snapshot', todo: { seq: 1, items: [{ content: 'a', status: 'completed' }] } as never },
    ])
    expect(describeBars(state, at + 1).statusBar).toBe('任务 1/1')
  })

  it('回合结束且计划全勾完 → 收起（跑完不许凭空挂一条）', () => {
    const state = reduce([
      { type: 'turn', at, source: 'frame', running: false },
      { type: 'plan', at, source: 'snapshot', todo: { seq: 1, items: [{ content: 'a', status: 'completed' }] } as never },
    ])
    expect(describeBars(state, at + 1).statusBar).toBeUndefined()
  })

  it('整轮收工且没有后台任务 → 收起（真机「跑完凭空挂一条」）', () => {
    const state = reduce([{
      type: 'plan',
      at,
      source: 'snapshot',
      todo: { seq: 1, items: [{ content: 'a', status: 'completed' }] } as never,
    }])
    expect(describeBars(state, at + 1).statusBar).toBeUndefined()
  })

  it('排队条按活着的队列算；过期归零', () => {
    const state = reduce([{ type: 'queue', at, source: 'snapshot', items: [item('a'), item('b')] }])
    expect(describeBars(state, at + 1).queueBar).toBe(2)
    expect(describeBars(state, at + SOURCE_LEASE_MS.snapshot + 1).queueBar).toBe(0)
  })

})

describe('目标条：可见性由 describeBars 决定（阶段 2b）', () => {
  it('有目标且租约有效 → 显示', () => {
    const state = reduce([{ type: 'goal', at, source: 'snapshot', goal: { objective: 'x', phase: 'active' } }])
    expect(describeBars(state, at + 1).goalBar).toBeDefined()
  })

  it('目标为 null（已完成/已清除）→ 不显示', () => {
    const state = reduce([{ type: 'goal', at, source: 'snapshot', goal: null }])
    expect(describeBars(state, at + 1).goalBar).toBeUndefined()
  })

  it('租约过期 → 不显示（残留的根因）', () => {
    const state = reduce([{ type: 'goal', at, source: 'snapshot', goal: { objective: 'x' } }])
    expect(describeBars(state, at + SOURCE_LEASE_MS.snapshot + 1).goalBar).toBeUndefined()
  })
})

describe('回合来源优先级（花名册会撒谎）', () => {
  it('花名册说在跑、实时帧说收工 → 以实时帧为准', () => {
    const state = reduce([
      { type: 'turn', at, source: 'roster', running: true, turnNo: 5 },
      { type: 'turn', at: at + 50, source: 'frame', running: false, turnNo: 5 },
    ])
    expect(state.turn?.value.running).toBe(false)
  })
})

describe('排队条不许出现「一模一样的第二条」', () => {

  it('宿主同一条列了两次（同 id）→ 只显示一条', () => {
    const view = visibleQueue({ host: [item('h1', '一条'), item('h1', '一条')] })
    expect(view).toHaveLength(1)
  })

})

