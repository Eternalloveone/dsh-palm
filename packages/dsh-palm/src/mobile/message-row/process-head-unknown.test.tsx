// @vitest-environment jsdom
/**
 * 过程折叠条头行的「没有权威证据」口径（2026-11-09，最后一条「缺字段当成功」）：
 *
 * 会话页水合之前（`hydrated={false}`，见 chat-rows.tsx 的 taskAuthority）过程条
 * 只许画「—」与来自实际行数据的计数 —— 不写「已完成」「深度求索中」，不报耗时。
 * 水合后（hydrated 缺省 = 已水合，直接渲染这一行的宿主/测试自带证据）照旧。
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

  it('hydrated 缺省 = 已水合：同一行恢复「已完成，用时 X」', () => {
    const message = assistant({ text: '答案', durationMs: 19_000, turnStartAt: 1_000 })
    const { container } = render(
      <MessageRow message={message} showToolCalls={true} showSystemMessages={false} />,
    )

    const head = container.querySelector('.chat-proc-head-static') as HTMLElement
    expect(head.getAttribute('data-state')).toBe('ok')
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('已完成')
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时19秒')
  })

  it('运行中的行：水合前也不写「深度求索中」；水合后才给状态词与秒表', () => {
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

    // 水合后：状态词与秒表一次性出现（宿主时间 − 锚点 = 65 秒）。
    const after = render(
      <MessageRow message={message} showToolCalls={true} showSystemMessages={false} hostNowMs={100_000} />,
    )
    const live = after.container.querySelector('.chat-proc-head') as HTMLElement
    expect(live.querySelector('.chat-proc-state')!.textContent).toBe('深度求索中')
    expect(live.querySelector('.chat-proc-time')!.textContent).toBe('用时1分5秒')
  })
})
