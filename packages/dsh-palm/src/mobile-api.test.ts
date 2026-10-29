import { beforeEach, describe, expect, it } from 'vitest'
import {
  countPromptFileParts,
  mergeFinishedRuns,
  readFinishedRuns,
  type FinishedRunEntry,
  MAX_PROMPT_FILE_PARTS,
  MOBILE_ALLOWLIST,
  noteRunningFrame,
  queueItemsOf, MOBILE_GOAL_ACTION_METHOD, applyGoalAction, goalActivationOf, goalSnapshotOf, preferLiveGoal, resetCommandDirectoryCache, shouldRefreshInbox, resolveCommandDirectory, toRosterItems, turnVerdict, visibleSessionRows, type CommandRegistry, type AgentLookup, type GoalLookup, type RosterItem } from './mobile-api.ts'

/**
 * The phone's session.list page slices come from this filtered array: the
 * host session.list still returns deleted sessions while an attached live
 * registry entry survives (a deleted session stays in memory until the dsh
 * process restarts), so without the archive filter a session removed on the
 * desktop reappears on the phone roster.
 */

const row = (sessionId: string, updatedAt = 1): RosterItem =>
  ({ sessionId, updatedAt })

/** A subagent row (host marks these with origin: 'subagent'). */
const sub = (sessionId: string, updatedAt = 1): RosterItem =>
  ({ sessionId, updatedAt, origin: 'subagent' })

/** A session the desktop minted but nobody ever typed into. */
const blank = (sessionId: string, updatedAt = 1): RosterItem =>
  ({ sessionId, updatedAt, blank: true })

describe('visibleSessionRows', () => {
  it('passes every main-agent session when nothing is archived', () => {
    const rows = [row('s-1', 3), row('s-2', 2), row('s-3', 1)]
    expect(visibleSessionRows(rows, new Set())).toEqual(rows)
  })

  it('drops subagent sessions', () => {
    const rows = [row('s-1'), sub('sub-1'), row('s-2')]
    expect(visibleSessionRows(rows, new Set()).map(r => r.sessionId)).toEqual(['s-1', 's-2'])
  })

  it('drops blank sessions the desktop never used', () => {
    // 2026-10-20: 542 of these had piled up and the phone listed every one;
    // the desktop tree hides them (only the current blank is kept there).
    const rows = [row('s-1', 5), blank('blank-a', 4), row('s-2', 3), blank('blank-b', 2)]
    expect(visibleSessionRows(rows, new Set()).map(r => r.sessionId)).toEqual(['s-1', 's-2'])
  })

  it('keeps a row whose blank flag is absent or false', () => {
    const rows = [{ sessionId: 's-1', updatedAt: 2, blank: false }, row('s-2', 1)] as RosterItem[]
    expect(visibleSessionRows(rows, new Set()).map(r => r.sessionId)).toEqual(['s-1', 's-2'])
  })

  it('drops sessions in the archive set', () => {
    const rows = [row('s-1'), row('s-2'), row('s-3')]
    const visible = visibleSessionRows(rows, new Set(['s-2']))
    expect(visible.map(r => r.sessionId)).toEqual(['s-1', 's-3'])
  })

  it('filters subagent, blank and archived together, preserving host order', () => {
    const rows = [
      row('s-1', 5),
      sub('sub-a', 4),
      row('s-archived', 3),
      blank('blank-a', 3),
      row('s-2', 2),
      sub('sub-b', 1),
    ]
    const visible = visibleSessionRows(rows, new Set(['s-archived']))
    expect(visible.map(r => r.sessionId)).toEqual(['s-1', 's-2'])
  })
})

