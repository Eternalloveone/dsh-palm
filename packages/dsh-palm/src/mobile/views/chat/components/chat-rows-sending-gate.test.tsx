// @vitest-environment jsdom
/**
 * 发送态的渲染闸门（P2 / A1′）：**发送键变灰，整条列表一行都不许重画。**
 *
 * 病灶（2026-11-12 用户「点按钮卡」的剩余主因）：`ChatView` 用 `useChatState(store)`
 * 整表订阅，而 `sending` 在一次发送里翻转两次（start → settled），于是 4000 行的视图
 * 连行列表的 props 一起重算重传。修法是把 `sending`/`stopping` 下沉到作曲区自己
 * `useChatSelector` 订阅，`ChatView` 只留 `phase`/`notice`/`title`。
 *
 * 本用例把 ChatView 的接线复刻成一个几十行的宿主，行组件按 `chat-rows-memo.test.tsx`
 * 的路子换成 memo 桩（只记渲染次数），作曲区用**真组件**（它自己订阅 store）。
 * 断言三件事，缺一条都可能是假绿：
 * ① 宿主自身不因发送态翻转重渲染 —— 病灶的直接度量（对照用例证明计数器不是摆设）；
 * ② 20 行一行都不重画 —— 用户看得见的那一半；
 * ③ 发送键照常 disable → enable —— 否则只是「订阅丢了」，不是「不重画」。
 *
 * 注意：裸 `.click()` 不会 flush，交互一律走 `fireEvent` / `act`。
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { memo, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RenderMessage } from '../../../render/messages.ts'
import { applySnapshot, resetSessionStoreForTest } from '../../../stream/session-store.ts'
import { createChatStore, type ChatStore } from '../../../runtime/chat/store.ts'
import { useChatSelector, useChatState } from '../../../runtime/chat/use-chat-store.ts'
import { ChatRows, type ChatRowsView } from './chat-rows.tsx'
import { ComposerSection, type ComposerSectionProps } from './composer-section.tsx'

const { rendered, hostRenders } = vi.hoisted(() => ({
  rendered: [] as string[],
  hostRenders: [] as string[],
}))

vi.mock('../../../render/message-row.tsx', () => ({
  MessageRow: memo(function MessageRowStub(props: { message: { id: string } }) {
    rendered.push(props.message.id)
    return <div data-testid="row">{props.message.id}</div>
  }),
}))

const AT = 1_700_000_000_000

function snapshotOf(sessionId: string, asOf: number) {
  return { sessionId, rows: [], maxSeq: 1, queue: [], queueRevision: 0, turn: { running: false }, asOf }
}

/** 全部回调与时间值都取"一次渲染算好、之后不换"的引用（与 ChatView 的契约一致）。 */
function viewOf(messages: readonly RenderMessage[]): ChatRowsView {
  return {
    messages,
    sessionId: 's1',
    showToolCalls: true,
    showSystemMessages: false,
    hostNowMs: Math.floor(AT / 10_000) * 10_000,
    hostNow: () => AT,
    clockAnchor: undefined,
    liveTurn: undefined,
    liveClockTick: 0,
    settledOf: () => true,
    isRowRunning: () => false,
    timeFlags: [],
    running: false,
    activeTurn: undefined,
    newestCardTurn: undefined,
    hasClosedTurn: () => false,
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
  }
}

const row = (id: string, turn: number, text: string): RenderMessage => ({
  id, kind: 'assistant', text, seq: turn * 10, time: AT, turn,
})

/** 真机一屏的行数量级。 */
const MANY = Array.from({ length: 20 }, (_, index) => row(`m${index + 1}`, index + 1, `第 ${index + 1} 条`))

/**
 * 作曲区只造最少的 props：`attachFiles` 里放一件 ready 的附件，发送键才是**可点的**
 * （空草稿时它本来就该是灰的，那样断言 disable 就毫无信息量）。发送/停在途由它自己
 * 从 `store` 订阅，所以这里只给 store，不给 `sending`/`stopping`。
 */
