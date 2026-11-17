/**
 * 过程条卡只留在最近两轮（2026-11-16 真机：冷启动一屏 8 张过程条）。
 *
 * 现场：首屏那次提交带进来 70 多行、横跨 4000 多个 seq（实测 rawSpan=4123..8832），
 * 覆盖 8 个轮次；每轮按设计挂一张卡，于是屏幕上是一排「成了 51 次工具调用 / 运行命令 · …」。
 */
import { describe, expect, it } from 'vitest'
import { hideHistoricalProcessCards } from './messages.ts'
import type { RenderMessage } from '../projections/types.ts'

function assistant(turn: number, owner?: boolean): RenderMessage {
  return {
    kind: 'assistant',
    id: `a-${turn}`,
    turn,
    step: 1,
    text: `第 ${turn} 轮`,
    seq: turn,
    tools: [],
    ...(owner === undefined ? {} : { processCardOwner: owner }),
  } as unknown as RenderMessage
}

describe('hideHistoricalProcessCards', () => {
  it('保留最近两轮，更早的轮次不再画卡', () => {
    const rows = [assistant(1), assistant(2), assistant(3), assistant(4)]
    const out = hideHistoricalProcessCards(rows)
    const ownerOf = (turn: number): unknown => out.find(row => row.turn === turn)?.processCardOwner
    expect(ownerOf(1)).toBe(false)
    expect(ownerOf(2)).toBe(false)
    expect(ownerOf(3)).toBeUndefined()
    expect(ownerOf(4)).toBeUndefined()
  })

  it('只有一两轮时谁都不动', () => {
    const rows = [assistant(37), assistant(38)]
    const out = hideHistoricalProcessCards(rows)
    expect(out.every(row => row.processCardOwner === undefined)).toBe(true)
  })

  it('用户行与非助手行原样保留，函数可重复调用', () => {
    const user = { kind: 'user', id: 'u-1', text: '问题', seq: 1 } as unknown as RenderMessage
    const rows = [user, assistant(1), assistant(2), assistant(3)]
    const once = hideHistoricalProcessCards(rows)
    const twice = hideHistoricalProcessCards(once)
    expect(twice.map(row => row.id)).toEqual(once.map(row => row.id))
    expect(twice.find(row => row.id === 'u-1')?.text).toBe('问题')
  })
})