describe('toRosterItems', () => {
  // The snapshot persists these rows and the paged list is served from it, so
  // every field the phone renders has to survive. Narrowing the row down to
  // {sessionId, updatedAt, origin} (2026-10-20) erased projections.values.title
  // and turned every session in the phone's list into "新会话".
  it('keeps projections and the other rendered fields', () => {
    const hostRow = {
      sessionId: 's-1',
      updatedAt: 7,
      running: false,
      blank: true,
      cwd: '/w/project',
      origin: 'subagent' as const,
      projections: { values: { title: '真实标题', preview: '第一句', sessionStats: { turns: 3 } } },
    }
    const copied = toRosterItems([hostRow])
    expect(copied).toEqual([hostRow])
    // A copy: a later host mutation must not rewrite rows already snapshotted.
    expect(copied[0]).not.toBe(hostRow)
  })
})

/**
 * The phone's + menu command directory. The Web deployment moves per-agent
 * rows (plan-mode, command-compact) into agent presets, so the directory must
 * resolve the SESSION's agent view — the same catalog the desktop `/` popup
 * lists — and fall back to the plain-context view only when no agent resolves.
 */

/** A registry whose per-agent view adds the preset-mounted rows. */
const registry = (): CommandRegistry => ({
  list: (agent: unknown) => agent === undefined
    ? [
      { name: 'export', description: 'Download this Session log as a ZIP archive' },
      { name: 'goal', description: 'set or view the goal for a long-running task' },
    ]
    : [
      { name: 'compact', description: 'Compact older conversation history' },
      { name: 'export', description: 'Download this Session log as a ZIP archive' },
      { name: 'goal', description: 'set or view the goal for a long-running task' },
      { name: 'plan', description: 'Enter or leave plan mode', input: { hint: '[off|message]' } },
    ],
  execute: async () => undefined,
})

const agents = (): AgentLookup => ({ get: (sessionId: string) => sessionId === 's-live' ? { session: { id: 's-live' } } : undefined })

describe('resolveCommandDirectory', () => {
  // 完整视角是模块级缓存（冷会话要靠它补齐），用例之间必须清干净。
  beforeEach(() => { resetCommandDirectoryCache() })
  it('resolves the session agent view when the session is live (plan/compact included)', () => {
    const items = resolveCommandDirectory(registry(), agents(), 's-live')
    expect(items.map(item => item.name)).toEqual(['compact', 'export', 'goal', 'plan'])
    expect(items.find(item => item.name === 'plan')?.input).toEqual({ hint: '[off|message]' })
  })

  it('keeps the agent-only rows out when the session resolves no agent', () => {
    // agent 视角才有 /plan、/compact（Web 部署把这两行挂在 agent 预设上），
    // 会话冷的时候确实拿不到，但它们不是"消失的全局命令"。
    const items = resolveCommandDirectory(registry(), agents(), 's-unknown')
    expect(items.map(item => item.name)).toEqual(['export', 'goal'])
  })

  it('never drops a global command just because the session agent is missing', () => {
    // 真机 2026-10-22：斜杠面板里有时只剩 export/feedback/mnemon/permission，
    // /goal 整条不见 —— 那一次 agent 还没建起来，目录退回了 plain 视角。
    // 现在两份取并集：全局的一律在，agent 视角额外给的也补上。
    const globalOnly = (): CommandRegistry => ({
      list: () => [{ name: 'export', description: 'Download this Session log as a ZIP archive' }],
      execute: async () => undefined,
    })
    const withAgentRows = (): CommandRegistry => ({
      list: (agent: unknown) => agent === undefined
        ? [{ name: 'export', description: 'Download this Session log as a ZIP archive' }]
        : [{ name: 'plan', description: 'Enter or leave plan mode' }, { name: 'goal', description: 'set or view the goal' }],
      execute: async () => undefined,
    })
    // 会话冷：全局那几条一条都不能少。
    expect(resolveCommandDirectory(globalOnly(), agents(), 's-unknown').map(item => item.name)).toEqual(['export'])
    // 会话热：agent 视角里没有 export，也要从全局视角补回来。
    expect(resolveCommandDirectory(withAgentRows(), agents(), 's-live').map(item => item.name)).toEqual(['export', 'goal', 'plan'])
  })

  it('falls back to the plain-context view without a session id', () => {
    const items = resolveCommandDirectory(registry(), agents(), undefined)
    expect(items.map(item => item.name)).toEqual(['export', 'goal'])
  })

  it('falls back to the plain-context view when the agent service is not composed', () => {
    const items = resolveCommandDirectory(registry(), undefined, 's-live')
    expect(items.map(item => item.name)).toEqual(['export', 'goal'])
  })

  it('fills a cold session from the last complete agent view, so /plan does not vanish', () => {
    // 真机 2026-10-22：当前会话有 /goal、/plan，换个会话就只剩全局几条 —— 那些历史会话
    // 没有活的 agent，目录退回了 plain 视角。命令目录本身不随会话变（plan mode 除外）。
    resetCommandDirectoryCache()
    // 先在一个"热"会话里见到完整视角。
    expect(resolveCommandDirectory(registry(), agents(), 's-live').map(item => item.name)).toEqual(['compact', 'export', 'goal', 'plan'])
    // 冷会话：/plan、/compact 也要在。
    expect(resolveCommandDirectory(registry(), agents(), 's-cold').map(item => item.name)).toEqual(['compact', 'export', 'goal', 'plan'])
    // 没见过的 agent 视角之前，冷会话只有全局那几条，不会凭空编。
    resetCommandDirectoryCache()
    expect(resolveCommandDirectory(registry(), agents(), 's-cold').map(item => item.name)).toEqual(['export', 'goal'])
  })

  it('returns an empty directory when the command registry is not composed', () => {
    expect(resolveCommandDirectory(undefined, agents(), 's-live')).toEqual([])
  })
})