function composerProps(store: ChatStore): ComposerSectionProps {
  return {
    draft: { sessionId: 's-test', quoted: undefined, setQuoted: () => {} },
    attachments: {
      attachImages: [], setAttachImages: () => {},
      attachFiles: [{ localId: 'f1', name: 'a.txt', bytes: 12, status: 'ready', receiptId: 'r1' }],
      setAttachFiles: () => {}, retryStaged: () => {}, addImage: () => {},
    },
    commands: { commands: [], claimedCommand: undefined, claimCommand: () => {}, releaseCommand: () => {}, setPlusOpen: () => {} },
    turn: { running: false, stopArmed: false, setStopArmed: () => {}, stopTurn: () => {}, send: () => {}, store },
    inputBox: { composerRef: { current: null }, mobileEnterToSend: true },
    voice: {
      open: false, phase: 'recording', partial: '', elapsed: 0, statusText: '正在听…',
      waveRef: { current: null }, start: () => {}, finish: () => {}, cancel: () => {},
    },
    queue: { detail: null },
  }
}

beforeEach(() => { rendered.length = 0; hostRenders.length = 0 })
afterEach(() => { cleanup(); resetSessionStoreForTest() })

/** 发送键：空闲是「发送」，跑到一半禁用它（`aria-label` 不变，只看 disabled）。 */
function sendButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: '发送' }) as HTMLButtonElement
}

describe('发送态翻转的渲染边界', () => {
  /**
   * 对照：**整表订阅**（今天 ChatView 的接法）会把发送态翻转原样传染成宿主重渲染。
   * 这条同时证明渲染计数器真的在工作 —— 否则下面「0 次」可能只是没插桩。
   */
  it('对照：整表订阅下，一次发送翻转会重画宿主（这就是要被修掉的病灶）', () => {
    const store = createChatStore()
    const view = viewOf(MANY)
    function LegacyHost(): React.ReactElement {
      const state = useChatState(store)
      hostRenders.push(state.sending ? 'sending' : 'idle')
      return <ChatRows {...view} />
    }

    render(<LegacyHost />)
    const before = hostRenders.length
    act(() => { store.dispatch({ type: 'intent/send-start', at: AT }) })
    act(() => { store.dispatch({ type: 'intent/send-settled' }) })
    // start + settled = 两次，一次发送把宿主重建两遍。
    expect(hostRenders.length).toBe(before + 2)
  })

  it('下沉后：发送态 false→true→false，宿主与 20 行都不重画，发送键照常变灰再恢复', () => {
    const store = createChatStore()
    const view = viewOf(MANY)
    // 与 ChatView 同构：只订阅 phase/notice/title，sending/stopping 交给作曲区自订阅。
    function ChatViewHost(): React.ReactElement {
      const phase = useChatSelector(store, (state) => state.phase)
      const notice = useChatSelector(store, (state) => state.notice)
      const title = useChatSelector(store, (state) => state.title)
      hostRenders.push(`${phase}:${notice ?? '-'}:${title ?? '-'}`)
      return (
        <>
          <ChatRows {...view} />
          <ComposerSection {...composerProps(store)} />
        </>
      )
    }

    render(<ChatViewHost />)
    expect(rendered).toHaveLength(20)
    // 空闲：草稿非空 → 发送键可点。
    expect(sendButton().disabled).toBe(false)
    const hostBefore = hostRenders.length
    rendered.length = 0

    act(() => { store.dispatch({ type: 'intent/send-start', at: AT }) })
    // 在途：键灰掉（防止连点），但宿主与 20 行一次都不该重画。
    expect(sendButton().disabled).toBe(true)
    expect(hostRenders.length).toBe(hostBefore)
    expect(rendered).toEqual([])

    act(() => { store.dispatch({ type: 'intent/send-settled' }) })
    expect(sendButton().disabled).toBe(false)
    expect(hostRenders.length).toBe(hostBefore)
    expect(rendered).toEqual([])
  })

  it('与消息无关的点击（宿主自己的局部状态）也不会惊动行列表', () => {
    const view = viewOf(MANY)
    function Host(): React.ReactElement {
      const [bump, setBump] = useState(0)
      return (
        <>
          <button type="button" onClick={() => { setBump(value => value + 1) }}>bump{bump}</button>
          <ChatRows {...view} />
        </>
      )
    }
    render(<Host />)
    rendered.length = 0
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button').textContent).toBe('bump1')
    expect(rendered).toEqual([])
  })
})
