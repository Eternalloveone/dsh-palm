/**
 * 复现 + 收敛：同一轮的"页面快照行"与"实时流行"被画两遍。
 *
 * 现场（2026-11-12 用户手机截图）：同一轮出现两条「静着 … 57分18秒」+ 两张过程卡，
 * 一张 119 次工具调用、一张 110 次 —— 是**两份不同时刻的快照**同时留在列表里。
 *
 * 这里先把成因钉死：`dedupeSameStep` 的身份键是 `t{turn}s{step}`，
 * 其中一边没有 turn 时键为 undefined，它直接放弃；再把新加的那道强证据屏障验一遍。
 */
import { describe, expect, it } from 'vitest'
import { collapseDuplicateRows, dedupeSameStep } from './messages.ts'
import type { RenderMessage } from '../projections/types.ts'

/** 造一条 assistant 行（只写这几个判据用得上的字段）。 */
function row(over: Partial<RenderMessage> & { id: string }): RenderMessage {
  return {
    kind: 'assistant',
    text: '',
    seq: 100,
    tools: [],
    ...over,
  } as unknown as RenderMessage
}

const tool = (callId: string): { callId: string; name: string; state: 'ok' } => ({
  callId,
  name: 'bash',
  state: 'ok',
})

describe('重复过程卡：强证据收敛', () => {
  it('现有 dedupeSameStep：「有轮号」+「没轮号」两份快照它拦不住（这正是真机现场）', () => {
    // 页面快照行：有 turn/step，工具 5 个。
    const snapshot = row({ id: 'page', turn: 7, step: 2, seq: 120, startSeq: 100, tools: ['a', 'b', 'c', 'd', 'e'].map(tool) })
    // 实时流行：同一批工具的前 3 个（少两次调用），但没有轮号。
    const live = row({ id: 'live', seq: 120, startSeq: 100, tools: ['a', 'b', 'c'].map(tool) })

    // dedupeSameStep 对 live 行拿不到键（turn undefined）→ 两行都留下。
    expect(dedupeSameStep([snapshot, live])).toHaveLength(2)
    // 新的一层按「共享 callId + seq 区间重叠」认出它们是同一份数据。
    expect(collapseDuplicateRows([snapshot, live])).toHaveLength(1)
  })

  it('收敛时保留信息更全的那份（工具多 / 正文长）', () => {
    const richer = row({ id: 'rich', turn: 7, step: 2, seq: 120, startSeq: 100, text: '全部结果', tools: ['a', 'b', 'c'].map(tool) })
    const poorer = row({ id: 'poor', turn: 7, step: 2, seq: 120, startSeq: 100, text: '', tools: ['a'].map(tool) })
    const out = collapseDuplicateRows([poorer, richer])
    expect(out).toHaveLength(1)
    expect(out[0]!.id).toBe('rich')
  })

  it('同一轮的相邻两步（seq 区间不重叠）不误伤', () => {
    const step1 = row({ id: 's1', turn: 7, step: 1, seq: 110, startSeq: 100, tools: ['a'].map(tool) })
    const step2 = row({ id: 's2', turn: 7, step: 2, seq: 130, startSeq: 120, tools: ['b'].map(tool) })
    expect(collapseDuplicateRows([step1, step2])).toHaveLength(2)
  })

  it('不同轮说同样的话（正文相同、seq 不同）不合并', () => {
    const first = row({ id: 'u1', turn: 3, text: '同样的一句话在这里', seq: 40 })
    const second = row({ id: 'u2', turn: 5, text: '同样的一句话在这里', seq: 90 })
    expect(collapseDuplicateRows([first, second])).toHaveLength(2)
  })

  it('三份快照（用户截图里的"两三次"）收敛成一份', () => {
    const one = row({ id: 'p1', turn: 7, step: 2, seq: 120, startSeq: 100, tools: ['a', 'b'].map(tool) })
    const two = row({ id: 'p2', turn: 7, step: 2, seq: 120, startSeq: 100, tools: ['a', 'b', 'c'].map(tool) })
    const three = row({ id: 'p3', seq: 120, startSeq: 100, tools: ['a'].map(tool) })
    expect(collapseDuplicateRows([one, two, three])).toHaveLength(1)
  })
})