describe('turnVerdict (abandoned open boundary)', () => {
  // 真机上"会话早就跑完了，却突然又冒出输出中"的来源：一轮死在半路没写 turn/end，
  // 那条 turn/start 边界会永远开着。
  const now = 1_800_000_000_000

  it('keeps a turn that is still writing events', () => {
    expect(turnVerdict({ boundaryOpen: true, lastEventAt: now - 3_000, live: false, now }))
      .toEqual({ running: true, abandoned: false })
  })

  it('keeps a silent long command that the host still reports as running', () => {
    // 超大编译可以几十分钟不写事件，但开跑时的状态帧已经把它放进运行集合。
    expect(turnVerdict({ boundaryOpen: true, lastEventAt: now - 40 * 60_000, live: true, now }))
      .toEqual({ running: true, abandoned: false })
  })

  it('drops a boundary whose session died hours ago', () => {
    // 那一轮开始得比当前宿主进程还早 ⇒ 宿主重启过，回合必然没了。
    expect(turnVerdict({ boundaryOpen: true, lastEventAt: now - 8.3 * 3_600_000, live: false, turnStartedBeforeHost: true, now }))
      .toEqual({ running: false, abandoned: true })
  })

  it('gives up on a restart-killed turn after three minutes of silence', () => {
    // 30 分钟意味着手机上要盯着一个死掉的秒表半小时，然后还显示「已完成」。
    // 硬证据：这一轮开始得比宿主进程还早（重启杀掉了它，也没写 turn/end）。
    expect(turnVerdict({ boundaryOpen: true, lastEventAt: now - 5 * 60_000, live: false, turnStartedBeforeHost: true, now }))
      .toEqual({ running: false, abandoned: true })
  })

  it('长回合静默几分钟、宿主也没说过它停了：仍然算在跑（输出中不许闪）', () => {
    // 真机：编译 / 跑测试时日志能静默好几分钟。以前只凭「运行集合里没有它」就判收工，
    // 于是「输出中」消失、过程条秒表停住，下一条事件到了又冒出来 —— 时有时无。
    expect(turnVerdict({ boundaryOpen: true, lastEventAt: now - 8 * 60_000, live: false, now }))
      .toEqual({ running: true, abandoned: false })
  })

  it('宿主明确说过没在跑 + 静默超过阈值：才判死在半路', () => {
    expect(turnVerdict({ boundaryOpen: true, lastEventAt: now - 5 * 60_000, live: false, liveConfirmedIdle: true, now }))
      .toEqual({ running: false, abandoned: true })
  })

  it('keeps the benefit of the doubt for the first minutes', () => {
    expect(turnVerdict({ boundaryOpen: true, lastEventAt: now - 60_000, live: false, now }))
      .toEqual({ running: true, abandoned: false })
  })

  it('drops a boundary left over from two months ago', () => {
    expect(turnVerdict({ boundaryOpen: true, lastEventAt: now - 65 * 86_400_000, live: false, turnStartedBeforeHost: true, now }))
      .toEqual({ running: false, abandoned: true })
  })

  it('never invents a turn when the boundary is closed', () => {
    expect(turnVerdict({ boundaryOpen: false, lastEventAt: now - 1, live: true, now }))
      .toEqual({ running: false, abandoned: false })
  })

  it('treats an UNKNOWN boundary as "still running" when the session is alive', () => {
    // 一跑得久（几十步、几千帧）时 turn/start 会被挤出折叠窗口；宿主刚重启过镜像也是
    // 空的。真机表现就是命令还在跑、过程框写着已完成，而且每十秒核对一次都这么答。
    // 边界读不到只是"不知道"，不能当成收工。
    expect(turnVerdict({ boundaryOpen: false, boundaryKnown: false, lastEventAt: now - 1, live: true, now }))
      .toEqual({ running: true, abandoned: false })
    // 集合可能滞后：日志三分钟内还在动也算活着。
    expect(turnVerdict({ boundaryOpen: false, boundaryKnown: false, lastEventAt: now - 30_000, live: false, now }))
      .toEqual({ running: true, abandoned: false })
    // 彻底静默、集合里也没有它：这才判收工。
    expect(turnVerdict({ boundaryOpen: false, boundaryKnown: false, lastEventAt: now - 10 * 60_000, live: false, now }))
      .toEqual({ running: false, abandoned: false })
  })

  it('keeps the benefit of the doubt when the log carries no event time', () => {
    expect(turnVerdict({ boundaryOpen: true, live: false, now }).running).toBe(true)
  })
})

