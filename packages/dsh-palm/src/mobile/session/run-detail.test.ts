// @vitest-environment node
/** run-detail：尾页 → 「刚结束」那一行字（摘要 / 用时 / 时长文案）。 */
import { describe, expect, it } from 'vitest'
import type { ChatPage } from '../api.ts'
import type { RenderMessage } from '../render/messages.ts'
import {
  formatRunDuration,
  durationFromPage,
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
})
