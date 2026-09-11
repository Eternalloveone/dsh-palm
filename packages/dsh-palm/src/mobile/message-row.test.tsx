// @vitest-environment jsdom
/**
 * MessageRow layout-stability contract: a streaming (pending) message with a
 * non-empty flow renders the SAME interleaved body structure as its settled
 * form — text runs and artifact cards in flow order — so the pending→settled
 * switch never re-lays the row (no tail-card→inline-card jump). Also covers
 * the artifact card's collapsible diff body.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MessageRow } from './message-row.tsx'
import type { RenderMessage, ToolCallInfo } from './messages.ts'

// 图片字节走 attachment-images（内容寻址缓存）：测试里当作已缓存，组件同步渲染。
vi.mock('./attachment-images.ts', () => ({
  cachedAttachmentUrl: (attachmentId: string) => (attachmentId === 'sha256:abc' ? 'data:image/jpeg;base64,QUFB' : undefined),
  loadAttachmentUrl: () => Promise.resolve('data:image/jpeg;base64,QUFB'),
}))

const tool: ToolCallInfo = {
  callId: 'c1',
  name: 'applyPatch',
  view: {
    card: 'diff',
    title: '编辑了 1 个文件',
    diffs: [{ path: 'src/a.ts', oldText: 'old line\n', newText: 'new line\n' }],
  },
}

/** A null flow means "no flow" (the tail layout path); undefined triggers
 *  the default interleaved flow — use null explicitly for the no-flow case. */
function baseMessage(
  pending: boolean,
  flow: RenderMessage['flow'] | null = [
    { kind: 'text', text: '第一段' },
    { kind: 'tool', callId: 'c1' },
    { kind: 'text', text: '第二段' },
  ],
  tools: ToolCallInfo[] = [tool],
): RenderMessage {
  return {
    id: 'assistant,1.0#5',
    kind: 'assistant',
    text: '第一段\n\n第二段',
    pending,
    seq: 5,
    time: 1_000,
    tools,
    flow: flow === null ? undefined : flow,
  }
}

/** The body parts in DOM order, as their structural classes. */
function bodyStructure(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.chat-md-body, .chat-artifact'))
    .map(el => el.className.includes('chat-artifact') ? 'artifact' : 'text')
}

describe('MessageRow flow body (layout stability)', () => {
  it('renders pending and settled rows with the identical interleaved structure', () => {
    const pending = render(
      <MessageRow message={baseMessage(true)} showToolCalls showSystemMessages={false} />,
    )
    const settled = render(
      <MessageRow message={baseMessage(false)} showToolCalls showSystemMessages={false} />,
    )

    // Both states: text run → artifact card → text run, in flow order.
    expect(bodyStructure(pending.container)).toEqual(['text', 'artifact', 'text'])
    expect(bodyStructure(settled.container)).toEqual(['text', 'artifact', 'text'])
    expect(pending.container.querySelectorAll('.chat-artifact')).toHaveLength(1)
    expect(settled.container.querySelectorAll('.chat-artifact')).toHaveLength(1)
  })

  it('merges consecutive tool parts into one artifact card', () => {
    const message = baseMessage(
      true,
      [
        { kind: 'text', text: '开始' },
        { kind: 'tool', callId: 'c1' },
        { kind: 'tool', callId: 'c2' },
        { kind: 'text', text: '结束' },
      ],
      [
        tool,
        { ...tool, callId: 'c2', view: { ...tool.view!, diffs: [{ path: 'src/b.ts', oldText: '', newText: 'b\n' }] } },
      ],
    )
    const { container } = render(
      <MessageRow message={message} showToolCalls showSystemMessages={false} />,
    )
    expect(bodyStructure(container)).toEqual(['text', 'artifact', 'text'])
    expect(container.querySelectorAll('.chat-artifact')).toHaveLength(1)
    // Two files merged into one card: the head reads "编辑了 2 个文件".
    expect(container.querySelector('.chat-artifact-title')!.textContent).toBe('编辑了 2 个文件')
  })

  it('without a flow, the artifact card rides after the markdown body (tail layout)', () => {
    const message = baseMessage(false, null)
    const { container } = render(
      <MessageRow message={message} showToolCalls showSystemMessages={false} />,
    )
    expect(bodyStructure(container)).toEqual(['text', 'artifact'])
  })

  it('renders streaming rows without any typewriter cursor (clean output)', () => {
    const message = baseMessage(
      true,
      [
        { kind: 'text', text: '第一段' },
        { kind: 'tool', callId: 'c1' },
        { kind: 'text', text: '第二段' },
      ],
    )
    const { container } = render(
      <MessageRow message={message} showToolCalls showSystemMessages={false} />,
    )
    // No typewriter cursor anywhere: the streaming state is conveyed by the
    // turn status bar, not by a ▍ after the text.
    expect(container.querySelectorAll('.chat-msg-cursor')).toHaveLength(0)
    const settled = render(
      <MessageRow message={baseMessage(false)} showToolCalls showSystemMessages={false} />,
    )
    expect(settled.container.querySelectorAll('.chat-msg-cursor')).toHaveLength(0)
  })

  it('the artifact diff body opens and closes on the head tap', () => {
    const { container } = render(
      <MessageRow message={baseMessage(false)} showToolCalls showSystemMessages={false} />,
    )
    const head = container.querySelector('.chat-artifact-head') as HTMLButtonElement
    expect(screen.queryByText('old line')).toBeNull()
    fireEvent.click(head)
    expect(screen.getByText('old line')).toBeDefined()
    expect(screen.getByText('new line')).toBeDefined()
    // The diff body is clamped for the max-height transition even when open.
    const body = container.querySelector('.chat-tool-diff') as HTMLDivElement
    expect(body.style.maxHeight).toBe('0px') // jsdom has no layout; still set
    fireEvent.click(head)
    expect(screen.queryByText('old line')).toBeNull()
  })

  it('renders message images for a user row and keeps an image-only row alive', () => {
    // 事件里只有 attachmentId 引用；字节由 attachment-images 取（这里给缓存命中，
    // 组件同步拿到 data URL，测试不碰网络）。
    const image = { attachmentId: 'sha256:abc', mediaType: 'image/jpeg', width: 810, height: 1440, name: 'a.jpg' }
    const imageOnly: RenderMessage = { id: 'u-img', kind: 'user', text: '', images: [image], seq: 1, time: 1_000 }
    const { container } = render(
      <MessageRow message={imageOnly} sessionId="s-1" showToolCalls showSystemMessages={false} />,
    )
    const tile = container.querySelector('.chat-msg-image') as HTMLImageElement | null
    // 纯图片消息文本为空：以前整行 return null，现在必须渲染出图片。
    expect(tile).not.toBeNull()
    expect(tile?.getAttribute('src')).toBe('data:image/jpeg;base64,QUFB')
    expect(tile?.getAttribute('alt')).toBe('a.jpg')
    expect(tile?.getAttribute('width')).toBe('810')

    // 文字 + 图片：两者都在。
    const withText: RenderMessage = { ...imageOnly, id: 'u-both', text: '看看这张' }
    const both = render(
      <MessageRow message={withText} sessionId="s-1" showToolCalls showSystemMessages={false} />,
    )
    expect(both.container.querySelector('.chat-msg-image')).not.toBeNull()
    expect(both.container.textContent).toContain('看看这张')

    // 没有 sessionId（非真实调用点）：拿不到授权会话就不渲染图片。
    const anonymous = render(
      <MessageRow message={imageOnly} showToolCalls showSystemMessages={false} />,
    )
    expect(anonymous.container.querySelector('.chat-msg-image')).toBeNull()
  })
})