describe('noteRunningFrame verdicts', () => {
  // 手机端的运行状态与桌面端同源：宿主在轮次边界直接把结论推过去，手机不再自己
  // 拿日志边界去猜（猜错就会把还在跑的回合显示成已完成）。
  it('reports every turn boundary so the host can push session/status', () => {
    expect(noteRunningFrame({ payload: { type: 'session/event', sessionId: 's-push', event: { type: 'turn/start', seq: 5, time: 1 } } }))
      .toEqual({ sessionId: 's-push', running: true })
    expect(noteRunningFrame({ payload: { type: 'session/event', sessionId: 's-push', event: { type: 'turn/end', seq: 6, time: 2 } } }))
      .toEqual({ sessionId: 's-push', running: false })
  })

  it('stays quiet for frames that are not a boundary', () => {
    // 普通事件不是边界：多推一帧就是白让手机重渲染一次。
    expect(noteRunningFrame({ payload: { type: 'session/event', sessionId: 's-push', event: { type: 'assistant/message', seq: 7 } } }))
      .toBeUndefined()
    expect(noteRunningFrame({ payload: { type: 'session/status', sessionId: 's-push', running: true } }))
      .toBeUndefined()
    expect(noteRunningFrame({ payload: { type: 'session/event' } }))
      .toBeUndefined()
  })
})
describe('mobile method fence', () => {
  it('exposes subagent.list so the phone subagent badge has data', () => {
    // 实测过：不在名单里时 /m/api/subagent.list 直接 403，手机上的子代理徽标
    // 和树永远是空的（而宿主那边有数据）。这是名单漏项，不是宿主没有。
    expect(MOBILE_ALLOWLIST.has('subagent.list')).toBe(true)
  })

  it('keeps desktop-only writes out of the phone reach', () => {
    // 名单只收窄：这些一旦被放行，手机就等于拿到了桌面端的写入口。
    for (const method of ['settings.set', 'plugin.install', 'key.write', 'session.delete']) {
      expect(MOBILE_ALLOWLIST.has(method)).toBe(false)
    }
  })

  it('pins the wire name the phone calls for goal actions', () => {
    // 桌面端那条 ⏸ 只是撤授权，durable 相位保持 active；命令行的 `/goal pause`
    // 却把相位改成 paused。手机必须走服务（mobile.goalAction），否则语义对不上。
    // 这个名字是客户端 api.ts 与插件之间的契约，改名要两端一起改。
    expect(MOBILE_GOAL_ACTION_METHOD).toBe('mobile.goalAction')
    // 它是插件本地方法，不经宿主代理，所以不该出现在宿主方法名单里。
    expect(MOBILE_ALLOWLIST.has('mobile.goalAction')).toBe(false)
  })
})

