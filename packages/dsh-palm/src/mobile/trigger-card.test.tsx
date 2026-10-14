// @vitest-environment jsdom
/**
 * 宿主唤醒消息的卡片（与桌面端 ui-chat 的 TurnTriggerNodeView 对齐）。
 * 真机背景：桌面端这类消息出「收到任务消息」折叠卡，手机端此前把整条消息
 * 直接不渲染；现在按 source.kind 出同样的卡，默认折叠保持输出界面干净。
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MessageRow } from './message-row.tsx'

function row(sourceKind: string) {
  return {
    id: 'u-1',
    kind: 'user' as const,
    seq: 1,
    text: '子代理报告：三条都已修完',
    time: Date.parse('2026-10-13T18:23:00+08:00'),
    sourceKind,
  }
}

describe('唤醒消息卡片', () => {
  it('agent-message 出「收到任务消息」卡，默认折叠、正文点开才看', () => {
    const view = render(<MessageRow message={row('agent-message')} showToolCalls showSystemMessages={false} />)
    const card = view.container.querySelector('.chat-trigger') as HTMLDetailsElement | null
    expect(card).not.toBeNull()
    expect(card?.open).toBe(false)
    expect(view.container.querySelector('.chat-trigger-title')?.textContent).toBe('收到任务消息')
    expect(view.container.querySelector('.chat-trigger-note')?.textContent).toBe('这条通知触发了本轮回复。')
    expect(view.container.querySelector('.chat-trigger-text')?.textContent).toContain('三条都已修完')
  })

  it('其余注入行（压缩检查点/指令/skill 目录/运行时上下文）照旧不渲染', () => {
    for (const kind of ['compact-checkpoint', 'agent-instructions', 'skill-catalog', 'runtime-context']) {
      const view = render(<MessageRow message={row(kind)} showToolCalls showSystemMessages={false} />)
      expect(view.container.querySelector('.chat-trigger')).toBeNull()
      expect(view.container.textContent).not.toContain('三条都已修完')
      view.unmount()
    }
  })
})
