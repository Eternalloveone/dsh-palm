// @vitest-environment node
/**
 * 行高估值的两条不变量（2026-11-18 真机空白屏的根因）。
 *
 * 1. **长消息按折叠后的样子估**：用户气泡与助手行走同一个 `CollapsibleText`，全文估算
 *    会把 8,549 字的用户消息估成 4,978px（实际 ~300px），账本总高虚高 27%，靠行号判
 *    "贴底"的地方全部失准（滚到底被读成第 86 行，真实 112）。
 * 2. **图按张数补高**：图片是固定高的缩略图，漏掉它会让含图行被低估、滚动位置乱跳。
 */
import { describe, expect, it } from 'vitest'
import { estimateMessageHeight, messageKey } from './chat-layout.ts'
import { LONG_TEXT_LIMIT } from '../../../render/markdown-text.tsx'
import type { RenderMessage } from '../../../render/messages.ts'

const user = (text: string, extra: Partial<RenderMessage> = {}): RenderMessage =>
  ({ kind: 'user', id: 'u1', text, ...extra }) as RenderMessage

const assistant = (text: string, extra: Partial<RenderMessage> = {}): RenderMessage =>
  ({ kind: 'assistant', id: 'a1', text, ...extra }) as RenderMessage

describe('estimateMessageHeight：用户行', () => {
  it('一行字的短消息 = 28 + 一行（22）', () => {
    expect(estimateMessageHeight(user('要'))).toBe(50)
  })

  it('超过折叠阈值的长消息按预览行数估，不再按全文', () => {
    const long = 'x'.repeat(8_549)
    const height = estimateMessageHeight(user(long))
    // 全文估算会是 28 + 225*22 = 4,978；折叠后必须落在一屏量级。
    expect(height).toBeLessThan(600)
    expect(height).toBeGreaterThan(150)
  })

  it('刚好不超过阈值时仍按全文（与 UI 不折叠一致）', () => {
    const exact = 'x'.repeat(LONG_TEXT_LIMIT)
    // 不折叠就真占那么高：这里必须继续按全文估，否则会低估成一小条。
    expect(estimateMessageHeight(user(exact))).toBeGreaterThan(3_000)
    expect(estimateMessageHeight(user(exact))).toBeGreaterThan(
      estimateMessageHeight(user('x'.repeat(LONG_TEXT_LIMIT - 1_900))),
    )
  })

  it('图片按张数补高（一张 220）', () => {
    const withImage = user('要', { images: [{ url: 'a.png' }] as never })
    expect(estimateMessageHeight(withImage)).toBe(estimateMessageHeight(user('要')) + 220)
  })
})

describe('estimateMessageHeight：助手行与行键', () => {
  it('助手行长文本折叠后封顶在 12 行', () => {
    const height = estimateMessageHeight(assistant('x'.repeat(9_000)))
    expect(height).toBe(20 + 12 * 22 + 30 + 16)
  })

  it('行键优先用 turn/step（流式换 id 后不重挂）', () => {
    expect(messageKey({ kind: 'assistant', id: 'x', text: '', turn: 7, step: 2 } as RenderMessage)).toBe('t7.2')
    expect(messageKey({ kind: 'user', id: 'abc', text: '' } as RenderMessage)).toBe('abc')
  })
})