/** 一个记录调用顺序的假目标服务（`ctx.goals` 的最小面）。 */
function goalService(views: {
  current?: { id: string; revision: number; phase: string; objective: string; activation?: 'armed' | 'disarmed' }
}): { service: GoalLookup; calls: string[] } {
  const calls: string[] = []
  const view = views.current
  const next = (activation: 'armed' | 'disarmed', phase = 'active'): never => {
    const value = { id: 'g1', revision: (view?.revision ?? 1) + 1, phase, objective: view?.objective ?? 'x', activation }
    return value as never
  }
  const service: GoalLookup = {
    get: () => {
      calls.push('get')
      return view
    },
    pause: (_agent, ref) => {
      calls.push(`pause:${ref.id}@${ref.revision}`)
      return next('disarmed')
    },
    resume: (_agent, ref) => {
      calls.push(`resume:${ref.id}@${ref.revision}`)
      return next('armed')
    },
    edit: (_agent, ref, request) => {
      calls.push(`edit:${ref.id}@${ref.revision}:${request.objective}`)
      return { id: 'g1', revision: ref.revision + 1, phase: 'active', objective: request.objective, activation: 'armed' } as never
    },
    clear: (_agent, ref) => {
      calls.push(`clear:${ref.id}@${ref.revision}`)
      return { id: ref.id, revision: ref.revision + 1 }
    },
  }
  return { service, calls }
}

describe('goal snapshot from the live goal service', () => {
  const agent = { id: 'agent-1' }
  const view = { id: 'g1', revision: 2, phase: 'active', objective: '做个测试', activation: 'armed' as const }
  /** 只实现 get 的目标服务替身，其余动作这里用不到。 */
  const goalsWith = (get: () => typeof view | undefined) => ({
    get,
    pause: () => view,
    resume: () => view,
    edit: () => view,
    clear: () => undefined,
  })

  it('asks the goal service instead of the stale roster snapshot', () => {
    // 真机 2026-10-22：会话里刚 `/goal 做个测试`，宿主回了 Goal created，手机上却没有
    // 目标条 —— 因为它读的是花名册快照里的 goal 投影，那份快照根本没刷新。
    const deps = { agents: { get: () => agent }, goals: goalsWith(() => view) }
    expect(goalSnapshotOf(deps, 's-1')).toEqual({ current: view })
  })

  it('reports an empty goal when the service has none, so the bar disappears', () => {
    const deps = { agents: { get: () => agent }, goals: goalsWith(() => undefined) }
    expect(goalSnapshotOf(deps, 's-1')).toEqual({ current: null })
  })

  it('prefers the live value over the stale snapshot, and only falls back when it cannot ask', () => {
    // 这条防的是"宿主端改了、handler 忘了用"：只要现取问得到，就绝不能再拿快照顶上。
    const live = { current: view }
    expect(preferLiveGoal(live, { current: null })).toBe(live)
    expect(preferLiveGoal({ current: null }, { current: view })).toEqual({ current: null })
    // 问不到（undefined）才退回快照。
    expect(preferLiveGoal(undefined, { current: view })).toEqual({ current: view })
  })

  it('falls back (undefined) when the service is missing, the session is cold, or it throws', () => {
    // undefined = "问不到"，调用方回退快照/现读日志；不能把没装服务当成"没有目标"。
    expect(goalSnapshotOf({}, 's-1')).toBeUndefined()
    expect(goalSnapshotOf({ agents: { get: () => undefined }, goals: goalsWith(() => view) }, 's-1')).toBeUndefined()
    expect(goalSnapshotOf({ agents: { get: () => agent }, goals: goalsWith(() => { throw new Error('cold') }) }, 's-1')).toBeUndefined()
  })
})

