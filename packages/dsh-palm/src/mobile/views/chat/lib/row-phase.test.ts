import { describe, expect, it } from 'vitest'
import { isRowSettled, isRowSettledIn } from './row-phase.ts'
import type { RenderMessage } from '../../../render/messages.ts'

const row = (turn: number | undefined, pending = false): RenderMessage =>
  ({ id: `r${turn ?? 'x'}`, kind: 'assistant', text: '', turn, pending } as unknown as RenderMessage)

const ctx = {
  turnLive: true,
  abandonedTurn: undefined as number | undefined,
  runningTurn: 3 as number | undefined,
  newestLoadedTurn: 3 as number | undefined,
}

describe('行收工判据', () => {
  it('会话没在跑：任何一行都算收工', () => {
    expect(isRowSettled(row(3), { ...ctx, turnLive: false })).toBe(true)
  })

  it('被用户放弃的那一轮算收工（不继续数秒）', () => {
    expect(isRowSettled(row(3), { ...ctx, abandonedTurn: 3 })).toBe(true)
  })

  it('最新一轮没停：runningTurn 与行里最新轮取更大的那个', () => {
    expect(isRowSettled(row(3), ctx)).toBe(false)
    // 帧里的 runningTurn 落后于屏幕（断线重连）：仍按屏幕最新轮算
    expect(isRowSettled(row(5), { ...ctx, runningTurn: 3, newestLoadedTurn: 5 })).toBe(false)
    // 帧比屏幕新（新回合已开、行还没到）：按帧算，屏幕上的旧一轮收工
    expect(isRowSettled(row(3), { ...ctx, runningTurn: 4, newestLoadedTurn: 3 })).toBe(true)
  })

  it('缺轮号的行按 pending 判，不默认"在跑"', () => {
    expect(isRowSettled(row(undefined, true), ctx)).toBe(false)
    expect(isRowSettled(row(undefined, false), ctx)).toBe(true)
  })

  it('旧轮一律收工', () => {
    expect(isRowSettled(row(1), ctx)).toBe(true)
  })

  it('isRowSettledIn 现取"最新轮"：空列表时退化为"没在跑最新轮"', () => {
    expect(isRowSettledIn([], row(3), { turnLive: true, abandonedTurn: undefined, runningTurn: undefined })).toBe(true)
    expect(isRowSettledIn([row(3), row(4)], row(4), { turnLive: true, abandonedTurn: undefined, runningTurn: 2 })).toBe(false)
  })
})
