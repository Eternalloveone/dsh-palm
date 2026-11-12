// @vitest-environment node
/**
 * 折叠阶段要留住的两样东西（C1 详情面板的数据前提，2026-11-10）：
 * `tool/result` 的**输出正文**，以及调用/结果两个时刻（算耗时用）。
 *
 * 以前 fold 只取结果的 diff 视图，输出文本直接丢掉 —— 手机端详情面板因此没有
 * "这条命令印了什么"可看。
 */
import { describe, expect, it } from 'vitest'
import { EventFolder } from './messages.ts'
import type { WireEvent } from './messages.ts'

const event = (type: string, seq: number, time: number, data: unknown): WireEvent =>
  ({ type, seq, time, data })

const fold = (events: WireEvent[]) => new EventFolder().fold(events)

describe('工具输出与耗时进入 fold', () => {
  it('tool/result 的文字块变成 output，两个时刻都留在行上', () => {
    const rows = fold([
      event('turn/start', 1, 1_000, { turn: 0 }),
      event('tool/call', 2, 1_100, { turn: 0, step: 0, callId: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' }),
      event('tool/result', 3, 2_400, {
        turn: 0,
        step: 0,
        message: { source: { callId: 'c1' }, content: [{ type: 'text', text: 'a.txt\nb.txt' }] },
      }),
    ])
    const tools = rows.flatMap(row => row.tools ?? [])
    expect(tools).toHaveLength(1)
    const tool = tools[0]!
    expect(tool.state).toBe('ok')
    expect(tool.output).toBe('a.txt\nb.txt')
    expect(tool.startedAt).toBe(1_100)
    expect(tool.endedAt).toBe(2_400)
  })

  it('失败的结果：state=error，输出照样留着（错误正文就是线索）', () => {
    const rows = fold([
      event('turn/start', 1, 1_000, { turn: 0 }),
      event('tool/call', 2, 1_100, { turn: 0, step: 0, callId: 'c1', name: 'bash', arguments: '{"cmd":"false"}' }),
      event('tool/result', 3, 1_500, {
        turn: 0,
        step: 0,
        message: { isError: true, source: { callId: 'c1' }, content: [{ type: 'text', text: 'exit 1' }] },
      }),
    ])
    const tool = rows.flatMap(row => row.tools ?? [])[0]!
    expect(tool.state).toBe('error')
    expect(tool.output).toBe('exit 1')
  })

  it('结果没有文字块：output 不塞空串（面板据此不画「输出」段）', () => {
    const rows = fold([
      event('turn/start', 1, 1_000, { turn: 0 }),
      event('tool/call', 2, 1_100, { turn: 0, step: 0, callId: 'c1', name: 'read', arguments: '{"path":"a.txt"}' }),
      event('tool/result', 3, 1_200, { turn: 0, step: 0, message: { source: { callId: 'c1' }, content: [] } }),
    ])
    const tool = rows.flatMap(row => row.tools ?? [])[0]!
    expect(tool.state).toBe('ok')
    expect(tool.output).toBeUndefined()
  })

  it('结果里的 image 块折成 images（过程条要直接画缩略图）', () => {
    const rows = fold([
      event('turn/start', 1, 1_000, { turn: 0 }),
      event('tool/call', 2, 1_100, { turn: 0, step: 0, callId: 'c1', name: 'read_image', arguments: '{"path":"a.png"}' }),
      event('tool/result', 3, 1_200, {
        turn: 0,
        step: 0,
        message: {
          source: { callId: 'c1' },
          content: [
            { type: 'text', text: '看这张' },
            { type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png', width: 320, height: 200 } },
          ],
        },
      }),
    ])
    const tool = rows.flatMap(row => row.tools ?? [])[0]!
    expect(tool.images).toHaveLength(1)
    expect(tool.images?.[0]?.attachmentId).toBe('att-1')
    // 文字照旧进 output，图片不混进文本。
    expect(tool.output).toBe('看这张')
  })
})