describe('inbox snapshot staleness', () => {
  const pending = { 'next-turn': [{ id: 'q1' }] }

  it('re-reads the host while the snapshot still shows a pending row', () => {
    // 真机：桌面端点的那条排队消息已经发出去了，手机卡片还挂着。快照里的 inbox 只在
    // 枚举会话时刷新，投递不会改它 —— 所以"快照里还有待发项"本身就是现读的理由。
    expect(shouldRefreshInbox(pending, 1_000, null)).toBe(true)
    // 节流：4 秒内不重复开 follow（手机每 5 秒轮询，真读最多 4 秒一次）。
    expect(shouldRefreshInbox(pending, 1_000, 1_000)).toBe(false)
    expect(shouldRefreshInbox(pending, 4_999, 1_000)).toBe(false)
    expect(shouldRefreshInbox(pending, 5_000, 1_000)).toBe(true)
  })

  it('does not touch the host when the snapshot is empty or shapeless', () => {
    // 没有待发项就没什么可核对的：轮询读快照就够，不必每次都读宿主。
    expect(shouldRefreshInbox({ 'next-turn': [] }, 9_999_999, null)).toBe(false)
    expect(shouldRefreshInbox(null, 9_999_999, null)).toBe(false)
    expect(shouldRefreshInbox(undefined, 9_999_999, null)).toBe(false)
    expect(shouldRefreshInbox({ 'next-turn': 'oops' }, 9_999_999, null)).toBe(false)
  })
})

