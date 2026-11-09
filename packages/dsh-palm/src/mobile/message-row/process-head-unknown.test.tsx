// @vitest-environment jsdom
/**
 * 过程折叠条头行的「没有权威证据」口径（2026-11-09，最后一条「缺字段当成功」）：
 *
 * 会话页水合之前（`hydrated={false}`，见 chat-rows.tsx 的 taskAuthority）过程条
 * 只许报来自实际行数据的计数 —— 不写「已完成」「深度求索中」，不报耗时。
 * 水合后（hydrated 缺省 = 已水合，直接渲染这一行的宿主/测试自带证据）照旧。
 *
 * 2026-11-09 版式收敛：状态词与计时全页只在任务头状态条，过程头只报计数；
 * 没有工具计数时落「—」。
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MessageRow, resetTurnAnchors } from '../render/message-row.tsx'
import type { RenderMessage, ToolCallInfo } from '../render/messages.ts'

const writeTool: ToolCallInfo = { callId: 'c1', name: 'write', state: 'ok' }

function assistant(overrides: Partial<RenderMessage> & Pick<RenderMessage, 'text'>): RenderMessage {
  return { id: 'a-1', kind: 'assistant', seq: 9, time: 100_000, pending: false, ...overrides }
}

beforeEach(() => { resetTurnAnchors() })
afterEach(() => { cleanup() })

describe('过程条头行：没有 authority 只画「—」', () => {
  it('已收工的行在水合前只有「—」：没有已完成、没有深度求索中、没有用时', () => {
    const message = assistant({ text: '答案', durationMs: 384_000, turnStartAt: 1_000 })
    const { container } = render(
      <MessageRow message={message} showToolCalls={true} showSystemMessages={false} hydrated={false} />,
    )

    const head = container.querySelector('.chat-proc-head') as HTMLElement
    expect(head.getAttribute('data-state')).toBe('unknown')
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('—')
    expect(head.querySelector('.chat-proc-time')).toBeNull()
    expect(head.textContent).not.toContain('已完成')
    expect(head.textContent).not.toContain('深度求索中')
  })

  it('工具计数来自实际行数据：unknown 也保留「N 次工具调用」，但不出现耗时/状态词', () => {
    const message = assistant({
      text: '',
      durationMs: 5_000,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [writeTool],
    })
    const { container } = render(
      <MessageRow message={message} showToolCalls={true} showSystemMessages={false} hydrated={false} />,
    )

    const head = container.querySelector('.chat-proc-head') as HTMLElement
    expect(head.getAttribute('data-state')).toBe('unknown')
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('1 次工具调用')
    expect(head.querySelector('.chat-proc-time')).toBeNull()
    expect(head.textContent).not.toContain('已完成')
    expect(head.textContent).not.toContain('深度求索中')
  })

  it('hydrated 缺省 = 已水合：同一行仍只报计数，过程头永远不带计时（计时归状态条）', () => {
    const message = assistant({ text: '答案', durationMs: 19_000, turnStartAt: 1_000 })
    const { container } = render(
      <MessageRow message={message} showToolCalls={true} showSystemMessages={false} />,
    )

    const head = container.querySelector('.chat-proc-head-static') as HTMLElement
    expect(head.getAttribute('data-state')).toBe('ok')
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('—')
    expect(head.querySelector('.chat-proc-time')).toBeNull()
    expect(head.getAttribute('aria-label')).toBe('—')
  })

  it('运行中的行：水合前后都不写「深度求索中」，也不挂秒表', () => {
    const message = assistant({
      text: '',
      pending: true,
      turnStartAt: 35_000,
      flow: [{ kind: 'text', text: '在写' }],
    })

    // 水合前：只有一个「—」，秒表不挂。
    const before = render(
      <MessageRow message={message} showToolCalls={true} showSystemMessages={false} hydrated={false} hostNowMs={100_000} />,
    )
    const cold = before.container.querySelector('.chat-proc-head') as HTMLElement
    expect(cold.querySelector('.chat-proc-state')!.textContent).toBe('—')
    expect(cold.querySelector('.chat-proc-time')).toBeNull()
    expect(cold.textContent).not.toContain('深度求索中')
    before.unmount()

    // 水合后：状态由任务头状态条负责；过程头仍只报计数（这里没有工具 ⇒「—」）。
    const after = render(
      <MessageRow message={message} showToolCalls={true} showSystemMessages={false} hostNowMs={100_000} />,
    )
    const live = after.container.querySelector('.chat-proc-head') as HTMLElement
    expect(live.getAttribute('data-state')).toBe('running')
    expect(live.querySelector('.chat-proc-state')!.textContent).toBe('—')
    expect(live.querySelector('.chat-proc-time')).toBeNull()
  })
})
