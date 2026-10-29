import { describe, expect, it } from 'vitest'

import { documentRows } from './mobile-api.ts'
import type { RenderMessage } from './mobile/messages.ts'

/** 只造 documentRows 会读到的字段，其余留空。 */
function assistant (patch: Partial<RenderMessage> & { id: string; seq: number; text: string }): RenderMessage {
  return { kind: 'assistant', time: 0, ...patch } as RenderMessage
}

describe('documentRows 只索引正文', () => {
  it('单步回合：整段文本就是正文，可定位到 answer 段', () => {
    const rows = documentRows([assistant({
      id: 'm1',
      seq: 10,
      text: '最终答案在这里',
      flow: [{ kind: 'text', text: '最终答案在这里', seq: 10 }],
    })])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ messageId: 'm1', seq: 10, partId: 'answer', text: '最终答案在这里', user: false })
  })

  it('多步回合：只索引最后一步（正文），前面的过程叙述进不了索引', () => {
    const rows = documentRows([assistant({
      id: 'm2',
      seq: 30,
      text: '先说一句过程叙述\n最后给出结论',
      stepSeqs: [20, 30],
      stepTexts: ['先说一句过程叙述', '最后给出结论'],
      flow: [
        { kind: 'text', text: '先说一句过程叙述', seq: 20 },
        { kind: 'reasoning', text: '想一想', seq: 25 },
        { kind: 'text', text: '最后给出结论', seq: 30 },
      ],
    })])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.text).toBe('最后给出结论')
    expect(rows[0]).toMatchObject({ seq: 30, partId: 'answer' })
  })

  it('推理链与代码块不进索引（搜得到却看不见的东西一律不索引）', () => {
    const rows = documentRows([assistant({
      id: 'm3',
      seq: 40,
      text: '看这段\n```ts\nconst hidden = 1\n```\n结论：没问题',
      flow: [{ kind: 'text', text: '看这段\n```ts\nconst hidden = 1\n```\n结论：没问题', seq: 40 }],
      reasoning: '内部推理不该被搜到',
    })])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.text).not.toContain('hidden')
    expect(rows[0]?.text).not.toContain('内部推理')
    expect(rows[0]?.text).toContain('结论：没问题')
  })

  it('运行中的行也按"已收尾"入库：索引内容不随流式状态漂移', () => {
    const running = assistant({
      id: 'm4',
      seq: 50,
      text: '第一段\n第二段',
      pending: true,
      stepSeqs: [50, 51],
      stepTexts: ['第一段', '第二段'],
      flow: [
        { kind: 'text', text: '第一段', seq: 50 },
        { kind: 'text', text: '第二段', seq: 51 },
      ],
    })
    expect(documentRows([running])[0]?.text).toBe('第二段')
  })

  it('用户消息照旧整段入库（正文就是他自己写的）', () => {
    const rows = documentRows([{
      id: 'u1',
      kind: 'user',
      text: '帮我看下这个问题',
      seq: 5,
      time: 0,
    } as RenderMessage])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ messageId: 'u1', seq: 5, text: '帮我看下这个问题', user: true })
  })

  it('用户消息带 partId=body：定位按坐标落，不在整行里找词', () => {
    const rows = documentRows([{
      id: 'u2',
      kind: 'user',
      text: '先别重启，等我确认',
      seq: 6,
      time: 0,
    } as RenderMessage])
    expect(rows[0]).toMatchObject({ partId: 'body' })
  })

  it('系统来源的 user 行不入库（手机上它不是用户发的正文）', () => {
    const rows = documentRows([{
      id: 's1',
      kind: 'user',
      sourceKind: 'system',
      text: '系统提示：会话已恢复',
      seq: 7,
      time: 0,
    } as unknown as RenderMessage])
    expect(rows).toHaveLength(0)
  })

  it('口径与渲染一一对应：入库文本必须出现在该 part 渲染的那段文字里', () => {
    const rows = documentRows([
      assistant({
        id: 'm9',
        seq: 90,
        text: '过程一句话\n最终答案：可以重启',
        stepSeqs: [80, 90],
        stepTexts: ['过程一句话', '最终答案：可以重启'],
        flow: [
          { kind: 'text', text: '过程一句话', seq: 80 },
          { kind: 'reasoning', text: '思考里也写了重启', seq: 85 },
          { kind: 'text', text: '最终答案：可以重启', seq: 90 },
        ],
      }),
      { id: 'u9', kind: 'user', text: '重启前先备份', seq: 70, time: 0 } as RenderMessage,
    ])
    const answer = rows.find(row => row.messageId === 'm9')
    const user = rows.find(row => row.messageId === 'u9')
    expect(answer).toMatchObject({ partId: 'answer', text: '最终答案：可以重启' })
    // 推理链里的同名词不在正文里，也不入库
    expect(answer?.text).not.toContain('思考里也写了重启')
    expect(user).toMatchObject({ partId: 'body', text: '重启前先备份' })
    // partId 必须是渲染端真实存在的节点名（answer / body / text-N），否则定位落空
    for (const row of rows) {
      if (row.partId !== undefined) expect(['answer', 'body']).toContain(row.partId)
    }
  })
})