describe('goal actions and activation', () => {
  const agent = { session: { id: 's-live' } }
  const agents: AgentLookup = { get: (sessionId: string) => sessionId === 's-live' ? agent : undefined }
  const current = { id: 'g1', revision: 3, phase: 'active', objective: '修复 DP523', activation: 'disarmed' as const }

  it('reports the process-local activation the wire projection leaves out', () => {
    const { service, calls } = goalService({ current })
    expect(goalActivationOf({ agents, goals: service }, 's-live')).toBe('disarmed')
    // 用会话现查到的 agent 去问服务，而不是自己造一个。
    expect(calls).toEqual(['get'])
    // 会话没有活着的 agent / 服务没装 / 服务抛错：一律"未知"，不抛给调用方。
    expect(goalActivationOf({ agents, goals: service }, 's-gone')).toBeUndefined()
    expect(goalActivationOf({ agents }, 's-live')).toBeUndefined()
    expect(goalActivationOf({ agents, goals: { ...service, get: () => { throw new Error('boom') } } }, 's-live')).toBeUndefined()
  })

  it('maps pause/resume/edit/clear onto the service with the CURRENT revision', () => {
    // 暂停 = 撤授权，返回的视图激活态是 disarmed（相位仍 active）。
    const pause = goalService({ current })
    expect(applyGoalAction({ agents, goals: pause.service }, 's-live', 'pause'))
      .toMatchObject({ ok: true, activation: 'disarmed', goal: { phase: 'active' } })
    expect(pause.calls).toEqual(['get', 'pause:g1@3'])

    const resume = goalService({ current })
    expect(applyGoalAction({ agents, goals: resume.service }, 's-live', 'resume'))
      .toMatchObject({ ok: true, activation: 'armed' })
    expect(resume.calls).toEqual(['get', 'resume:g1@3'])

    const edit = goalService({ current })
    expect(applyGoalAction({ agents, goals: edit.service }, 's-live', 'edit', '改过的目标'))
      .toMatchObject({ ok: true, goal: { objective: '改过的目标' } })
    expect(edit.calls).toEqual(['get', 'edit:g1@3:改过的目标'])

    const clear = goalService({ current })
    expect(applyGoalAction({ agents, goals: clear.service }, 's-live', 'clear')).toEqual({ ok: true })
    expect(clear.calls).toEqual(['get', 'clear:g1@3'])
  })

  it('answers with a routable reason instead of throwing when it cannot act', () => {
    expect(applyGoalAction({ agents }, 's-live', 'pause')).toMatchObject({ ok: false, code: 'unavailable' })
    expect(applyGoalAction({ agents, goals: goalService({ current }).service }, 's-gone', 'pause'))
      .toMatchObject({ ok: false, code: 'unavailable' })
    expect(applyGoalAction({ agents, goals: goalService({}).service }, 's-live', 'pause'))
      .toMatchObject({ ok: false, code: 'no-current-goal' })
    const throwing = goalService({ current })
    expect(applyGoalAction({ agents, goals: { ...throwing.service, pause: () => { throw new Error('目标版本已过期') } } }, 's-live', 'pause'))
      .toMatchObject({ ok: false, code: 'goal-action-failed', message: '目标版本已过期' })
  })
})

