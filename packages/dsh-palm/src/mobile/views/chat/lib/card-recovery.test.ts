import { describe, expect, it } from 'vitest'
import { turnReportsToRecover } from './card-recovery.ts'
import type { RenderMessage } from '../../../render/messages.ts'

/** 一条带已完成工具的助手行（会被 completedTurns 认成"这一轮收工了"）。 */
const done = (id: string, turn: number): RenderMessage =>
  ({ id, kind: 'assistant', text: '', turn, tools: [{ state: 'done' }] } as unknown as RenderMessage)
/** 这一轮的收尾行：带着真交付物即视为"页里已经有卡"（不算缺卡）。 */
const tail = (turn: number): RenderMessage =>
  ({ id: `turn-tail:${turn}`, kind: 'turn', turn, text: '', deliverables: [{ path: `f${turn}.txt` }] } as unknown as RenderMessage)

const base = {
  openTurn: undefined,
  liveClosed: new Set<number>(),
  now: 1_000,
  windowTurns: 2,
}

describe('交付卡补读判据', () => {
  it('这一轮没有卡 → 要补', () => {
    const rows = [done('a1', 3)]
    expect(turnReportsToRecover({ ...base, state: { cooling: new Map(), confirmed: new Set() }, rows })).toEqual([3])
  })

  it('亲眼见过 turn/end 的不补（卡本来就从实时事件折出来）', () => {
    const rows = [done('a1', 3)]
    const liveClosed = new Set([3])
    expect(turnReportsToRecover({ ...base, state: { cooling: new Map(), confirmed: new Set() }, rows, liveClosed })).toEqual([])
  })

  it('冷却中不补，到期后照补（防止失败重试打转）', () => {
    const rows = [done('a1', 3)]
    const cooling = new Map([[3, 5_000]])
    expect(turnReportsToRecover({ ...base, state: { cooling, confirmed: new Set() }, rows })).toEqual([])
    expect(turnReportsToRecover({ ...base, now: 5_000, state: { cooling, confirmed: new Set() }, rows })).toEqual([3])
  })

  it('卡在且已被日志确认过 → 不补（页里那版已经是真的）', () => {
    const rows = [done('a1', 3), tail(3)]
    expect(turnReportsToRecover({ ...base, state: { cooling: new Map(), confirmed: new Set([3]) }, rows })).toEqual([])
  })

  it('超出"最近 N 轮"的历史轮不补（避免翻历史时卡片一张张冒出来）', () => {
    const rows = [done('a1', 1), done('a2', 5)]
    // 只补 5 附近：1 与最新轮 5 差 4，超窗口
    expect(turnReportsToRecover({ ...base, state: { cooling: new Map(), confirmed: new Set() }, rows })).toEqual([5])
  })

  it('空列表 → 什么都不做', () => {
    expect(turnReportsToRecover({ ...base, state: { cooling: new Map(), confirmed: new Set() }, rows: [] })).toEqual([])
  })
})
