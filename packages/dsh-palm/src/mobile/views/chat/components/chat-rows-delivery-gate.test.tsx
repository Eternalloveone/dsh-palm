// @vitest-environment jsdom
/**
 * 交付卡的可见性门：**跑着的时候不许挂历史卡**。
 *
 * 真机现象：会话还没跑完，最下面挂着上一轮的交付卡（账本最新一条是上一轮，
 * 而"上一轮有收工证据"永远成立）。
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

const assistant = (turn: number) => ({
  id: `a-${turn}`,
  kind: 'assistant',
  text: '好了',
  seq: turn * 10,
  time: AT,
  turn,
} as never)

const delivery = (turn: number) => ({
  sessionId: 's1',
  turn,
  presented: [{ path: 'report.md', description: '交付报告' }],
  changes: [{ path: 'src/app.ts', adds: 12, dels: 3 }],
  adds: 12,
  dels: 3,
  meaningful: true,
})

describe('交付卡的运行中判定', () => {
  it('收工后：账本那张卡显示', () => {
    const { container } = render(
      <ChatRows {...viewOf({ messages: [assistant(1)], delivery: delivery(1), running: false })} />,
    )
    expect(container.querySelectorAll('.chat-turn-tail')).toHaveLength(1)
  })

  it('运行中且账本是上一轮：不挂历史卡', () => {
    const { container } = render(
      <ChatRows
        {...viewOf({ messages: [assistant(1), assistant(2)], delivery: delivery(1), running: true, activeTurn: 2 })}
      />,
    )
    expect(container.querySelectorAll('.chat-turn-tail')).toHaveLength(0)
  })

  it('运行中但不知活跃轮：同样不挂（保守）', () => {
    const { container } = render(
      <ChatRows {...viewOf({ messages: [assistant(1)], delivery: delivery(1), running: true, activeTurn: undefined })} />,
    )
    expect(container.querySelectorAll('.chat-turn-tail')).toHaveLength(0)
  })

  // 真机 2026-11-14 19:52：新建的会话里空无一行，屏幕上却挂着一张上一场的交付卡
  // （卡上就是上一场改的两个皮肤文件），下面紧跟「还没有消息，发一句话开始吧」。
  // 账本活得过"行暂时为空"的窗口，而 turn 号每场都从 1 起 —— 只有行能证明"这一场有内容"。
  it('空会话（一行都没有）：账本里有卡也不画', () => {
    const { container } = render(
      <ChatRows {...viewOf({ messages: [], delivery: delivery(1), running: false })} />,
    )
    expect(container.querySelectorAll('.chat-turn-tail')).toHaveLength(0)
    expect(container.textContent).toContain('还没有消息')
  })

  it('空会话：不画「加载更早的消息」（没有可挂的列表就没有更早）', () => {
    const { container } = render(<ChatRows {...viewOf({ messages: [], hasOlder: true })} />)
    expect(container.querySelector('.chat-load-older')).toBeNull()
  })

  it('有行时「加载更早的消息」照旧（不误伤分页入口）', () => {
    const { container } = render(<ChatRows {...viewOf({ messages: [assistant(1)], hasOlder: true })} />)
    expect(container.querySelector('.chat-load-older')).not.toBeNull()
  })
})

/**
 * **画面自洽**（L1 不变量，2026-11-14 定）：这一屏作为一个整体必须成立，而不是每个
 * 块各自成立。四条断言覆盖了这一类"莫名其妙的画面"—— 卡没有正文、空态和卡同屏、
 * 更早按钮挂在空列表上、块说不清自己属于哪一场。
 *
 * 以后每修一条同类 bug，就在这里加一条自洽断言（而不是只加一条"这次这个入口"的用例）。
 */
describe('画面自洽', () => {
  const card = (over: Partial<ChatRowsView> = {}) =>
    render(<ChatRows {...viewOf({ messages: [assistant(1)], delivery: delivery(1), ...over })} />)

  it('有卡 ⇒ 屏上一定有正文（卡不能是唯一有内容的东西）', () => {
    const { container } = card()
    expect(container.querySelectorAll('.chat-turn-tail')).toHaveLength(1)
    expect(container.querySelectorAll('.chat-msg').length).toBeGreaterThan(0)
  })

  it('卡与空态互斥：有卡就不画「还没有消息」', () => {
    const { container } = card()
    expect(container.querySelector('.chat-typing')).toBeNull()
  })

  it('空态在时一定没有卡', () => {
    const { container } = render(<ChatRows {...viewOf({ messages: [], delivery: delivery(1) })} />)
    expect(container.querySelector('.chat-typing')).not.toBeNull()
    expect(container.querySelectorAll('.chat-turn-tail')).toHaveLength(0)
  })

  it('卡带归属戳：data-owner = 本场会话 id', () => {
    const { container } = card({ sessionId: 's-42' })
    expect(container.querySelector('.chat-turn-tail-row')?.getAttribute('data-owner')).toBe('s-42')
  })

  it('「加载更早」不挂在空列表上（否则是永远点不出东西的按钮）', () => {
    const { container } = render(<ChatRows {...viewOf({ messages: [], hasOlder: true })} />)
    expect(container.querySelector('.chat-load-older')).toBeNull()
  })

  // 真机 2026-11-14：「切换会话时会闪出一张交付卡，一会儿就消失」。切过去首帧 `running`
  // 还没结论（名册滞后），账本却按会话分槽、切回去就有上一轮的卡 —— 于是先画、权威结论
  // 到了再撤。没结论就不许画。
  it('running 还没有结论：不画卡（否则会闪一下又消失）', () => {
    const { container } = render(
      <ChatRows {...viewOf({ messages: [assistant(1)], delivery: delivery(1), running: false, runningKnown: false })} />,
    )
    expect(container.querySelectorAll('.chat-turn-tail')).toHaveLength(0)
  })

  it('running 已有结论且已收工：卡照旧画（不误伤正常显示）', () => {
    const { container } = render(
      <ChatRows {...viewOf({ messages: [assistant(1)], delivery: delivery(1), running: false, runningKnown: true })} />,
    )
    expect(container.querySelectorAll('.chat-turn-tail')).toHaveLength(1)
  })
})