describe('queueItemsOf: 两种 inbox 形状', () => {
  it('投影行（裸 UserMessage）也要取到正文 —— 以前只认 message.content，界面上就是空白行', () => {
    const items = queueItemsOf({
      'next-turn': [
        { id: 'm1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '第一条排队消息' }] },
        { id: 'm2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '第二条排队消息' }] },
      ],
    })
    expect(items.map(item => item.text)).toEqual(['第一条排队消息', '第二条排队消息'])
    expect(items.every(item => item.editable)).toBe(true)
  })

  it('session/queue 帧形状（message.content）仍然可用', () => {
    const items = queueItemsOf({
      'next-turn': [{ id: 'q1', placement: 'queued', message: { content: [{ type: 'text', text: '帧形状' }] } }],
    })
    expect(items[0]).toMatchObject({ id: 'q1', placement: 'queued', text: '帧形状', editable: true })
  })

  it('只带图片的排队项也能编辑正文：图片原样保留（keepParts）', () => {
    const items = queueItemsOf({
      'next-turn': [{ id: 'm3', content: [{ type: 'image', attachmentId: 'img-1' }] }],
    })
    expect(items[0]?.text).toBe('[图片]')
    expect(items[0]?.editable).toBe(true)
    expect(items[0]?.keepParts).toEqual([{ type: 'image', attachmentId: 'img-1' }])
  })

  it('认不出的块类型才判为不可编辑（不敢拼回去）', () => {
    const items = queueItemsOf({
      'next-turn': [{ id: 'm4', content: [{ type: 'text', text: '你好' }, { type: 'audio', data: 'xx' }] }],
    })
    expect(items[0]?.editable).toBe(false)
  })
})

describe('countPromptFileParts：宿主侧的文件附件上限', () => {
  it('只数 file 部分，图片/text 不算', () => {
    expect(countPromptFileParts({ content: [
      { type: 'text', text: '看这几个文件' },
      { type: 'image', attachmentId: 'a1' },
      { type: 'file', receiptId: 'r1' },
      { type: 'file', receiptId: 'r2' },
    ] })).toBe(2)
  })

  it('没有 content / 畸形 payload 一律当 0，不抛', () => {
    expect(countPromptFileParts(undefined)).toBe(0)
    expect(countPromptFileParts(null)).toBe(0)
    expect(countPromptFileParts({})).toBe(0)
    expect(countPromptFileParts({ content: 'not-an-array' })).toBe(0)
    expect(countPromptFileParts({ content: [null, 42, 'x'] })).toBe(0)
  })

  it('上限是 5：6 个就要被拒', () => {
    const content = Array.from({ length: MAX_PROMPT_FILE_PARTS + 1 }, (_, index) => ({ type: 'file', receiptId: `r${index}` }))
    expect(countPromptFileParts({ content })).toBeGreaterThan(MAX_PROMPT_FILE_PARTS)
    const ok = content.slice(0, MAX_PROMPT_FILE_PARTS)
    expect(countPromptFileParts({ content: ok })).toBe(MAX_PROMPT_FILE_PARTS)
  })
})

describe('queueItemsOf：附件排队项的编辑能力（P2-1）', () => {
  it('正文 + 文件：可编辑，文件收据留给拼回（receipts / keepParts）', () => {
    const items = queueItemsOf({
      'next-turn': [{
        id: 'm5',
        content: [
          { type: 'text', text: '看下这个' },
          { type: 'file', receiptId: 'rc-1' },
          { type: 'file', receiptId: 'rc-2' },
        ],
      }],
    })
    expect(items[0]?.editable).toBe(true)
    expect(items[0]?.receipts).toEqual(['rc-1', 'rc-2'])
    expect(items[0]?.keepParts).toEqual([
      { type: 'file', receiptId: 'rc-1' },
      { type: 'file', receiptId: 'rc-2' },
    ])
  })

  it('纯文本项不带 keepParts / receipts（省得界面多出空字段）', () => {
    const items = queueItemsOf({ 'next-turn': [{ id: 'm6', content: [{ type: 'text', text: '你好' }] }] })
    expect(items[0]?.editable).toBe(true)
    expect(items[0]?.receipts).toBeUndefined()
    expect(items[0]?.keepParts).toBeUndefined()
  })
})

describe('「刚结束」账本（宿主侧持久化）', () => {
  const now = 1_700_000_000_000
  const entry = (sessionId: string, finishedAt = now - 1_000): FinishedRunEntry => ({
    sessionId,
    title: sessionId,
    finishedAt,
    status: 'done',
  })

  it('同一会话只留最新一条（客户端与另一个设备先后上报也不重复）', () => {
    const merged = mergeFinishedRuns([entry('s-1', now - 5_000)], [entry('s-1', now - 1_000)], now)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.finishedAt).toBe(now - 1_000)
  })

  it('过期的条目扔掉（现在是 7 天口径：剔除靠「打开过就删」）', () => {
    // 口径变了：运行中页的「刚结束」= 我没点进去看过的会话，所以半小时不再算过期。
    const recent = mergeFinishedRuns([entry('s-half-hour', now - 31 * 60_000)], [entry('s-new', now - 1_000)], now)
    expect(recent.map(row => row.sessionId).sort()).toEqual(['s-half-hour', 's-new'])
    const stale = mergeFinishedRuns([entry('s-old', now - 8 * 24 * 60 * 60_000)], [entry('s-new', now - 1_000)], now)
    expect(stale.map(row => row.sessionId)).toEqual(['s-new'])
  })

  it('按收工时刻倒序，最多 60 条', () => {
    const many = Array.from({ length: 80 }, (_, index) => entry(`s-${index}`, now - index * 1_000))
    const merged = mergeFinishedRuns([], many, now)
    expect(merged).toHaveLength(60)
    expect(merged[0]?.sessionId).toBe('s-0')
    expect(merged[59]?.sessionId).toBe('s-59')
  })

  it('文件不存在 / 是坏 JSON → 当空账本，不抛', () => {
    expect(readFinishedRuns(undefined, now)).toEqual([])
    expect(readFinishedRuns('C:/definitely/not/here/finished-runs.json', now)).toEqual([])
  })
})
