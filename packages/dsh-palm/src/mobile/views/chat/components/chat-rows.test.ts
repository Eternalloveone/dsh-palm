/**
 * 行渲染的两条判定（S8b）：
 * ① dedupe —— 同一 id 的行只渲染一次（真机：重进正在跑的会话每行画两遍）；
 * ② 交付卡证据链 —— 在跑的那一轮绝不画交付卡，更早的、有收工证据的轮次才画。
 */
import { describe, expect, it } from 'vitest'
import type { RenderMessage } from '../../../render/messages.ts'
import { dedupeRows, shouldRenderCard } from './chat-rows.tsx'

const user = (id: string): RenderMessage => ({ kind: 'user', id, text: id } as unknown as RenderMessage)
const card = (id: string, turn: number): RenderMessage => ({ kind: 'turn', id, turn } as unknown as RenderMessage)

describe('dedupeRows', () => {
  it('同一行（同 id）只出现一次，顺序保持', () => {
    const rows = dedupeRows([user('a'), user('b'), user('a'), user('c')])
    expect(rows.map(row => row.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('shouldRenderCard（交付卡"已收工证据"链）', () => {
  const view = (over: Partial<Parameters<typeof shouldRenderCard>[1]> = {}) => ({
    running: true,
    activeTurn: 3,
    newestCardTurn: 3,
    hasClosedTurn: () => true,
    ...over,
  })

  it('在跑的那一轮：即使"有证据"也不画（真机 2026-11-01 复发的那条）', () => {
    expect(shouldRenderCard(card('t3', 3), view())).toBe(false)
  })

  it('更早的轮次：有收工证据就画；没证据（在跑、不知道）不画', () => {
    expect(shouldRenderCard(card('t2', 2), view({ hasClosedTurn: (turn) => turn === 2 }))).toBe(true)
    expect(shouldRenderCard(card('t2', 2), view({ hasClosedTurn: () => false, newestCardTurn: 3 }))).toBe(true)
    expect(shouldRenderCard(card('t2', 2), view({ activeTurn: undefined, hasClosedTurn: () => false, newestCardTurn: undefined }))).toBe(false)
  })

  it('没在跑：一律画（收工后的正常态）', () => {
    expect(shouldRenderCard(card('t3', 3), view({ running: false }))).toBe(true)
  })

  it('非交付卡的行不受这条链影响', () => {
    expect(shouldRenderCard(user('u1'), view())).toBe(true)
  })
})
