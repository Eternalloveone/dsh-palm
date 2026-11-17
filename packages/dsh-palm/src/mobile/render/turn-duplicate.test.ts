/**
 * 同一轮被画成两张过程条（2026-11-16 冷启动真机两次复现）。
 *
 * 现场一：一张绿点「33 次工具调用 · 改 5 个文件 / 13:44」，一张红点「15 次 · 65分58秒」。
 * 现场二：两张**都是绿点**、标题都叫「成了」：「33 次 · 13:44」与「17 次 · 14:45」。
 *
 * 宿主日志里那一轮只有 18 次工具调用，所以两份都不是它的全量 —— 是**窗口切片不同**的两份
 * 行：页/缓存那份带 turn/end，实时折出来那份可能还在等收工，也可能同样已收工。id、seq
 * 区间、turn+step 全对不上，`dedupeSameStep` / `collapseDuplicateRows` / `dedupeById` 都认不出。
 *
 * 规则：渲染后一轮只该有一行，所以同 turn **不看状态、不看 seq，直接收一行**。
 */
import { describe, expect, it } from 'vitest'
import {
  collapseDuplicateRows,
  dedupeById,
  dedupeSameStep,
  mergeSameTurnRows,
  preferRicherRows,
  renderRows,
} from './messages.ts'
import type { RenderMessage } from '../projections/types.ts'

/** 造一条 assistant 行（只写判据用得上的字段）。 */
function row(over: Partial<RenderMessage> & { id: string }): RenderMessage {
  return { kind: 'assistant', text: '', seq: 100, tools: [], ...over } as unknown as RenderMessage
}

/** 一个已完成 / 运行中的工具调用。 */
const tool = (callId: string, state: 'ok' | 'running') => ({ callId, name: 'bash', state })

describe('同一轮只留一行', () => {
  it('一收工一在跑 → 收成一行，状态取收工那份', () => {
    const settled = row({
      id: 'page-10',
      turn: 10,
      step: 19,
      seq: 3947,
      tools: [tool('a', 'ok'), tool('b', 'ok')],
      time: 1000,
      durationMs: 60_000,
    })
    const running = row({ id: 'live-10', turn: 10, step: 3, seq: 3900, tools: [tool('c', 'running')], text: '还在跑' })
    const result = mergeSameTurnRows([settled, running])
    expect(result.rows).toHaveLength(1)
    expect(result.merged).toEqual([{ turn: 10, ids: ['page-10', 'live-10'], tools: [2, 1], running: [false, true] }])
    const kept = result.rows[0]!
    expect(kept.durationMs).toBe(60_000)
    expect((kept.tools ?? []).some(item => item.state === 'running')).toBe(false)
    // 内容取两者更全的：在跑那份的正文没丢。
    expect(kept.text).toContain('还在跑')
  })

  it('两张都收工（真机现场二：两个「成了」，33 次与 17 次）→ 收成一行，正文取全的', () => {
    const older = row({ id: 'half', turn: 10, step: 8, seq: 3900, tools: Array.from({ length: 33 }, (_, i) => tool(`a${i}`, 'ok')), text: '', durationMs: 5 * 60_000 })
    const newer = row({ id: 'whole', turn: 10, step: 19, seq: 3947, tools: Array.from({ length: 17 }, (_, i) => tool(`b${i}`, 'ok')), text: '最终正文', durationMs: 66 * 60_000 })
    const result = mergeSameTurnRows([older, newer])
    expect(result.rows).toHaveLength(1)
    expect(result.merged[0]?.turn).toBe(10)
    expect(result.merged[0]?.tools).toEqual([33, 17])
    expect(result.rows[0]?.text).toBe('最终正文')
    expect((result.rows[0]?.tools ?? []).some(item => item.state === 'running')).toBe(false)
  })

  it('两个都在跑 → 也收成一行（渲染后一轮只有一行是硬契约）', () => {
    const first = row({ id: 'r1', turn: 10, step: 1, tools: [tool('a', 'running')] })
    const second = row({ id: 'r2', turn: 10, step: 2, tools: [tool('b', 'running')], text: '更长' })
    const result = mergeSameTurnRows([first, second])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.text).toBe('更长')
    // 仍在跑的行保持 running（不能凭空标成收工）。
    expect((result.rows[0]?.tools ?? []).some(item => item.state === 'running')).toBe(true)
  })

  it('不同轮互不影响', () => {
    const a = row({ id: 'a', turn: 9, tools: [tool('a', 'ok')], durationMs: 5 })
    const b = row({ id: 'b', turn: 10, tools: [tool('b', 'running')] })
    const result = mergeSameTurnRows([a, b])
    expect(result.rows.map(item => item.id)).toEqual(['a', 'b'])
    expect(result.merged).toEqual([])
  })

  it('没有轮号的行原样留下（用户行 / 系统行）', () => {
    const user = row({ id: 'u1', kind: 'user', text: '继续' })
    const assistant = row({ id: 'a1', turn: 10, tools: [tool('a', 'ok')], durationMs: 3 })
    const result = mergeSameTurnRows([user, assistant])
    expect(result.rows.map(item => item.id)).toEqual(['u1', 'a1'])
  })

  it('三份同轮只留一行，明细把三份都记下来', () => {    const rows = [
      row({ id: 'x', turn: 7, tools: [tool('a', 'ok')] }),
      row({ id: 'y', turn: 7, tools: [tool('b', 'running')] }),
      row({ id: 'z', turn: 7, tools: [tool('c', 'ok')], text: '最全' }),
    ]
    const result = mergeSameTurnRows(rows)
    expect(result.rows).toHaveLength(1)
    expect(result.merged).toHaveLength(1)
    expect(result.merged[0]?.ids).toEqual(['x', 'y', 'z'])
    expect(result.rows[0]?.text).toBe('最全')
  })
})

describe('管线级：四道老判据全部失效，第五道才收得住', () => {
  it('两份切片的 id / seq 区间 / turn+step 互不相交 → 前四道放过，同轮收敛兜住', () => {
    // 真实形状：缓存/实时那份是一段早窗口（seq 3500..3600、step 3），页那份是整轮末尾
    // （seq 3915..4033、step 19）。两份都是 turn 10、都已收工，工具数也不同。
    const earlier = row({
      id: 'live-10',
      turn: 10,
      step: 3,
      startSeq: 3500,
      seq: 3600,
      tools: Array.from({ length: 33 }, (_, i) => tool(`live${i}`, 'ok')),
      text: '',
      durationMs: 5 * 60_000,
    })
    const pageRow = row({
      id: 'page-10',
      turn: 10,
      step: 19,
      startSeq: 3915,
      seq: 4033,
      tools: Array.from({ length: 17 }, (_, i) => tool(`page${i}`, 'ok')),
      text: '最终正文',
      durationMs: 66 * 60_000,
    })
    const merged = dedupeById(preferRicherRows(renderRows([earlier]), renderRows([pageRow])))
    const afterOldGates = [...dedupeSameStep(collapseDuplicateRows(merged))]
    // 复现：四道老判据都认不出，屏幕上就是两张卡。
    expect(afterOldGates.length).toBe(2)
    // 第五道：同轮收一行，正文与时间取更全的那份，工具数并集。
    const fixed = mergeSameTurnRows(afterOldGates)
    expect(fixed.rows.length).toBe(1)
    expect(fixed.rows[0]?.text).toBe('最终正文')
    expect(fixed.rows[0]?.durationMs).toBe(66 * 60_000)
    expect((fixed.rows[0]?.tools ?? []).length).toBeGreaterThanOrEqual(17)
  })
})
