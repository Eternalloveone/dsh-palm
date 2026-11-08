// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MessageRow } from './message-row.tsx'
import type { RenderMessage } from './messages.ts'

/** 造一条回合尾行（只填本用例关心的字段）。 */
function turnRow(overrides: Partial<RenderMessage> = {}): RenderMessage {
  return {
    id: 'tail-1',
    kind: 'turn',
    text: '重构已完成。',
    seq: 5,
    time: 0,
    ...overrides,
  } as RenderMessage
}

function renderRow(message: RenderMessage): void {
  render(
    <MessageRow
      message={message}
      sessionId="s-1"
      showToolCalls={false}
      showSystemMessages={false}
    /> as never,
  )
}

afterEach(() => { cleanup() })

describe('回合尾行 → 结论卡（P4 接入）', () => {
  it('纯文字回合给出结论卡，第一句即结论', () => {
    renderRow(turnRow({ text: '重构已完成。剩下两步在下周。', durationMs: 8_000 }))
    const card = screen.getByRole('region', { name: '结论' })
    expect(card.textContent).toContain('重构已完成。')
    expect(card.textContent).toContain('8 秒')
    // 长句只在结论位出现一次，不整段重复
    expect(card.textContent).not.toContain('剩下两步在下周。')
  })

  it('有文件时仍走原来的「本轮产出」卡，不叠一张结论卡', () => {
    renderRow(turnRow({ text: '改了三个文件。', deliverables: [{ path: 'a.ts' }] }))
    expect(screen.queryByRole('region', { name: '结论' })).toBeNull()
  })

  it('正文与产物都空的回合判「没做成」，并给出重试提示', () => {
    renderRow(turnRow({ text: '   ' }))
    const card = screen.getByRole('region', { name: '没做成' })
    expect(card.textContent).toContain('这一轮没有产出')
  })

  it('结论卡不编造百分比或工具次数', () => {
    renderRow(turnRow({ text: '跑完了。', durationMs: 3_000 }))
    const text = screen.getByRole('region', { name: '结论' }).textContent ?? ''
    expect(text).not.toContain('%')
    expect(text).not.toContain('次工具')
  })
})
