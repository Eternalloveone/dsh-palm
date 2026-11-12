// @vitest-environment jsdom
/**
 * 回合尾行的渲染契约（2026-11-08 接入「会话正文流」后 / 2026-11-10 P4 四态）：
 * - 收尾行只画**交付卡**（全页唯一的一张卡），旧的「结论卡」不再出现在回合尾行；
 * - 没有产物/改动、且回合正常收工时，尾行什么都不画（终态交给任务头状态条）；
 * - 失败与「中断未标记失败」不再静默消失：分别是 `failure` 与 `unknown` 两态，
 *   未知字段不得猜成功。
 */
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
    turn: 1,
    ...overrides,
  } as RenderMessage
}

function renderRow(message: RenderMessage, completed?: boolean): { container: HTMLElement } {
  const { container } = render(
    <MessageRow
      message={message}
      showToolCalls={false}
      showSystemMessages={false}
      {...(completed === undefined ? {} : { turnCompleted: completed })}
    /> as never,
  )
  return { container }
}

afterEach(() => { cleanup() })

describe('回合尾行 → 交付卡（会话正文流接入）', () => {
  it('有交付物时给交付卡：卡头「交付完成」+ 文件行', () => {
    const { container } = renderRow(turnRow({ deliverables: [{ path: 'docs/report.md', description: '交付报告' }] }))
    expect(container.querySelector('.palm-delivery')).not.toBeNull()
    expect(screen.getByText('交付完成')).toBeTruthy()
    expect(container.textContent).toContain('交付报告')
  })

  it('纯文字回合（没有产物/改动）不再叠结论卡', () => {
    const { container } = renderRow(turnRow({ text: '重构已完成。剩下两步在下周。' }))
    expect(container.querySelector('.palm-delivery')).toBeNull()
    expect(container.querySelector('.chat-turn-verdict')).toBeNull()
    expect(container.textContent).toBe('')
  })

  it('产出文件（没有交付物）也上卡，并给出真实文件数', () => {
    const { container } = renderRow(turnRow({ produced: ['src/a.ts'] }))
    expect(container.querySelector('.palm-delivery')).not.toBeNull()
    // 2026-11-10：卡内行只显示文件名（完整路径在交付详情页）。
    expect(container.textContent).toContain('a.ts')
    expect(container.querySelector('.palm-delivery-sum')!.textContent).toContain('1 个文件')
  })

  it('失败/中断的回合画「没做成」的失败卡，不再谎报交付完成', () => {
    const { container } = renderRow(turnRow({ produced: ['src/a.ts'], failed: true }), false)
    const card = container.querySelector('.palm-delivery')
    expect(card).not.toBeNull()
    expect(card!.getAttribute('data-state')).toBe('failure')
    expect(screen.getByText('没做成')).toBeTruthy()
    expect(container.textContent).not.toContain('交付完成')
  })

  it('中断但没标记失败：结局未知，不猜成功', () => {
    const { container } = renderRow(turnRow({ produced: ['src/a.ts'] }), false)
    expect(container.querySelector('.palm-delivery')!.getAttribute('data-state')).toBe('unknown')
    expect(screen.getByText('结局未知')).toBeTruthy()
    expect(container.textContent).not.toContain('交付完成')
  })

  it('卡里不编造百分比或工具次数', () => {
    const { container } = renderRow(turnRow({ deliverables: [{ path: 'a.ts' }] }))
    const text = container.textContent ?? ''
    expect(text).not.toContain('%')
    expect(text).not.toContain('次工具')
  })

  it('失败卡上给「重试」，点了走调用方给的重生成（失败态必须有下一步动作）', () => {
    // 2026-11-10 审查：交付卡自己支持 onRetry，但 MessageRow 一直没把
    // 重生成回调接进去 —— 失败回合只写「没做成」，用户找不到下一步。
    let retried = 0
    const { container } = render(
      <MessageRow
        message={turnRow({ produced: ['src/a.ts'], failed: true })}
        showToolCalls={false}
        showSystemMessages={false}
        turnCompleted={false}
        onRegenerate={() => { retried += 1 }}
      /> as never,
    )
    expect(container.querySelector('.palm-delivery')!.getAttribute('data-state')).toBe('failure')
    screen.getByText('重试').click()
    expect(retried).toBe(1)
  })

  it('没给重生成回调时不画重试按钮（不放假入口）', () => {
    const { container } = renderRow(turnRow({ produced: ['src/a.ts'], failed: true }), false)
    expect(container.querySelector('.palm-delivery-retry')).toBeNull()
  })
})
