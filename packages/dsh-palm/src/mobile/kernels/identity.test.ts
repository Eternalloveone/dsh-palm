/**
 * Identity 内核的行为契约（W2-1）。
 *
 * master plan 的四条不变量在这里逐条落成断言。最要紧的是第 2 条：同一逻辑行从
 * 四个入口（实时帧 / 宿主历史页 / 本地缓存 / 重放）进来时，id 与 seq 各不相同，
 * 但 key 必须一致 —— 不一致就是手机上"每行出现两遍"的根因。
 */
import { describe, expect, it } from 'vitest'
import type { RenderMessage } from '../render/messages.ts'
import { normalizeTurnNumbers, rowKey } from './identity.ts'

/** 造一条助手行；只填测试关心的字段。 */
function row(partial: Partial<RenderMessage> & { id: string }): RenderMessage {
  return {
    kind: 'assistant',
    ...partial,
  } as RenderMessage
}

describe('rowKey', () => {
  it('同一逻辑行的四个入口给出同一个 key（id / seq 各不相同）', () => {
    const logical = { turn: 3, step: 2 }
    const live = row({ id: 'live-1', ...logical, seq: 99 })
    const history = row({ id: 'host-7', ...logical, seq: 5 })
    const cache = row({ id: 'cache-3', ...logical, seq: 1 })
    const replay = row({ id: 'export-42', ...logical, seq: 77 })

    const keys = new Set([live, history, cache, replay].map(rowKey))
    expect(keys.size).toBe(1)
    expect([...keys][0]).toBe('t3.2')
  })

  it('身份与数组下标无关：换个顺序 key 不变', () => {
    const rows = [
      row({ id: 'a', turn: 1, step: 1 }),
      row({ id: 'b', turn: 1, step: 2 }),
      row({ id: 'c', turn: 2, step: 1 }),
    ]
    const forward = rows.map(rowKey)
    const backward = [...rows].reverse().map(rowKey).reverse()
    expect(forward).toEqual(backward)
  })

  it('流式早期（有 turn 无 step）先算一个稳定身份，不按 seq 漂移', () => {
    const first = row({ id: 'x', turn: 3, seq: 10, pending: true })
    const chunk2 = row({ id: 'x', turn: 3, seq: 11, pending: true })
    expect(rowKey(first)).toBe('t3~')
    expect(rowKey(chunk2)).toBe('t3~')
    // 分步之后换成正式位置
    expect(rowKey(row({ id: 'x', turn: 3, step: 1 }))).toBe('t3.1')
  })

  it('交付卡按轮唯一（与同 seq 的助手行不冲突）', () => {
    const card = { kind: 'turn', turn: 4, seq: 50, id: 'card' } as RenderMessage
    const answer = row({ id: 'answer', turn: 4, seq: 50 })
    expect(rowKey(card)).toBe('turn4')
    expect(rowKey(answer)).not.toBe('turn4')
  })

  it('没有轮号才退 seq / startSeq / id', () => {
    expect(rowKey(row({ id: 'a', seq: 7 }))).toBe('s7')
    expect(rowKey(row({ id: 'b', startSeq: 4 }))).toBe('ss4')
    expect(rowKey(row({ id: 'c' }))).toBe('idc')
  })
})

describe('normalizeTurnNumbers', () => {
  it('缺轮号的助手行沿用上一条，遇到用户行即清空', () => {
    const rows = [
      row({ id: 'a', turn: 5, step: 1 }),
      row({ id: 'b', step: 2 }),
      { kind: 'user', id: 'u' } as RenderMessage,
      row({ id: 'c', step: 3 }),
    ]
    const filled = normalizeTurnNumbers(rows)
    expect(filled[1]?.turn).toBe(5)
    // 用户行之后没有可沿用的轮号，保持缺省
    expect(filled[3]?.turn).toBeUndefined()
  })

  it('没有需要补的行时返回原数组（保住引用）', () => {
    const rows = [row({ id: 'a', turn: 1, step: 1 }), row({ id: 'b', turn: 1, step: 2 })]
    expect(normalizeTurnNumbers(rows)).toBe(rows)
  })

  it('补齐后四个入口的 key 一致（不变量 4 → 不变量 2）', () => {
    const live = [row({ id: 'l', turn: 9, step: 1 }), row({ id: 'l2', step: 2, seq: 123 })]
    const history = [row({ id: 'h', turn: 9, step: 1 }), row({ id: 'h2', turn: 9, step: 2 })]
    const liveKeys = normalizeTurnNumbers(live).map(rowKey)
    const historyKeys = normalizeTurnNumbers(history).map(rowKey)
    expect(liveKeys).toEqual(historyKeys)
  })

  it('幂等：补两次与补一次结果相同', () => {
    const rows = [row({ id: 'a', turn: 2, step: 1 }), row({ id: 'b', step: 1 })]
    const once = normalizeTurnNumbers(rows)
    const twice = normalizeTurnNumbers(once)
    expect(twice.map(item => item.turn)).toEqual(once.map(item => item.turn))
  })
})
