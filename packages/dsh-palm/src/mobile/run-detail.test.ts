// @vitest-environment node
/** run-detail：尾页 → 卡片那几行字（动作/步数/已跑/最近活动/摘要）。 */
import { describe, expect, it } from 'vitest'
import type { ChatPage } from './api.ts'
import type { RenderMessage } from './messages.ts'
import {
  formatAgo,
  formatRunDuration,
  durationFromPage,
  runDetailFromPage,
  summaryFromPage,
} from './run-detail.ts'

const T0 = 1_700_000_000_000

function row(over: Partial<RenderMessage> & { id?: string } = {}): RenderMessage {
  return {
    id: over.id ?? 'r1',
    kind: over.kind ?? 'assistant',
    text: over.text ?? '',
    ...over,
  } as RenderMessage
}

function page(rows: RenderMessage[], over: Partial<ChatPage> = {}): ChatPage {
  return { rows, maxSeq: 5, hasMore: true, ...over }
}

describe('runDetailFromPage', () => {
  it('names the running tool with its argument summary', () => {
    const detail = runDetailFromPage(page([row({
      step: 7,
      turnStartAt: T0,
      time: T0 + 60_000,
      pending: true,
      tools: [{ callId: 'c1', name: 'bash', arguments: '{"command":"pnpm test"}', state: 'running' }],
    })], { lastEventAt: T0 + 61_000 }))
    expect(detail.action).toBe('运行命令')
    expect(detail.actionHint).toBe('pnpm test')
    expect(detail.step).toBe(7)
    expect(detail.turnStartAt).toBe(T0)
    expect(detail.lastEventAt).toBe(T0 + 61_000)
  })

  it('falls back to 生成回复中 while the model is streaming', () => {
    const detail = runDetailFromPage(page([row({ text: '半个回答', pending: true, turnStartAt: T0 })]))
    expect(detail.action).toBe('生成回复中')
    expect(detail.actionHint).toBeUndefined()
  })

  it('says 等待下一步 when the last tool already settled', () => {
    const detail = runDetailFromPage(page([row({
      pending: false,
      turnStartAt: T0,
      tools: [{ callId: 'c1', name: 'read', arguments: '{"path":"a.ts"}', state: 'ok' }],
    })]))
    expect(detail.action).toBe('等待下一步')
  })

  it('uses the page anchor when the row carries none (窗口里没有 turn/start)', () => {
    const detail = runDetailFromPage(page([row({ pending: true })], { turnStartAt: T0, lastEventAt: T0 + 5_000 }))
    expect(detail.turnStartAt).toBe(T0)
  })

  it('survives an undefined page', () => {
    expect(runDetailFromPage(undefined).action).toBe('等待输出')
  })
})

describe('durationFromPage / summaryFromPage', () => {
  it('prefers the frozen durationMs stamped at turn/end', () => {
    const detail = page([row({ durationMs: 519_000, turnStartAt: T0, time: T0 + 519_000 })])
    expect(durationFromPage(detail)).toBe(519_000)
  })

  it('derives the duration from the anchor when durationMs is absent', () => {
    expect(durationFromPage(page([row({ turnStartAt: T0, time: T0 + 300_000 })]))).toBe(300_000)
  })

  it('returns the first line of the last answer as the summary', () => {
    const detail = page([row({ text: '## 已经修好了\n第二行不用看' })])
    expect(summaryFromPage(detail)).toBe('已经修好了')
  })

  it('truncates a long summary', () => {
    const detail = page([row({ text: 'x'.repeat(120) })])
    expect(summaryFromPage(detail, 10)).toBe('xxxxxxxxxx…')
  })

  it('gives no summary for an empty answer', () => {
    expect(summaryFromPage(page([row({ text: '   ' })]))).toBeUndefined()
  })
})

describe('format helpers', () => {
  it('formats durations the way the process card does', () => {
    expect(formatRunDuration(519_000)).toBe('8分39秒')
    expect(formatRunDuration(41_000)).toBe('41秒')
    expect(formatRunDuration(3_725_000)).toBe('1小时2分5秒')
  })

  it('formats relative time', () => {
    expect(formatAgo(T0, T0 - 1_000)).toBe('刚刚')
    expect(formatAgo(T0, T0 - 12_000)).toBe('12 秒前')
    expect(formatAgo(T0, T0 - 120_000)).toBe('2 分钟前')
    expect(formatAgo(T0, T0 - 7_200_000)).toBe('2 小时前')
  })
})
