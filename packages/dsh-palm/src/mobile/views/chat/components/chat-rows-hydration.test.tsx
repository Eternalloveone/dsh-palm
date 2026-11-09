// @vitest-environment jsdom
/**
 * 会话页水合门（真机：切会话/刚进会话，状态条先「已完成」，一秒后跳「运行中」）：
 *
 * 1. 未水合 + 没有行 → 首块是与真实任务头同构的骨架：**没有「加载中…」文案**，
 *    也没有任何结论态；
 * 2. 未水合 + 有缓存行（种子先上屏）→ 行照常画，但任务头是 `unknown`（灰、「—」）；
 * 3. 水合（本会话的宿主快照到齐）→ 一次性画真实状态，之后同一轮不许倒回 running；
 * 4. 切会话：A 的快照不会让 B 水合（B 仍是 unknown），B 也不画 A 的数据。
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RenderMessage } from '../../../render/messages.ts'
import { applySnapshot, resetSessionStoreForTest } from '../../../stream/session-store.ts'
import { ChatRows, type ChatRowsView } from './chat-rows.tsx'

const AT = 1_700_000_000_000

function snapshot(sessionId: string, asOf: number, running = false) {
  return { sessionId, rows: [], maxSeq: 1, queue: [], queueRevision: 0, turn: { running }, asOf }
}

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
    hasClosedTurn: () => false,
    rowOfInterrupted: (message) => message,
    rowKeyOf: (message) => message.id,
    estimateHeight: () => 80,
    focusMsgId: undefined,
    chatHitQuery: '',
    effectiveFocusQuery: undefined,
    regenerateFor: () => undefined,
    regenerateState: 'idle',
    stickyProcRow: undefined,
    hasOlder: false,
    loading: false,
    loadOlder: () => undefined,
    onOpenFile: () => undefined,
    ...over,
  }
}

const assistantRow = (turn: number, extra: Partial<RenderMessage> = {}): RenderMessage => ({
  id: `a${turn}`,
  kind: 'assistant',
  text: '做完了',
  seq: 10,
  time: AT,
  turn,
  ...extra,
})

beforeEach(() => { resetSessionStoreForTest() })
afterEach(() => { cleanup(); resetSessionStoreForTest() })

describe('未水合：只画骨架，不画任何结论态', () => {
  it('没有行 + 没有宿主快照 → 任务头骨架，且没有「加载中…」「已完成」', () => {
    const { container } = render(<ChatRows {...viewOf({ loading: true })} />)
    expect(container.querySelector('[data-skeleton]')).not.toBeNull()
    expect(container.querySelector('.palm-turn-head')?.getAttribute('data-kind')).toBe('unknown')
    expect(container.textContent).not.toContain('加载中')
    expect(container.textContent).not.toContain('已完成')
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('有缓存行（种子先上屏）但没水合：行照画，任务头 unknown、不报耗时', () => {
    // 缓存页是"回合还在跑"时的快照：没有 turn/end 的用时，也就没有任何收工证据。
    const row = assistantRow(3, { turnStartAt: AT - 5_000, pending: true })
    const { container } = render(<ChatRows {...viewOf({ messages: [row] })} />)
    expect(container.querySelector('.chat-msg-assistant')).not.toBeNull()
    const head = container.querySelector('.palm-turn-head')!
    expect(head.getAttribute('data-kind')).toBe('unknown')
    expect(container.querySelector('.palm-turn-state')!.textContent).toBe('—')
    expect(container.querySelector('.palm-turn-time')).toBeNull()
    // 任务头与状态条都不下结论（过程折叠条是逐步骤摘要，另有口径）。
    expect(head.textContent).not.toContain('已完成')
    expect(container.querySelector('.palm-strip')!.textContent).not.toContain('已完成')
  })

  it('行已到但快照未到：过程条头行与任务头同为 unknown，不再各说一套', () => {
    // 过程折叠条曾经绕开这道门：任务头已经画「—」了，它的头行还在按 settled 猜
    // 「已完成 / 深度求索中」。两者必须是同一个结论（都 unknown）。
    const row = assistantRow(3, {
      text: '',
      pending: true,
      turnStartAt: AT - 5_000,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [{ callId: 'c1', name: 'bash', state: 'running', arguments: '{"cmd":"pnpm test"}' }],
    })
    const { container } = render(<ChatRows {...viewOf({
      messages: [row],
      liveTurn: 3,
      isRowRunning: () => true,
      settledOf: () => false,
    })} />)

    expect(container.querySelector('.palm-turn-head')!.getAttribute('data-kind')).toBe('unknown')
    const proc = container.querySelector('.chat-proc-head') as HTMLElement
    expect(proc.getAttribute('data-state')).toBe('unknown')
    // 工具计数是实际行数据，保留；状态词与耗时是结论，不出现。
    expect(proc.querySelector('.chat-proc-state')!.textContent).toBe('1 次工具调用')
    expect(proc.querySelector('.chat-proc-time')).toBeNull()
    expect(proc.textContent).not.toContain('已完成')
    expect(proc.textContent).not.toContain('深度求索中')
  })
})

describe('水合后：一次性画真实状态，且不回退', () => {
  it('宿主快照到齐 + 有行 → 终态照旧，unknown 不再出现', () => {
    applySnapshot(snapshot('s1', AT - 500))
    const row = assistantRow(3, { durationMs: 12_400, turnStartAt: AT - 12_400 })
    const { container } = render(<ChatRows {...viewOf({ messages: [row] })} />)
    expect(container.querySelector('.palm-turn-head')!.getAttribute('data-kind')).toBe('done')
    expect(container.querySelector('.palm-turn-state')!.textContent).toBe('已完成')
    expect(container.querySelector('.palm-turn-time')!.textContent).toBe('12.4s')
  })

  it('过期的快照不算水合（超过 12s 的新鲜窗），仍只画 unknown', () => {
    applySnapshot(snapshot('s1', AT - 60_000))
    const row = assistantRow(3, { turnStartAt: AT - 60_000 })
    const { container } = render(<ChatRows {...viewOf({ messages: [row] })} />)
    expect(container.querySelector('.palm-turn-head')!.getAttribute('data-kind')).toBe('unknown')
    expect(container.querySelector('.palm-turn-state')!.textContent).toBe('—')
    expect(container.querySelector('.palm-turn-head')!.textContent).not.toContain('已完成')
    expect(container.querySelector('.palm-strip')!.textContent).not.toContain('已完成')
  })
})

describe('切会话：A 的缓存不会画到 B 上', () => {
  it('只有 A 的快照时，B 仍是未水合（骨架 + unknown）', () => {
    applySnapshot(snapshot('session-a', AT - 100))
    const { container } = render(<ChatRows {...viewOf({ sessionId: 'session-b', loading: true })} />)
    expect(container.querySelector('[data-skeleton]')).not.toBeNull()
    expect(container.textContent).not.toContain('加载中')
    // B 没有行，也没有任何来自 A 的内容。
    expect(container.querySelector('.chat-msg')).toBeNull()
    expect(container.textContent).not.toContain('做完了')
  })

  it('B 有自己的新鲜快照时才算水合（空态文案而不是骨架）', () => {
    applySnapshot(snapshot('session-a', AT - 100))
    applySnapshot(snapshot('session-b', AT - 100))
    const { container } = render(<ChatRows {...viewOf({ sessionId: 'session-b' })} />)
    expect(container.querySelector('[data-skeleton]')).toBeNull()
    expect(container.textContent).toContain('还没有消息')
  })
})
