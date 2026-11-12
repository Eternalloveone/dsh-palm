import { describe, expect, it } from 'vitest'
import { queueItemsOf } from './queue-inbox.ts'

/**
 * 2026-11-10 真机：「排队消息都已经发送了，显示还有残留」。
 *
 * 根因是宿主 inbox 里同一条消息同时挂在 `next-turn` 与 `next-step`：投影层不合并，
 * 手机端就同时画「1 条排队」和「已插入 1 条补充消息」。修法放在**投影层**，
 * 所有客户端（含未更新的老 bundle）都拿到干净的一份。
 */
describe('queueItemsOf 合并 next-turn / next-step', () => {
  const row = (id: string, text: string): { id: string; message: { content: Array<{ type: string; text: string }> } } => ({
    id,
    message: { content: [{ type: 'text', text }] },
  })

  it('同文既在 next-turn 又在 next-step：只留 steering 那一份', () => {
    const text = '过程条右侧的这个圆环，可以删掉'
    const items = queueItemsOf({
      'next-turn': [row('q1', text)],
      'next-step': [row('q1', text)],
    })
    expect(items.map(item => item.placement)).toEqual(['steering'])
    expect(items).toHaveLength(1)
  })

  it('不同正文的两条各自保留（合并只针对同一条消息）', () => {
    const items = queueItemsOf({
      'next-turn': [row('q1', '先把测试跑完')],
      'next-step': [row('q2', '再改一下文案')],
    })
    expect(items.map(item => item.placement)).toEqual(['queued', 'steering'])
  })

  it('只有 next-turn：一条不少', () => {
    const items = queueItemsOf({ 'next-turn': [row('q1', '排队中')] })
    expect(items.map(item => item.placement)).toEqual(['queued'])
  })
})
