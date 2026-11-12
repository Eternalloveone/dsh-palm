// @vitest-environment jsdom
/**
 * 渲染次数闸门（A3）：**与消息无关的重渲染，一行都不许重画。**
 *
 * 这条用例防的是 2026-11-12 实测的那一类退化：10× CPU 降频下，点一次上下文弹层
 * 要 400~600 ms 脚本时间 —— 因为 `ChatRows` 没有渲染边界、且每行回调在 `.map` 里
 * 现造闭包，于是 `MessageRow` 的 `memo` 对每一行都失效，一次轻点等于整列表重建。
 *
 * 它拦三种具体写法（都是真实发生过的）：
 * 1. 去掉 `ChatRows` 的 `memo` —— 父组件无关状态一变，整列表重算；
 * 2. 在 `.map` 里写 `onOpenFile={(path) => view.onOpenFile(path)}` —— 每行一个新引用，
 *    `memo` 全部失守（症状：只改一条消息，却所有行都重画）；
 * 3. 传毫秒级 `hostNowMs`（每次渲染一个新数）—— 同理，全部重画。
 *
 * 行组件在本用例里被替换成一个 `memo` 桩：它只记录自己被渲染的次数，于是"重画了
 * 几行"就是可以直接断言的数字，不依赖 DOM 细节。
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { memo, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RenderMessage } from '../../../render/messages.ts'
import { applySnapshot, resetSessionStoreForTest } from '../../../stream/session-store.ts'
import { ChatRows, type ChatRowsView } from './chat-rows.tsx'

const { rendered, hydratedFlags } = vi.hoisted(() => ({
  rendered: [] as string[],
  hydratedFlags: [] as boolean[],
}))

vi.mock('../../../render/message-row.tsx', () => ({
  MessageRow: memo(function MessageRowStub(props: { message: { id: string }; hydrated?: boolean }) {
    rendered.push(props.message.id)
    hydratedFlags.push(props.hydrated === true)
    return <div data-testid="row">{props.message.id}</div>
  }),
}))

const AT = 1_700_000_000_000

function snapshotOf(sessionId: string, asOf: number) {
  return { sessionId, rows: [], maxSeq: 1, queue: [], queueRevision: 0, turn: { running: false }, asOf }
}

/** 全部回调与时间值都取"一次渲染算好、之后不换"的引用（与 ChatView 的契约一致）。 */
function viewOf(messages: readonly RenderMessage[], over: Partial<ChatRowsView> = {}): ChatRowsView {
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
    ...over,
  }
}

const row = (id: string, turn: number, text: string): RenderMessage => ({
  id, kind: 'assistant', text, seq: turn * 10, time: AT, turn,
})

const THREE = [row('a1', 1, '一'), row('a2', 2, '二'), row('a3', 3, '三')]
/** 真机一屏的行数量级：用它来断言"一次轻点重画了 0 行"，而不是 3 行时的巧合。 */
const MANY = Array.from({ length: 20 }, (_, index) => row(`m${index + 1}`, index + 1, `第 ${index + 1} 条`))

/** 父组件持有一个与消息毫无关系的状态：它一变，就是真机里"点了一下按钮"。 */
function Host({ view }: { view: ChatRowsView }) {
  const [bump, setBump] = useState(0)
  return (
    <>
      <button type="button" onClick={() => { setBump(value => value + 1) }}>bump{bump}</button>
      <ChatRows {...view} />
    </>
  )
}

beforeEach(() => { rendered.length = 0; hydratedFlags.length = 0 })
afterEach(() => { cleanup(); resetSessionStoreForTest() })

describe('消息列表的渲染边界', () => {
  it('与消息无关的状态变化：一行都不重画（20 行规模）', () => {
    const view = viewOf(MANY)
    render(<Host view={view} />)
    expect(rendered).toHaveLength(20)

    rendered.length = 0
    // 同一次渲染里把 bump 推上去：props 全部引用不变 → ChatRows 的 memo 必须 bail out
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button').textContent).toBe('bump1')
    expect(rendered).toEqual([])
  })

  it('只改一条消息：只有那一行重画（其余行连 props 比对都不该换引用）', () => {
    const view = viewOf(THREE)
    const { rerender } = render(<ChatRows {...view} />)
    expect(rendered).toEqual(['a1', 'a2', 'a3'])

    rendered.length = 0
    // 只换 messages，其余 props 引用一律沿用 —— 这正是 ChatView 现在的契约
    rerender(<ChatRows {...view} messages={[THREE[0]!, THREE[1]!, row('a3', 3, '三（改过）')]} />)
    expect(rendered).toEqual(['a3'])
  })

  it('秒表心跳只惊动正在跑的那一行', () => {
    const isRunning = (message: RenderMessage): boolean => message.turn === 3
    const view = viewOf(THREE, { liveTurn: 3, isRowRunning: isRunning })
    const { rerender } = render(<ChatRows {...view} />)
    rendered.length = 0
    // 心跳已下沉到行内部（MessageRow 的 rowRunning 自己起搏）：父级再传 tick 也
    // 不该惊动任何一行 —— 运行行的秒表由它自己每秒重画，与列表无关。
    rerender(<ChatRows {...view} liveClockTick={1} />)
    expect(rendered).toEqual([])
  })

  it('宿主快照晚到：列表自己翻水合门，不等下一次 props 变化（C1）', () => {
    // 以前是渲染期直接 `cachedSnapshot()` 读仓：快照晚到时没有任何 props 变化，
    // `hydrated` 就停在 false —— 状态条一直判 unknown、行上的结论也不画。
    const view = viewOf(THREE)
    render(<ChatRows {...view} />)
    expect(hydratedFlags).toEqual([false, false, false])

    rendered.length = 0
    hydratedFlags.length = 0
    // props 一个都没换（同一份 view 对象）：列表必须自己订阅到这次发布并重画。
    act(() => { applySnapshot(snapshotOf('s1', AT) as never) })
    expect(rendered).toEqual(['a1', 'a2', 'a3'])
    expect(hydratedFlags).toEqual([true, true, true])
  })
})
