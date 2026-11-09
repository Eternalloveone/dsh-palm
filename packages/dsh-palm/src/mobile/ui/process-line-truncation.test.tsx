// @vitest-environment jsdom
/**
 * 工具行的截断契约（真机 2026-11-09：`工具 · mcp__github__create_issue` 被挤成 `工·`）：
 * 左边 1–3 个字的动作名（工具 / 写入 / 运行命令）必须整字显示，省略号只许落在
 * 右边那条长摘要上。
 *
 * jsdom 不做排版，所以这里把两件事一起钉死：
 * 1. 结构与文本：标题就是完整的「工具」，摘要原文不丢字（截断只发生在视觉层）；
 * 2. 样式表：`.chat-step-title` 不参与收缩（`flex: none`，没有 min-width/overflow/
 *    text-overflow），省略号归 `.chat-step-summary`（min-width: 0 + ellipsis），
 *    分隔符「· 」挂在摘要的 ::before 上，标题因此永远是完整的一个词。
 * 320 / 375 / 390 三档只是把「同一份 DOM 不该随屏宽变短」写成回归测试。
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MessageRow } from '../render/message-row.tsx'
import type { RenderMessage, ToolCallInfo } from '../render/messages.ts'
import { mobileCss } from '../mobile-styles.ts'

afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
})

/** 去掉注释后的样式表：规则边界才好用 `}` 定位。 */
const CSS = mobileCss.replace(/\/\*[\s\S]*?\*\//g, '')

/** 读一条规则的声明体（选择器要写全，且必须从规则边界开始）。 */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp('(?:^|[}])\\s*' + escaped + '\\s*\\{([^}]*)\\}').exec(CSS)
  if (match === null) throw new Error(`样式表里找不到规则 ${selector}`)
  return match[1] ?? ''
}

const mcpTool: ToolCallInfo = {
  callId: 'c1',
  name: 'mcp__github__create_issue',
  state: 'ok',
  arguments: '{"title":"a very long tool name that would eat the whole row"}',
}

function mcpMessage(): RenderMessage {
  return {
    id: 'a-mcp',
    kind: 'assistant',
    text: '开好了',
    pending: false,
    seq: 5,
    time: 5_000,
    durationMs: 12_000,
    flow: [{ kind: 'tool', callId: 'c1' }],
    tools: [mcpTool],
  }
}

/** 三个真机宽度：窄屏（320）/ 主流（375）/ 大屏（390）。 */
const WIDTHS = [320, 375, 390] as const

describe('工具行：短标题不许被长摘要挤成省略号', () => {
  it.each(WIDTHS)('%ipx：标题仍是完整的「工具」，摘要原文一字不少', (width) => {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
    const { container } = render(
      <MessageRow message={mcpMessage()} showToolCalls showSystemMessages={false} />,
    )
    fireEvent(window, new Event('resize'))

    const title = container.querySelector('.chat-step-title')!
    // 真机 bug 的形状：'工' + '·'（标题被压缩后用省略号收尾）。
    expect(title.textContent).toBe('工具')
    expect(title.textContent).not.toBe('工')
    // 摘要的原文留在 DOM 里：窄屏只在视觉上打省略号（见下面的 CSS 契约）。
    expect(container.querySelector('.chat-step-summary')!.textContent)
      .toContain('mcp__github__create_issue')
    // 读屏器拿到的也是完整一句（aria-label 由 title + ' · ' + summary 拼出来）。
    expect(container.querySelector('.chat-step-head')!.getAttribute('aria-label'))
      .toContain('工具 · mcp__github__create_issue')
  })

  it('`.chat-step-title` 不参与收缩：flex: none，且没有省略号那三件套', () => {
    const title = ruleBody('.chat-step-title')
    expect(title).toContain('flex: none')
    // 短词只会被"压缩 + 省略号"吃掉后半截，所以这三条一条都不许有。
    expect(title).not.toContain('min-width: 0')
    expect(title).not.toContain('text-overflow')
    expect(title).not.toContain('overflow: hidden')
    // 也不许换行：折行同样会把「运行命令」拆成两截。
    expect(title).toContain('white-space: nowrap')
  })

  it('省略号只归摘要：min-width: 0 + ellipsis，分隔符挂在摘要的 ::before 上', () => {
    const summary = ruleBody('.chat-step-summary')
    expect(summary).toContain('min-width: 0')
    expect(summary).toContain('text-overflow: ellipsis')
    expect(summary).toContain('overflow: hidden')
    expect(summary).toContain('flex: 1 1 auto')

    // 「· 」是摘要的前缀，不是标题的后缀 —— 标题永远不会带着半个分隔符进省略号。
    const sep = ruleBody('.chat-step-head .chat-step-summary:not(:empty)::before')
    expect(sep).toContain("content: '· '")
    expect(CSS).not.toContain('.chat-step-title::before')
    expect(CSS).not.toContain('.chat-step-title::after')
  })
})
