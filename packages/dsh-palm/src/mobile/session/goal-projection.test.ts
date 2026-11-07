/**
 * 目标投影的解析：宿主线上形状是 `{ current }`，桌面投影是 `{ goal }`，还有直接给
 * 快照的旧来路 —— 三种都要能吃下，而且不能把「已完成」误读成「进行中」。
 */
import { describe, expect, it } from 'vitest'
import {
  GOAL_CLEAR_COMMAND,
  GOAL_PAUSE_COMMAND,
  GOAL_RESUME_COMMAND,
  goalActions,
  goalEditCommand,
  goalPhaseLabel,
  parseGoalProjection,
} from './goal-projection.ts'

const snapshot = {
  id: 'g-1',
  revision: 3,
  objective: '把手机端目标条做出来',
  phase: 'active',
  maxGoalRounds: 4,
}

describe('parseGoalProjection', () => {
  it('reads the host wire shape ({ current })', () => {
    expect(parseGoalProjection({ current: snapshot })).toEqual({
      id: 'g-1',
      objective: '把手机端目标条做出来',
      phase: 'active',
      revision: 3,
    })
  })

  it('also reads the desktop projection shape ({ goal }) and a bare snapshot', () => {
    expect(parseGoalProjection({ goal: snapshot })?.id).toBe('g-1')
    expect(parseGoalProjection(snapshot)?.objective).toBe('把手机端目标条做出来')
  })

  it('treats complete, clear, empty objective and missing id as no goal at all', () => {
    // 条子出现再消失，比从不出现更像故障；所以这几种一律不渲染。
    expect(parseGoalProjection({ current: { ...snapshot, phase: 'complete' } })).toBeNull()
    expect(parseGoalProjection({ current: { ...snapshot, phase: 'clear' } })).toBeNull()
    expect(parseGoalProjection({ current: { ...snapshot, objective: '   ' } })).toBeNull()
    expect(parseGoalProjection({ current: { ...snapshot, id: '' } })).toBeNull()
    expect(parseGoalProjection({ current: null })).toBeNull()
    expect(parseGoalProjection(null)).toBeNull()
    expect(parseGoalProjection('nonsense')).toBeNull()
  })

  it('keeps the blocked reason so the phone can show why the goal stopped', () => {
    expect(parseGoalProjection({ current: { ...snapshot, phase: 'blocked', blockedReason: { code: 'GOAL_AGENT_NOT_LIVE', message: '代理不在线' } } }))
      .toMatchObject({ phase: 'blocked', blockedReason: '代理不在线' })
    expect(parseGoalProjection({ current: { ...snapshot, phase: 'blocked', blockedReason: '手动停止' } }))
      .toMatchObject({ blockedReason: '手动停止' })
  })

  it('ignores unknown phases instead of rendering a bar nobody can act on', () => {
    expect(parseGoalProjection({ current: { ...snapshot, phase: 'archived' } })).toBeNull()
  })
})

describe('goal bar copy and commands', () => {
  it('labels each phase the way the desktop does', () => {
    expect(goalPhaseLabel({ id: 'g', objective: 'x', phase: 'active' })).toBe('进行中的目标')
    // 撤授权但相位仍是 active：桌面端就写「已暂停的目标」，手机照抄。
    expect(goalPhaseLabel({ id: 'g', objective: 'x', phase: 'active', activation: 'disarmed' })).toBe('已暂停的目标')
    expect(goalPhaseLabel({ id: 'g', objective: 'x', phase: 'active', activation: 'armed' })).toBe('进行中的目标')
    expect(goalPhaseLabel({ id: 'g', objective: 'x', phase: 'paused' })).toBe('已暂停的目标')
    expect(goalPhaseLabel({ id: 'g', objective: 'x', phase: 'blocked' })).toBe('受阻的目标')
  })

  it('offers pause only while active, resume while paused or blocked', () => {
    expect(goalActions({ id: 'g', objective: 'x', phase: 'active' })).toEqual({ pause: true, resume: false, edit: true, clear: true })
    expect(goalActions({ id: 'g', objective: 'x', phase: 'paused' })).toEqual({ pause: false, resume: true, edit: true, clear: true })
    expect(goalActions({ id: 'g', objective: 'x', phase: 'blocked' })).toEqual({ pause: false, resume: true, edit: true, clear: true })
  })

  it('mirrors the desktop: a disarmed active goal offers resume, not pause', () => {
    // 桌面端那条 ⏸ 只是撤掉自动继续的授权，durable 相位仍是 active。只按相位判断
    // 就会在这种状态下继续显示「暂停」——用户报的就是这个。
    expect(goalActions({ id: 'g', objective: 'x', phase: 'active', activation: 'armed' }))
      .toEqual({ pause: true, resume: false, edit: true, clear: true })
    expect(goalActions({ id: 'g', objective: 'x', phase: 'active', activation: 'disarmed' }))
      .toEqual({ pause: false, resume: true, edit: true, clear: true })
    // 授权未知（宿主没装目标服务）时保住暂停，不凭空冒出恢复。
    expect(goalActions({ id: 'g', objective: 'x', phase: 'active' }))
      .toEqual({ pause: true, resume: false, edit: true, clear: true })
    // paused 相位下无论授权如何都是恢复。
    expect(goalActions({ id: 'g', objective: 'x', phase: 'paused', activation: 'armed' }))
      .toEqual({ pause: false, resume: true, edit: true, clear: true })
  })

  it('carries the activation the plugin read alongside the durable snapshot', () => {
    expect(parseGoalProjection({ current: { ...snapshot, phase: 'active' } }, 'disarmed'))
      .toMatchObject({ phase: 'active', activation: 'disarmed' })
    // 快照自带 activation 时也认（宿主将来若内联进来，不用改两端）。
    expect(parseGoalProjection({ current: { ...snapshot, phase: 'active', activation: 'armed' } }))
      .toMatchObject({ activation: 'armed' })
    // 两处都没有就留空，条子退回只看相位。
    expect(parseGoalProjection({ current: { ...snapshot, phase: 'active' } }))
      .not.toHaveProperty('activation')
  })

  it('builds the four /goal commands (edit collapses newlines)', () => {
    expect(GOAL_PAUSE_COMMAND).toBe('/goal pause')
    expect(GOAL_RESUME_COMMAND).toBe('/goal resume')
    expect(GOAL_CLEAR_COMMAND).toBe('/goal clear')
    expect(goalEditCommand('  第一行\n第二行  ')).toBe('/goal edit 第一行 第二行')
  })
})
