import { describe, expect, it } from 'vitest'
import {
  barsSignature,
  createSessionStatus,
  dedupeQueue,
  describeBars,
  leaseAlive,
  optimisticAlive,
  QUEUE_EMPTY_HOLD_MS,
  QUEUE_HIDDEN_MS,
  QUEUE_OPTIMISTIC_MS,
  sessionStatusReducer,
  shouldAccept,
  visibleQueue,
  SOURCE_LEASE_MS,
  STALL_HINT_MS,
  sweepExpired,
  type StatusEvent,
} from './session-status.ts'
import type { QueueItemView } from './api.ts'

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

  it('宿主复核压过花名册（花名册会撒谎）', () => {
    const state = reduce([
      { type: 'turn', at, source: 'roster', running: true, turnNo: 4 },
      { type: 'verify', at: at + 100, running: false, turnNo: 4 },
    ])
    expect(state.turn?.value.running).toBe(false)
    expect(state.turn?.source).toBe('local')
  })

  it('复核之后，迟到的花名册不许再改回来', () => {
    const state = reduce([
      { type: 'verify', at: at + 100, running: false, turnNo: 4 },
      { type: 'turn', at: at + 200, source: 'roster', running: true, turnNo: 4 },
    ])
    expect(state.turn?.value.running).toBe(false)
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

  it('正常输出中：状态条什么都不说（过程条与「输出中」已经够了）', () => {
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

  it('超过 20 秒没有新输出 → 提示「卡住了」（这是别处看不到的信息）', () => {
    const checkAt = at + STALL_HINT_MS + 15_000
    const state = heartbeat(reduce([{ type: 'turn', at, source: 'frame', running: true, lastActivityAt: at }]), checkAt, at)
    expect(describeBars(state, checkAt).statusBar).toBe('已 35 秒没有新输出')
  })

  it('刚开跑就发消息：不许闪一下「已 N 秒没有新输出」', () => {
    // 真机：点了发送，状态条先出现「已 30 秒没有新输出」再消失。
    // 原因是上一轮的旧行事件时间冒充了「最后一次活动」；现在用 runningSince 做宽限期。
    const state = reduce([{ type: 'turn', at, source: 'local', running: true, lastActivityAt: at - 30_000 }])
    // 开跑 5 秒：旧行时间戳虽然很老，但不该说卡住
    expect(describeBars(state, at + 5_000).statusBar).toBeUndefined()
    // 开跑 25 秒后仍没有新输出：这时候才该说
    const later = sessionStatusReducer(state, { type: 'turn', at: at + 25_000, source: 'frame', running: true, lastActivityAt: at - 30_000 })
    expect(later.turn?.value.runningSince).toBe(at)
    expect(describeBars(later, at + 25_000).statusBar).toBe('已 55 秒没有新输出')
  })

  it('长时等待的写法带分钟', () => {
    const checkAt = at + 4 * 60_000
    const state = heartbeat(reduce([{ type: 'turn', at, source: 'frame', running: true, lastActivityAt: at }]), checkAt, at)
    expect(describeBars(state, checkAt).statusBar).toBe('已 4 分没有新输出')
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

  it('open 事件清空一切（换会话不留上一场的条）', () => {
    const state = reduce([
      { type: 'turn', at, source: 'frame', running: true },
      { type: 'queue', at, source: 'snapshot', items: [item('a')] },
      { type: 'open', at: at + 10 },
    ])
    expect(state.turn).toBeUndefined()
    expect(state.queue).toBeUndefined()
    expect(barsSignature(describeBars(state, at + 11))).toBe('status:-|queue:0|goal:-')
  })
})

describe('排队条可见判定（三个 TTL 收成一个语义）', () => {
  const host = [item('h1', '第一条')]
  const base = { host, optimistic: [], hiddenAt: new Map<string, number>() }

  it('隐藏表在 90 秒内有效，过期后该项自己回来（不靠外部清理）', () => {
    const hiddenAt = new Map([['h1', at]])
    expect(visibleQueue({ ...base, hiddenAt }, at + 1_000)).toHaveLength(0)
    expect(visibleQueue({ ...base, hiddenAt }, at + QUEUE_HIDDEN_MS + 1).map(entry => entry.id)).toEqual(['h1'])
  })

  it('乐观项在 45 秒内显示；超时自动退场', () => {
    const optimistic = [{ pendingId: 'local-1', text: '刚发的', placement: 'queued' as const, at }]
    expect(visibleQueue({ ...base, optimistic }, at + 1_000).map(entry => entry.id)).toEqual(['h1', 'local-1'])
    expect(visibleQueue({ ...base, optimistic }, at + QUEUE_OPTIMISTIC_MS + 1).map(entry => entry.id)).toEqual(['h1'])
  })

  it('宿主队列里出现同一条正文 → 乐观项立刻退场（真行接上，不显示两条）', () => {
    const optimistic = [{ pendingId: 'local-1', text: '刚发的', placement: 'queued' as const, at }]
    const nextHost = [item('h2', '刚发的')]
    expect(visibleQueue({ host: nextHost, optimistic, hiddenAt: new Map() }, at + 100).map(entry => entry.id)).toEqual(['h2'])
    // 判据本身也单独可测
    expect(optimisticAlive(optimistic[0]!, {
      host: nextHost,
      optimistic: [],
      hiddenAt: new Map(),
    }, at + 100)).toBe(false)
  })

  it('读到空队列时，4 秒观察窗内仍显示上一份（宿主刷新瞬态），过窗清空', () => {
    const emptyHold = { items: host, until: at + QUEUE_EMPTY_HOLD_MS }
    expect(visibleQueue({ ...base, host: [], emptyHold }, at + 1_000).map(entry => entry.id)).toEqual(['h1'])
    expect(visibleQueue({ ...base, host: [], emptyHold }, at + QUEUE_EMPTY_HOLD_MS + 1)).toHaveLength(0)
  })

  it('隐藏表对观察窗里那份也生效（不留幽灵行）', () => {
    const hiddenAt = new Map([['h1', at]])
    const emptyHold = { items: host, until: at + QUEUE_EMPTY_HOLD_MS }
    expect(visibleQueue({ host: [], optimistic: [], hiddenAt, emptyHold }, at + 100)).toHaveLength(0)
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
  const base = { host: [], optimistic: [], hiddenAt: new Map<string, number>() }

  it('同一条正文被点了两次排队（两个本地 id）→ 只显示一条，取最新的', () => {
    const optimistic = [
      { pendingId: 'local-1', text: '帮我跑一遍测试', placement: 'queued' as const, at },
      { pendingId: 'local-2', text: '帮我跑一遍测试  ', placement: 'queued' as const, at: at + 500 },
    ]
    const view = visibleQueue({ ...base, optimistic, normalize: (text: string) => text.replace(/\s+/g, ' ').trim() }, at + 1_000)
    expect(view).toHaveLength(1)
    expect(view[0]?.id).toBe('local-2')
  })

  it('宿主同一条列了两次（同 id）→ 只显示一条', () => {
    const view = visibleQueue({
      host: [item('h1', '一条'), item('h1', '一条')],
      optimistic: [],
      hiddenAt: new Map(),
    }, at)
    expect(view).toHaveLength(1)
  })

  it('正文不同就是两条（真的是两条排队）', () => {
    const optimistic = [
      { pendingId: 'local-1', text: '第一件事', placement: 'queued' as const, at },
      { pendingId: 'local-2', text: '第二件事', placement: 'queued' as const, at: at + 100 },
    ]
    expect(visibleQueue({ ...base, optimistic }, at + 200)).toHaveLength(2)
  })
})

describe('排队条：投递完成之后不能再挂着（2026-10-30 真机）', () => {
  const item = (id: string, text: string) => ({ id, placement: 'queued' as const, text, editable: true })

  it('宿主投影还挂着、但对话里已经是最后一条用户消息 → 不显示', () => {
    // 真机：13:31 的用户气泡和底部排队条是同一条正文 —— 宿主认领之后投影没刷新。
    const visible = visibleQueue({
      host: [item('q1', '摄像头画面需要加一个时间水印')],
      optimistic: [],
      hiddenIds: new Set(),
      hiddenAt: new Map(),
      lastUserText: '摄像头画面需要加一个时间水印',
      normalize: text => text.trim(),
    }, 1_000)
    expect(visible).toHaveLength(0)
  })

  it('只比最新一条：同类正文的历史消息不会误伤真正排队的那条', () => {
    const visible = visibleQueue({
      host: [item('q2', '继续')],
      optimistic: [],
      hiddenIds: new Set(),
      hiddenAt: new Map(),
      // 最新一条是别的话，历史上的「继续」不该让这条消失
      lastUserText: '换个话题',
      normalize: text => text.trim(),
    }, 1_000)
    expect(visible.map(entry => entry.text)).toEqual(['继续'])
  })
})
