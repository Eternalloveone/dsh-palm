// @vitest-environment jsdom
/**
 * 幽灵用户行（2026-11-14）：点发送后、宿主回执之前，列表末尾立刻出现"我说的那句话"。
 *
 * 真机现象：弱网/宿主忙时点发送，屏幕上半晌什么都没有（只有发送键变灰），
 * 用户以为没发出去。幽灵行不进 `messages`，所以既不会重复也不会污染账本/搜索；
 * 宿主行落地或 8 秒兜底就撤。
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { ChatRows, type ChatRowsView } from './chat-rows.tsx'

const AT = 1_700_000_000_000

function viewOf(over: Partial<ChatRowsView> = {}): ChatRowsView {
  return {
    messages: [],
    sessionId: 's1',
    showToolCalls: true,
    showSystemMessages: false,
    hostNowMs: AT,
    clockAnchor: undefined,
    liveTurn: undefined,
    liveClockTick: 0,
    settledOf: () => true,
    isRowRunning: () => false,
    timeFlags: [],
    running: false,
    activeTurn: undefined,
    newestCardTurn: undefined,
    hasClosedTurn: () => true,
    rowOfInterrupted: (message) => message,
    rowKeyOf: (message) => message.id,
    estimateHeight: () => 80,
    focusMsgId: undefined,
    chatHitQuery: '',
    effectiveFocusQuery: undefined,
    regenerateFor: () => undefined,
    stickyProcRow: undefined,
    hasOlder: false,
    loading: false,
    loadOlder: () => undefined,
    onOpenFile: () => undefined,
    ...over,
  } as ChatRowsView
}

const outgoing = { id: 'req-1', text: '帮我看下这个 bug', at: AT }
const userRow = { id: 'u-1', kind: 'user', text: '帮我看下这个 bug', seq: 1, time: AT } as never

describe('发送后的幽灵用户行', () => {
  it('点下去就可见：正文 + 「已送出」提示同时在屏幕上', () => {
    const { container } = render(<ChatRows {...viewOf({ messages: [], outgoing })} />)
    expect(container.querySelector('.chat-msg-outgoing')).not.toBeNull()
    expect(container.textContent).toContain('帮我看下这个 bug')
    expect(container.textContent).toContain('已送出')
  })

  it('它不算消息行：不带 data-message-id（不参与计数/自洽判据）', () => {
    const { container } = render(<ChatRows {...viewOf({ messages: [], outgoing })} />)
    expect(container.querySelector('.chat-msg-outgoing')?.getAttribute('data-message-id')).toBeNull()
    expect(container.querySelector('.chat-msg-outgoing')?.getAttribute('data-outgoing-id')).toBe('req-1')
  })

  it('幽灵行在时不许画空态（刚发过话却写着「还没有消息」是这个 bug 的另一半）', () => {
    const { container } = render(<ChatRows {...viewOf({ messages: [], outgoing, entryAnswered: true })} />)
    expect(container.querySelector('.chat-typing')).toBeNull()
    expect(container.querySelector('[data-skeleton]')).toBeNull()
  })

  it('没有幽灵行时，空态照旧', () => {
    const { container } = render(<ChatRows {...viewOf({ messages: [], entryAnswered: true })} />)
    expect(container.querySelector('.chat-typing')?.textContent).toContain('还没有消息')
  })

  it('宿主行到了（outgoing 被撤）：只剩宿主那一行，不重复', () => {
    const { container } = render(<ChatRows {...viewOf({ messages: [userRow], entryAnswered: true })} />)
    expect(container.querySelector('.chat-msg-outgoing')).toBeNull()
    expect(container.querySelectorAll('.chat-msg').length).toBe(1)
  })
})

/**
 * 等待态（对齐业界 `submitted`）：消息已送达、模型还没开口。
 *
 * 真机实测（2026-11-14）：宿主用户行 +483ms 就到，过程条要 +13.6s 才出现 —— 中间这段
 * 以前屏幕上什么都没有，用户看到的就是"点完发送一直没有反馈"。
 */
describe('已送达 · 等待模型响应（submitted 态）', () => {
  it('等待态渲染一行提示，且用户那条消息还在', () => {
    const { container } = render(<ChatRows {...viewOf({ messages: [userRow], awaitingOutput: true, entryAnswered: true })} />)
    expect(container.querySelector('.chat-awaiting')?.textContent).toContain('等待模型响应')
    expect(container.querySelectorAll('.chat-msg-user').length).toBe(1)
  })

  it('等待态与空态互斥（刚发过话，不写「还没有消息」）', () => {
    const { container } = render(<ChatRows {...viewOf({ messages: [], awaitingOutput: true, entryAnswered: true })} />)
    expect(container.querySelector('.chat-typing:not(.chat-awaiting)')).toBeNull()
    expect(container.querySelector('.chat-awaiting')).not.toBeNull()
  })

  it('模型开始输出后等待态消失（过程条接管）', () => {
    const { container } = render(<ChatRows {...viewOf({ messages: [userRow], awaitingOutput: false })} />)
    expect(container.querySelector('.chat-awaiting')).toBeNull()
  })
})
