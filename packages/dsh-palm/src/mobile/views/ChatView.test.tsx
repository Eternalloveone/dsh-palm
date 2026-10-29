// @vitest-environment jsdom
/** ChatView: collapsible message folds, toolbar chips, and the bottom sheets. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { SessionModels } from '../../api-proxy-types'
import { ChatView, loadTurnReportRows, MAX_TAIL_BUFFER_EVENTS, offersRegenerate, quotePathForReference, renderRows, RUNNING_RECONCILE_MS } from './ChatView.tsx'
import { addOptimisticQueueItem, resetSessionStoreForTest } from '../session-store.ts'
import { resetToastsForTest, ToastHost } from '../toast.tsx'

import { sessionState } from '../api.ts'
import { LONG_TEXT_LIMIT } from '../markdown-text.tsx'
import { type SessionView, type ChatPageResult } from './App.tsx'
import type { HistoryPage, SessionPage } from '../api.ts'
import { EventFolder, foldEvents, latestTodoSnapshot } from '../messages.ts'
import type { RenderMessage, WireEvent } from '../messages.ts'
import { loadDraft, sessionListCache } from '../list-persist.ts'
import { answeredApprovals } from '../approval-batches.ts'
import { answeredQuestions } from '../question-batches.ts'
import { RpcCallError } from '../rpc.ts'
import { readQueuedEchoes, rememberQueuedEcho } from '../queued-echo.ts'
import { clearChatSnapshots } from '../chat-snapshot.ts'
import { loadCachedHistory } from '../history-cache.ts'
import { clearLocateIntent, rememberLocateIntent } from '../locate-intent.ts'

// The api module is fully mocked; App.tsx's chat-page loader is overridden to
// feed fixed folded pages, its pure helpers (errorText / formatTime) stay real.
vi.mock('../api.ts', () => ({
  fetchMobilePreferences: vi.fn(),
  models: vi.fn(),
  selectModel: vi.fn(),
  sendCommand: vi.fn(),
  cancelSession: vi.fn(),
  fetchPending: vi.fn(),
  respondApproval: vi.fn(),
  respondQuestion: vi.fn(),
  renameSession: vi.fn(),
  archiveSession: vi.fn(async () => ({ archivedSessionIds: [] })),
  listSessions: vi.fn(),
  history: vi.fn(),
  // Default: the tail channel is unavailable, so the reconcile falls back to the
  // history scan these tests were written against. The tail path has its own
  // tests that opt in.
  logTail: vi.fn(async () => { throw new Error('unavailable') }),
  readChat: vi.fn(),
  // 默认「没有会话在跑」：核对问宿主时拿到空集合。
  runningSessions: vi.fn(async () => ({ sessionIds: [] })),
  // 默认宿主没有 turnState 这个方法：核对于是走日志尾页那套（这些用例就是为那条路径写的）。
  // 专测 turnState 的用例自己 opt in。
  turnState: vi.fn(async () => { throw new Error('unsupported') }),
  // 卡片缺失时会把页面真实形状报给宿主（mobile.perf）：默认静默接受。
  reportPerf: vi.fn(async () => ({ file: 'capture-test.json', bytes: 1 })),
  subagentsList: vi.fn(),
  // 会话内搜索（期 3）：默认索引里没有任何命中，专测它的用例自己排返回值。
  searchSessions: vi.fn(async () => ({ items: [], total: 0, hasMore: false, tookMs: 0 })),
  updateQueue: vi.fn(async () => {}),
  // 「电脑文件」面板默认列一个空目录；专测它的用例自己排返回值。
  listDirectory: vi.fn(async () => ({ path: 'C:\\\\', home: 'C:\\\\', crumbs: [], entries: [], truncated: false })),
  // 默认宿主没有任何排队消息；排队相关的用例自己改返回值。
  inboxOf: vi.fn(async () => ({ inbox: null })),
  // 原子快照（行 + 队列 + 回合）：默认没有任何在跑的回合与排队项，用例自己改。
  // 默认让这条新通道不可用：这些老用例测的是 inbox 投影那条回退路径。
  // 专门测原子快照的用例自己 mockResolvedValue 一份即可。
  sessionState: vi.fn(async () => { throw new Error('sessionState unavailable in this fake host') }),
  goalOf: vi.fn(async () => ({ goal: null })),
  // 斜杠命令目录：默认给一条带参的命令，专门的用例自己改返回值。
  listCommands: vi.fn(async () => [{ name: 'goal', description: '设置或查看长期任务目标' }]),
  // 目标动作默认走原生通道并成功；专门测降级的用例自己改成 reject。
  goalAction: vi.fn(async () => ({ goal: { current: { id: 'g-1', objective: '目标', phase: 'active', revision: 2 } } })),
  // 语音转写走宿主：默认给一句固定的转写文本。
  transcribeVoice: vi.fn(async () => '转写出来的文本'),
  // 附件上传：默认成功，专门的用例自己改返回值/抛错。
  uploadAttachment: vi.fn(async (_sessionId: string, file: { name: string }) => ({ receiptId: `receipt-${file.name}`, name: file.name, bytes: 12 })),
  queueItemViewOf: (item: { id: string; placement: 'queued' | 'steering' | 'context'; message?: { content?: unknown } }) => {
    const blocks = Array.isArray(item.message?.content)
      ? (item.message.content as Array<{ type?: string; text?: string }>)
      : []
    const editable = blocks.length > 0 && blocks.every(block => block.type === 'text' && typeof block.text === 'string')
    return {
      id: item.id,
      placement: item.placement,
      text: editable ? (blocks as Array<{ text: string }>).map(block => block.text).join('') : '',
      editable,
    }
  },
}))
vi.mock('./App.tsx', async importOriginal => {
  const actual = await importOriginal<typeof import('./App.tsx')>()
  return {
    ...actual,
    loadChatPage: vi.fn(),
    prompt: vi.fn(async () => {}),
  }
})
vi.mock('../voice-input.ts', () => ({
  startVoiceRecording: vi.fn(),
  voiceSupported: vi.fn(() => false),
}))
// 缓存首发默认关闭（真机缓存来自 IndexedDB，jsdom 里没有）：专测"缓存先画、
// 页后落"的用例自己排一个缓存页。
vi.mock('../history-cache.ts', () => ({
  loadCachedHistory: vi.fn(async () => undefined),
  saveCachedHistory: vi.fn(async () => {}),
}))
vi.mock('../offline.ts', () => ({
  enqueuePrompt: vi.fn(),
  // Real flushOutbox is async and always resolves a FlushResult; the mock
  // must return a promise too, or ChatView's `void flushOutbox(...).then`
  // throws on the offline-banner path.
  flushOutbox: vi.fn(async () => ({ sent: 0, failed: 0 })),
  listOutbox: vi.fn(async () => []),
  removeFromOutbox: vi.fn(),
  removeOutboxForSession: vi.fn(),
}))
import { archiveSession as archiveSessionApiMock, fetchMobilePreferences, models, selectModel, sendCommand, cancelSession, fetchPending, respondApproval, respondQuestion, listSessions, history, logTail, readChat, runningSessions, turnState, subagentsList, searchSessions, updateQueue as updateQueueMock } from '../api.ts'
import { loadChatPage, prompt } from './App.tsx'
import { startVoiceRecording, voiceSupported, type VoiceRecording } from '../voice-input.ts'
import { transcribeVoice } from '../api.ts'
import { listOutbox, removeFromOutbox, removeOutboxForSession } from '../offline.ts'

const session: SessionView = {
  sessionId: 's-1',
  title: '测试会话',
  updatedAt: 1_700_000_000_000,
  running: false,
  blank: false,
}

/** Assemble one history entry wrapping a WireEvent (host history-page shape). */
function makeEntry(type: string, data: unknown, seq: number): { event: WireEvent } {
  return { event: { type, seq, time: seq * 1_000, data } }
}

/** One history entry with an explicit host time (makeEntry pins `time` to
 *  seq*1000, which no turn-clock math can use). */
function makeEntryAt(type: string, data: unknown, seq: number, time: number): { event: WireEvent } {
  return { event: { type, seq, time, data } }
}

/** Emit one session frame for the chat's session with an explicit host time. */
function emitSessionFrame(mux: FakeMux, type: string, seq: number, time: number, data: unknown): void {
  act(() => {
    mux.emit({ type: 'session/event', sessionId: 's-1', event: { type, seq, time, data } as WireEvent })
  })
}

/** A turn/start the FOLD can attribute to `turn`: the pending row it opens
 *  carries the logged start as its clock anchor (row-level, not view-level). */
function emitTurnStart(mux: FakeMux, seq: number, time: number, turn = 0): void {
  emitSessionFrame(mux, 'turn/start', seq, time, { turn })
}

/** One assistant text chunk: a live chunk is what materializes the pending row
 *  the process card hangs its clock on (the status bar no longer counts). */
function emitChunk(mux: FakeMux, seq: number, time: number, turn = 0): void {
  emitSessionFrame(mux, 'assistant/chunk', seq, time, {
    turn,
    step: 0,
    chunk: { type: 'text-delta', index: 0, text: '在写' },
  })
}

/** Flush the rAF-batched live fold so a just-emitted frame is in the DOM.
 *  The flush is scheduled on requestAnimationFrame, and sinon's fake rAF grid is
 *  16.667 ms (60 fps) — advancing exactly 16 ms never fires it, so the emitted
 *  frame would stay invisible. 50 ms crosses that grid deterministically. */
function flushLiveFold(): void {
  act(() => { vi.advanceTimersByTime(50) })
}

/**
 * 冲刷 live 事件直到它真的落进 DOM：先让尾页 promise 落地（尾页没落地时 live
 * 帧只会进 tail 缓冲区，不折叠），再推一帧 rAF 合并折叠。
 */
async function settleLiveFold(): Promise<void> {
  await act(async () => { await Promise.resolve() })
  flushLiveFold()
}

/** 假时钟下不能等 findBy/waitFor（它们会自己推计时器）：把尾页 promise 链
 *  手动推完（只走微任务，不推计时器），这一步同时把 tailLoading 关掉 ——
 *  否则后续 live 帧只会进 tail 缓冲区，不折叠，行永远不出现。 */
async function flushPageLoad(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await Promise.resolve() })
  }
}

/** The bottom status line — 措辞＋三个点，按契约里面**没有**秒表。 */
function turnStatusEl(): HTMLElement {
  return document.querySelector('.chat-turn-status') as HTMLElement
}

/** The (single) expandable process head, once its row has rendered. */
async function findProcHead(): Promise<HTMLButtonElement> {
  return await waitFor(() => {
    const el = document.querySelector('button.chat-proc-head')
    expect(el).not.toBeNull()
    return el as HTMLButtonElement
  })
}

/** 过程卡的头：有过程行时是 button，纯文本回合是静态 div —— 秒表都在第一行。 */
function procHeadEl(): HTMLElement {
  return document.querySelector('.chat-proc-head') as HTMLElement
}

/** 折叠头第一行：状态词 + 时间半句（秒表只在这一处）。 */
function procStateOf(head: HTMLElement): string {
  return head.querySelector('.chat-proc-state')?.textContent ?? ''
}
function procTimeOf(head: HTMLElement): string {
  return head.querySelector('.chat-proc-time')?.textContent ?? ''
}
/** 折叠头第二行："此刻进行到哪一步"（没渲染时是空串）。 */
function procCurrentOf(head: HTMLElement): string {
  return head.querySelector('.chat-proc-current-text')?.textContent ?? ''
}

/** One history entry with a host presentation view riding beside the event. */
function makeEntryWithView(type: string, data: unknown, seq: number, view: unknown): { event: WireEvent; view: unknown } {
  return { event: { type, seq, time: seq * 1_000, data }, view }
}

/** Build a raw history page from loose wire events (the running-reconcile
 *  probe consumes event shapes, not folded rows). */
function historyPage(events: Array<{ event: WireEvent }>, extra: Record<string, unknown> = {}): HistoryPage {
  return { events: events as never, hasMore: false, ...extra } as HistoryPage
}

/** Fold raw history entries into a v3 chat page (the host-folded shape the
 *  ChatView consumes: rows + event watermark + todo/projections seeds). The
 *  per-entry host presentation view rides into the fold like the live mux
 *  frames do (see ChatView's frame handling). */
function rowPage(events: Array<{ event: WireEvent; view?: unknown }>, extra: Record<string, unknown> = {}): ChatPageResult {
  const wireEvents = events.map(entry => (
    { ...entry.event, ...(entry.view !== undefined ? { view: entry.view } : {}) }
  ))
  const folder = new EventFolder(foldEvents(wireEvents))
  const todo = latestTodoSnapshot(wireEvents)
  return {
    rows: folder.snapshot(),
    maxSeq: folder.lastSeq,
    hasMore: false,
    ...(todo === undefined ? {} : { todo }),
    ...extra,
  } as ChatPageResult
}

/** Minimal mux stand-in: captures the ChatView's frame listener for hand-off. */
class FakeMux {
  listeners = new Set<(frame: unknown) => void>()
  cached: Record<string, unknown[]> = {}
  cachedJobsFor(sessionId: string): unknown[] | undefined {
    return this.cached[sessionId]
  }
  cachedQueueFor(): unknown[] | undefined {
    return undefined
  }
  onFrame(listener: (frame: unknown) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  emit(frame: unknown): void {
    for (const listener of this.listeners) listener(frame)
  }
  isSseLive(): boolean {
    return true
  }
  /** The real client pokes a poll after a send; a fake lacking it turns the
   *  send success path into an unhandled rejection instead of a failed assert. */
  poke(): void {}
}

/** A full turn: user message, reasoning + text chunks, tool calls, final message. */
function turnEvents(): Array<{ event: WireEvent }> {
  return [
    makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '改一下代码' }] }, 0),
    makeEntry('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'reasoning-delta', index: 0, text: '先看结构' } }, 1),
    makeEntry('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'reasoning-delta', index: 0, text: '\n再看细节' } }, 2),
    makeEntry('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 1, text: '正在处理' } }, 3),
    makeEntry('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' }, 4),
    makeEntry('assistant/message', {
      turn: 0,
      step: 0,
      message: {
        id: 'a-1',
        role: 'assistant',
        content: [
          { type: 'reasoning', text: '先看结构\n再看细节' },
          { type: 'text', text: '已完成修改' },
        ],
      },
    }, 5),
  ]
}

/** turnEvents with its tool call settled by a `tool/result`. turnEvents itself
 *  deliberately leaves the call running (the row must keep reading 运行中 —
 *  see the process-timeline row contract); the settled-turn contracts use this
 *  variant so the row really is "已结束" under the widened liveness rule
 *  (a still-running tool now means the turn is running). */
function settledTurnEvents(): Array<{ event: WireEvent }> {
  return [
    ...turnEvents(),
    makeEntry('tool/result', { turn: 0, step: 0, message: { source: { callId: 'c1' } } }, 6),
  ]
}

const fetchMobilePreferencesMock = vi.mocked(fetchMobilePreferences)
const modelsMock = vi.mocked(models)
const selectModelMock = vi.mocked(selectModel)
const sendCommandMock = vi.mocked(sendCommand)
const cancelSessionMock = vi.mocked(cancelSession)
const fetchPendingMock = vi.mocked(fetchPending)
const respondApprovalMock = vi.mocked(respondApproval)
const respondQuestionMock = vi.mocked(respondQuestion)
const listSessionsMock = vi.mocked(listSessions)
const historyMock = vi.mocked(history)
const searchSessionsMock = vi.mocked(searchSessions)
const logTailMock = vi.mocked(logTail)
const readChatMock = vi.mocked(readChat)
const runningSessionsMock = vi.mocked(runningSessions)
const turnStateMock = vi.mocked(turnState)
const loadChatPageMock = vi.mocked(loadChatPage)
const subagentsListMock = vi.mocked(subagentsList)
const promptMock = vi.mocked(prompt)
const startVoiceRecordingMock = vi.mocked(startVoiceRecording)
const voiceSupportedMock = vi.mocked(voiceSupported)
const removeOutboxForSessionMock = vi.mocked(removeOutboxForSession)
const listOutboxMock = vi.mocked(listOutbox)
const removeFromOutboxMock = vi.mocked(removeFromOutbox)

beforeEach(() => {
  // 状态仓与 toast 都是模块级单例：每个用例开始时清空，免得乐观项/隐藏表/C 串到下一条。
  resetSessionStoreForTest()
  // toast 自带 2.2 秒定时器：不清就会让「这次不该弹已排队」测到上一条的回执。
  resetToastsForTest()
  // 内存快照是模块级状态：每条用例都从'没打开过这场'开始。
  clearChatSnapshots()
  fetchMobilePreferencesMock.mockResolvedValue({ mobileEnterToSend: true })
  promptMock.mockResolvedValue(undefined)
  modelsMock.mockResolvedValue({
    current: { provider: 'fx', model: 'fx-1' },
    routable: true,
    groups: [
      {
        id: 'fx',
        name: 'FX',
        models: [
          { id: 'fx-1', name: 'FX 标准' },
          { id: 'fx-2', name: 'FX 深度', reasoning: { efforts: [{ id: 'high', name: '高' }], defaultEffort: 'high' } },
        ],
      },
    ],
    failures: [],
  } satisfies SessionModels)
  selectModelMock.mockResolvedValue({ selected: { provider: 'fx', model: 'fx-2', reasoningEffort: 'high' } })
  sendCommandMock.mockResolvedValue({ matched: true })
  // 权限对账会顺手读一次 readChat：没给默认值的用例会拿到 undefined（真机不会），
  // 于是一个 .then 变成未处理拒绝。给个空页兜底。
  readChatMock.mockResolvedValue({ rows: [], maxSeq: 0, hasMore: false } as unknown as Awaited<ReturnType<typeof readChat>>)
  cancelSessionMock.mockResolvedValue({ accepted: true })
  fetchPendingMock.mockResolvedValue({ approvals: [], questions: [] })
  respondApprovalMock.mockResolvedValue(undefined)
  respondQuestionMock.mockResolvedValue(undefined)
  listSessionsMock.mockResolvedValue({ items: [], hasMore: false })
  // Default history tail: the turn has ended (so reconciliation may clear).
  historyMock.mockResolvedValue(historyPage([makeEntry('turn/end', {}, 99)]))
  subagentsListMock.mockResolvedValue({ entries: [], parentAvailable: true })
})

afterEach(() => {
  cleanup()
  // resetAllMocks (not clearAllMocks): a leftover mockResolvedValueOnce
  // queue from a failed test would otherwise leak into the next test's
  // history page (the auto-extend consumes one-shot mocks).
  vi.resetAllMocks()
  vi.restoreAllMocks()
  // Blank-session revocation seeds the roster cache + persisted store.
  sessionListCache.clear()
  // The answered-approval memory lives at module scope (it must outlive a chat
  // remount), so it has to be cleared between tests.
  answeredApprovals.clear()
  answeredQuestions.clear()
  localStorage.clear()
})

/** 把 `mobile.sessionState` 的 mock 还原成「这条通道不可用」（默认语义）。 */
function resetSessionStateMock(): void {
  const api = vi.mocked(sessionState)
  api.mockReset()
  api.mockImplementation(async () => { throw new Error('sessionState unavailable in this fake host') })
}

/**
   * 模拟读者自己滚动：先派发一次输入意图（滚轮），再改 scrollTop 并触发 scroll。
   *
   * 生产代码用「最近有没有输入」区分「读者的手势」和「程序化回声/浏览器滚动锚定」，
   * 只改 scrollTop 在真机上不会发生，所以这里补上输入事件，保持用例真实。
   */
  const userScroll = (scroller: Element, scrollTop: number): void => {
    fireEvent.wheel(scroller)
    fireEvent.scroll(scroller, { target: { scrollTop } })
  }

describe('ChatView message folds', () => {
  it('keeps reasoning inside the collapsed process group and reveals it after two taps', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(settledTurnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    // The folded turn renders: user bubble, the answer OUTSIDE the group, and
    // ONE collapsed process group holding the reasoning + tool work.
    expect(await screen.findByText('改一下代码')).toBeTruthy()
    expect(await screen.findByText('已完成修改')).toBeTruthy()
    // 折叠头是两行：第一行状态词（已结束的回合没有定格耗时时就只有状态词，P11 起
    // 卡面不再带"· N 步"），第二行报最后一步做了什么。
    const head = await findProcHead()
    expect(head.getAttribute('aria-expanded')).toBe('false')
    expect(head.querySelectorAll('.chat-proc-line')).toHaveLength(2)
    expect(procStateOf(head)).toBe('已完成')
    // 旧期望值 '1 步' → P11 新口径：步数移出卡面（展开体首行才报）。
    expect(procTimeOf(head)).toBe('')
    expect(head.textContent).not.toContain('步')
    expect(procCurrentOf(head)).toBe('运行命令 · ls')
    // Collapsed by default: neither the think row nor its text is in the DOM.
    expect(document.querySelector('.chat-think')).toBeNull()
    expect(screen.queryByText(/先看结构/)).toBeNull()

    // Tap 1 expands the group and mounts the folded think row — head only.
    fireEvent.click(head)
    expect(head.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('.chat-proc-body > .chat-proc-steps')!.textContent).toBe('共 1 步')
    const think = await screen.findByRole('button', { name: '深度思考 · 2 行' })
    expect(think.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('.chat-think-body')).toBeNull()
    expect(screen.queryByText(/再看细节/)).toBeNull()

    // Tap 2 reveals the reasoning text inside the think body.
    fireEvent.click(think)
    expect(think.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('.chat-think-body')!.textContent).toBe('先看结构\n再看细节')
    expect(screen.getByText(/再看细节/)).toBeTruthy()
  })

  it('keeps the tool step collapsed with a summary, then reveals arguments', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(settledTurnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    const head = await findProcHead()
    expect(head.getAttribute('aria-expanded')).toBe('false')
    expect(procStateOf(head)).toBe('已完成')
    // 旧期望值 '1 步' → P11 新口径：卡面不再带步数。
    expect(procTimeOf(head)).toBe('')
    expect(head.textContent).not.toContain('步')
    // 折叠时第二行已经报名了当前的/最后的一步（组头里就有"运行命令 · ls"）。
    expect(procCurrentOf(head)).toBe('运行命令 · ls')
    expect(screen.queryByText('{"cmd":"ls"}')).toBeNull()

    fireEvent.click(head)
    expect(head.getAttribute('aria-expanded')).toBe('true')
    // The group head carries the state/step line; the revealed step row carries
    // the Chinese verb plus the args-derived summary, and stays folded itself.
    // 范围限定在展开体里：组头第二行也含"运行命令"，不限定就会撞车。
    const body = document.querySelector('.chat-proc-body') as HTMLElement
    const step = await within(body).findByRole('button', { name: /运行命令/ })
    // 这一轮的调用已被 tool/result 收尾（settledTurnEvents）⇒ 行读"完成"；
    // "还在跑 ⇒ 运行中"那条契约由下面 process-timeline 的用例钉着。
    expect(screen.getByText('完成')).toBeTruthy()
    expect(screen.getByText('ls')).toBeTruthy()
    expect(screen.queryByText('{"cmd":"ls"}')).toBeNull()

    // Opening the row reveals its raw arguments (desktop's row → body).
    fireEvent.click(step)
    expect(await screen.findByText('{"cmd":"ls"}')).toBeTruthy()
  })

  it('renders each tool call as a process-timeline row with a Chinese state word and a family glyph', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    fireEvent.click(await findProcHead())
    const step = await within(document.querySelector('.chat-proc-body') as HTMLElement)
      .findByRole('button', { name: /运行命令/ })
    // 行首字形是 emoji（这条是 bash 族 = 齿轮 ⚙️），不再是桌面端那套静态 SVG。
    expect(step.querySelector('.chat-step-icon')!.textContent).toBe('⚙️')
    // No result event settled the call, so the row still reads 运行中. The old
    // coloured state dot is gone: state is spelled out in `.chat-step-state`.
    const stepRow = step.closest('.chat-step') as HTMLElement
    expect(stepRow.getAttribute('data-state')).toBe('running')
    expect(stepRow.querySelector('.chat-step-state')!.textContent).toBe('运行中')
    expect(step.querySelector('.chat-step-dot-running')).toBeNull()
    expect(step.querySelector('[class*="chat-step-dot"]')).toBeNull()
    expect(screen.getByText('运行命令')).toBeTruthy()
    expect(screen.getByText('ls')).toBeTruthy()
  })

  it('draws the running indicator as the whale, not the hourglass emoji', async () => {
    // The hourglass was an emoji, so it could not take the theme accent. The
    // running lead now paints the animated PNG (the desktop client's own asset)
    // as a currentColor mask, keeping the stroked path as the still fallback
    // for browsers without mask-mode and for reduced-motion users.
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    // The indicator only paints while the host says the turn runs (see
    // `settled`): an idle session's leftover rows must not claim it. The
    // reconcile probe must agree, or its fallback would retire the indicator
    // mid-test (the probe is a fallback now; the host pushes the verdict).
    listSessionsMock.mockResolvedValue({
      items: [{ sessionId: 's-1', running: true } as never],
      hasMore: false,
    } as SessionPage)
    render(<ChatView session={{ ...session, running: true }} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    const lead = await screen.findByRole('status', { name: /运行中/ }).then(
      () => document.querySelector('.chat-proc-lead-running'),
      () => document.querySelector('.chat-proc-lead-running'),
    )
    expect(lead).not.toBeNull()
    // Both layers exist; the stylesheet decides which one is painted.
    expect(lead!.querySelector('.chat-proc-whale-loop')).not.toBeNull()
    const still = lead!.querySelector('.chat-proc-whale-still')
    expect(still).not.toBeNull()
    expect(still!.tagName.toLowerCase()).toBe('svg')
    expect(still!.querySelector('path')!.getAttribute('stroke')).toBe('currentColor')
    // The emoji must be gone from the running lead entirely.
    expect(document.body.textContent).not.toContain('⏳')
  })

  it('窗口里没有 turn/start 时，收工用时按宿主给的起点定格（不在收工瞬间往回跳）', async () => {
    // 真机：一轮跑了 8分39秒，秒表数到 8分37秒，收工后卡片定格成 6分48秒 ——
    // 折叠窗口里看不到这一轮的 turn/start，收工只能退回"窗口最早一行"当锚点。
    // 宿主的页带着真起点（page.turnStartAt），它必须一路走到收工定格。
    const t0 = 1_700_000_000_000
    loadChatPageMock.mockResolvedValue(rowPage([
      makeEntryAt('user/message', { id: 'u-9', role: 'user', content: [{ type: 'text', text: '跑编译' }] }, 100, t0 + 120_000),
      makeEntryAt('assistant/message', {
        turn: 9,
        step: 0,
        message: { id: 'a-9', role: 'assistant', content: [{ type: 'text', text: '在跑编译' }] },
      }, 101, t0 + 130_000),
    ], { turnStartAt: t0 }))
    const mux = new FakeMux()
    render(<ChatView session={{ ...session, running: true }} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    expect(await screen.findByText('在跑编译')).toBeTruthy()
    await act(async () => {
      mux.emit({
        type: 'session/event',
        sessionId: 's-1',
        event: makeEntryAt('turn/end', { turn: 9, reason: { kind: 'completed' } }, 102, t0 + 300_000).event,
      })
    })

    // 真时钟下不用 settleLiveFold（它要假时钟）：findByText 自己会等 rAF 合并那一拍。
    // 300 秒（真起点 0 秒 → 收工 300 秒）；退回窗口最早一行只会是 170 秒。
    expect(await screen.findByText('用时5分0秒')).toBeTruthy()
    expect(screen.queryByText('用时2分50秒')).toBeNull()
  })

  it('renders the turn tail as a file report (the duration lives in the process head) at the end of the turn', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '写报告' }] }, 0),
      makeEntry('turn/start', { turn: 1 }, 1),
      makeEntry('assistant/message', {
        turn: 1,
        step: 0,
        message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '好了' }] },
      }, 2),
      makeEntry('deliverables/presented', { turn: 1, callId: 'c1', files: [{ path: 'report.md', description: '交付报告' }] }, 3),
      makeEntry('turn/end', { turn: 1, reason: { kind: 'done' } }, 4),
    ]))
    const { container } = render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    // The turn clock belongs to the non-interactive process head (this turn
    // ran no steps, so the head is a plain status line).
    const clock = await screen.findByText('用时3秒')
    const staticHead = clock.closest('.chat-proc-head-static') as HTMLElement
    expect(staticHead?.tagName).toBe('DIV')
    expect(staticHead?.getAttribute('aria-expanded')).toBeNull()
    expect(procStateOf(staticHead)).toBe('已完成')
    // 只有时钟、没有过程行 ⇒ 第二行不渲染（静态头只有一行）。
    expect(staticHead.querySelectorAll('.chat-proc-line')).toHaveLength(1)

    // The tail reports only what the turn handed back.
    const tail = await screen.findByText('本轮产出')
    expect(tail.closest('.chat-turn-tail')).not.toBeNull()
    expect(container.querySelector('.chat-turn-tail .chat-turn-tail-head .chat-turn-tail-count')!.textContent).toBe('1 个文件')
    // 用时不再在尾巴里重复报（它只在过程卡第一行，见上）。
    expect(tail.closest('.chat-turn-tail')!.textContent).not.toContain('用时')
    // 只有一组清单时不再重复内层标题（头部已经写了「本轮产出」）。
    expect(screen.queryByText('交付物')).toBeNull()
    expect(screen.queryByText('本轮产出文件')).toBeNull()
    // A declared deliverable carries the 已交付 badge on its file row.
    expect(screen.getByText('已交付')).toBeTruthy()
    const file = screen.getByRole('button', { name: /交付报告/ })
    expect(file.getAttribute('title')).toContain('report.md')
    // The tail is the last row of the turn.
    const rows = container.querySelectorAll('[data-message-id]')
    expect(rows[rows.length - 1]!.className).toContain('chat-turn-tail')
  })

it('交付卡同时有交付物与产出文件时，两组各自带内层标题', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '写报告' }] }, 0),
      makeEntry('turn/start', { turn: 1 }, 1),
      makeEntry('assistant/message', {
        turn: 1,
        step: 0,
        message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '好了' }] },
      }, 2),
      makeEntry('deliverables/presented', { turn: 1, callId: 'c1', files: [{ path: 'report.md', description: '交付报告' }] }, 3),
      makeEntry('tool/call', { turn: 1, step: 0, callId: 'c2', name: 'write_file', arguments: '{"path":"out.txt"}' }, 4),
      makeEntry('tool/result', { callId: 'c2', ok: true }, 5),
      makeEntry('turn/end', { turn: 1, reason: { kind: 'done' } }, 6),
    ]))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('本轮产出')
    expect(screen.getByText('交付物')).toBeTruthy()
    expect(screen.getByText('本轮产出文件')).toBeTruthy()
  })

  it('keeps the deliverable card after a reload that serves rows without a tail row', async () => {
    // 刷新后的复现：宿主折叠页只有行，没有那一轮的 turn/end，也就没有尾巴行。
    // 「本轮产出」不能因此消失 —— 卡片该由行里的事实重建。
    loadChatPageMock.mockResolvedValue({
      rows: [
        { id: 'u-1', kind: 'user', text: '写报告', seq: 0, time: 0 },
        {
          id: 'a-1',
          kind: 'assistant',
          text: '好了',
          seq: 2,
          time: 2_000,
          turn: 1,
          tools: [{ callId: 'c1', name: 'write', arguments: '{"file_path":"report.md"}', state: 'ok' }],
        },
      ],
      maxSeq: 4,
      hasMore: false,
    } as unknown as ChatPageResult)
    const { container } = render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    const title = await screen.findByText('本轮产出')
    expect(title.closest('.chat-turn-tail')).not.toBeNull()
    const tailRow = container.querySelector('.chat-turn-tail') as HTMLElement
    expect(tailRow.textContent).toContain('1 个文件')
    expect(tailRow.textContent).toContain('report.md')
  })

  it('reads the log for the card when the page kept only tool names (no arguments)', async () => {
    // 真机复现：页里只剩工具名（参数被投影剥掉、diff 视图只活在实时帧里），
    // 页自己拼不出卡片 —— 这时才回读一次日志原文，用手机自己的折叠补回来。
    loadChatPageMock.mockResolvedValue({
      rows: [
        { id: 'u-1', kind: 'user', text: '写报告', seq: 0, time: 0 },
        {
          id: 'a-1',
          kind: 'assistant',
          text: '好了',
          seq: 2,
          time: 2_000,
          turn: 1,
          tools: [{ callId: 'c1', name: 'write_file', state: 'ok' }],
        },
      ],
      maxSeq: 4,
      hasMore: false,
    } as unknown as ChatPageResult)
    historyMock.mockResolvedValue(historyPage([
      makeEntry('turn/start', { turn: 1 }, 1),
      makeEntry('tool/call', { turn: 1, step: 0, callId: 'c1', name: 'write_file', arguments: '{"file_path":"report.md"}' }, 3),
      makeEntry('tool/result', { turn: 1, step: 0, message: { source: { callId: 'c1' } } }, 4),
      makeEntry('turn/end', { turn: 1 }, 5),
    ]))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    const title = await screen.findByText('本轮产出')
    expect(title.closest('.chat-turn-tail')).not.toBeNull()
    expect(historyMock).toHaveBeenCalledTimes(1)
  })
  it('reads the log when the page kept only shell calls, so no write name is left', async () => {
    // 真机复现（这一轮卡片彻底不见）：窗口只留最近的几步，这一轮早先的 edit 被
    // 截掉，页里只剩 pwsh —— 旧判据按工具名找"会交回文件"的调用，于是永远不补读。
    const page = rowPage([
      makeEntry('user/message', { id: 'u-1', content: [{ type: 'text', text: '改代码' }] }, 0),
      makeEntry('assistant/message', {
        turn: 12,
        step: 3,
        message: { id: 'a-12', role: 'assistant', content: [{ type: 'text', text: '改完了' }] },
      }, 9),
    ]) as ChatPageResult
    page.rows = page.rows.map(row => (row.kind === 'assistant'
      ? { ...row, tools: [{ callId: 'c-shell', name: 'pwsh', state: 'ok' as const }] }
      : row))
    loadChatPageMock.mockResolvedValue(page)
    historyMock.mockResolvedValue(historyPage([
      makeEntry('turn/start', { turn: 12 }, 1),
      makeEntry('tool/call', { turn: 12, step: 0, callId: 'c-edit', name: 'edit', arguments: '{"file_path":"src/a.ts"}' }, 2),
      makeEntry('tool/result', { turn: 12, step: 0, message: { source: { callId: 'c-edit' } } }, 3),
      makeEntry('turn/end', { turn: 12 }, 10),
    ]))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    const title = await screen.findByText('本轮产出')
    expect(title.closest('.chat-turn-tail')?.textContent).toContain('a.ts')
    expect(historyMock).toHaveBeenCalledTimes(1)
  })

  it('replaces a page-guessed card with the log one, even when the page already had a card', async () => {
    // 根治点：页给出的卡片只是猜测（窗口截断会让它缺文件）。日志才是唯一来源 ——
    // 页里已经有卡也要按日志校正一次，否则"少列文件"会一直留在屏幕上。
    loadChatPageMock.mockResolvedValue({
      rows: [
        { id: 'u-1', kind: 'user', text: '改两个文件', seq: 0, time: 0 },
        {
          id: 'a-1',
          kind: 'assistant',
          text: '好了',
          seq: 2,
          time: 2_000,
          turn: 4,
          tools: [{ callId: 'c1', name: 'edit', state: 'ok' }],
        },
        { id: 'turn-tail:4', kind: 'turn', text: '', seq: 3, time: 3_000, turn: 4, produced: ['one.ts'] },
      ],
      maxSeq: 5,
      hasMore: false,
    } as unknown as ChatPageResult)
    historyMock.mockResolvedValue(historyPage([
      makeEntry('turn/start', { turn: 4 }, 1),
      makeEntry('tool/call', { turn: 4, step: 0, callId: 'c1', name: 'edit', arguments: '{"file_path":"one.ts"}' }, 2),
      makeEntry('tool/result', {
        turn: 4,
        step: 0,
        message: { source: { callId: 'c1' } },
        meta: { path: 'one.ts', diffs: [{ path: 'one.ts', oldText: 'a', newText: 'b' }] },
      }, 3),
      makeEntry('tool/call', { turn: 4, step: 1, callId: 'c2', name: 'edit', arguments: '{"file_path":"two.ts"}' }, 4),
      makeEntry('tool/result', {
        turn: 4,
        step: 1,
        message: { source: { callId: 'c2' } },
        meta: { path: 'two.ts', diffs: [{ path: 'two.ts', oldText: 'a', newText: 'b' }] },
      }, 5),
      makeEntry('turn/end', { turn: 4 }, 9),
    ]))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    await waitFor(() => {
      const card = document.querySelector('.chat-turn-tail')
      expect(card?.textContent ?? '').toContain('two.ts')
    })
  })
  it('recovers a card for a turn that arrived from an older page, not the first one', async () => {
    // 真机：页落地时最新的那一轮有卡；再进一次会话窗口挪了一轮，那一轮变成
    // "从上翻页补进来的"，只在首屏补读就漏掉它 —— 卡片又不见了。
    // 补读要挂在整个列表上，任何来源的新回合都算。
    const newer: ChatPageResult = {
      rows: [
        { id: 'u-2', kind: 'user', text: '第二问', seq: 100, time: 100_000 },
        {
          id: 'a-2',
          kind: 'assistant',
          text: '好了',
          seq: 102,
          time: 102_000,
          turn: 2,
          tools: [{ callId: 'c2', name: 'pwsh', state: 'ok' }],
        },
        { id: 'turn-tail:2', kind: 'turn', text: '', seq: 103, time: 103_000, turn: 2, produced: ['x.md'] },
      ],
      maxSeq: 103,
      hasMore: true,
    } as unknown as ChatPageResult
    const older: ChatPageResult = {
      rows: [
        { id: 'u-1', kind: 'user', text: '第一问', seq: 10, time: 10_000 },
        {
          id: 'a-1',
          kind: 'assistant',
          text: '改好了',
          seq: 12,
          time: 12_000,
          turn: 1,
          tools: [{ callId: 'c1', name: 'pwsh', state: 'ok' }],
        },
      ],
      maxSeq: 12,
      hasMore: false,
    } as unknown as ChatPageResult
    loadChatPageMock.mockResolvedValueOnce(newer).mockResolvedValueOnce(older)
    historyMock.mockResolvedValue(historyPage([
      makeEntry('turn/start', { turn: 1 }, 5),
      makeEntry('tool/call', { turn: 1, step: 0, callId: 'c1', name: 'edit', arguments: '{"file_path":"older.ts"}' }, 6),
      makeEntry('tool/result', { turn: 1, step: 0, message: { source: { callId: 'c1' } } }, 7),
      makeEntry('turn/end', { turn: 1 }, 9),
    ]))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    // 补进来的那一轮也要有卡。
    await waitFor(() => {
      const text = Array.from(document.querySelectorAll('.chat-turn-tail')).map(node => node.textContent ?? '').join(' | ')
      expect(text).toContain('older.ts')
    })
    expect(await screen.findByText('第一问')).toBeTruthy()
  })
  it('pages back until the whole turn is in hand, so the card lists every file', async () => {
    // 真机复现：按条数截断的回读只拿到回合后半段，卡片就只列出几个文件。
    // 现在按页往前翻到那一轮的 turn/start，整轮一起折。
    loadChatPageMock.mockResolvedValue({
      rows: [
        { id: 'u-1', kind: 'user', text: '写两份报告', seq: 0, time: 0 },
        {
          id: 'a-1',
          kind: 'assistant',
          text: '好了',
          seq: 2,
          time: 2_000,
          turn: 1,
          tools: [{ callId: 'c1', name: 'write_file', state: 'ok' }],
        },
      ],
      maxSeq: 40,
      hasMore: false,
    } as unknown as ChatPageResult)
    // 尾页只有回合收尾：没有 turn/start，也就没有那两次写文件的调用。
    historyMock.mockResolvedValueOnce(historyPage([
      makeEntry('assistant/message', { turn: 1, step: 3, message: { role: 'assistant', content: '写好了' } }, 30),
      makeEntry('turn/end', { turn: 1 }, 40),
    ], { hasMore: true }))
    // 再往前一页：turn/start 与两次写文件都在这里。
    historyMock.mockResolvedValueOnce(historyPage([
      makeEntry('turn/start', { turn: 1 }, 10),
      makeEntry('tool/call', { turn: 1, step: 0, callId: 'c1', name: 'write_file', arguments: '{"file_path":"a.md"}' }, 11),
      makeEntry('tool/call', { turn: 1, step: 1, callId: 'c2', name: 'write_file', arguments: '{"file_path":"b.md"}' }, 12),
      makeEntry('tool/result', { turn: 1, step: 1, message: { source: { callId: 'c2' } } }, 13),
    ], { hasMore: true }))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    const title = await screen.findByText('本轮产出')
    const tail = title.closest('.chat-turn-tail') as HTMLElement
    expect(tail.textContent).toContain('2 个文件')
    expect(tail.textContent).toContain('a.md')
    expect(tail.textContent).toContain('b.md')
    expect(historyMock).toHaveBeenCalledTimes(2)
    // 第二次是接着第一页的最早 seq 往前翻的。
    expect(historyMock.mock.calls[1]?.[1]).toBe(30)
  })

  it('does not stop at a half turn that already folds into a card with fewer files', async () => {
    // 只拿到回合后半段时，折叠也能凑出一张卡（后半段的那次写文件）——
    // 以前就停在这里，卡片少列文件。现在必须看到这一轮自己的 turn/start 才收工。
    loadChatPageMock.mockResolvedValue({
      rows: [
        { id: 'u-1', kind: 'user', text: '写两份报告', seq: 0, time: 0 },
        {
          id: 'a-1',
          kind: 'assistant',
          text: '好了',
          seq: 2,
          time: 2_000,
          turn: 1,
          tools: [{ callId: 'c1', name: 'write_file', state: 'ok' }],
        },
      ],
      maxSeq: 40,
      hasMore: false,
    } as unknown as ChatPageResult)
    // 尾页：回合后半段，只有 b.md 那次写文件（没有 turn/start）。
    historyMock.mockResolvedValueOnce(historyPage([
      makeEntry('tool/call', { turn: 1, step: 2, callId: 'c2', name: 'write_file', arguments: '{"file_path":"b.md"}' }, 31),
      makeEntry('tool/result', { turn: 1, step: 2, message: { source: { callId: 'c2' } } }, 32),
      makeEntry('turn/end', { turn: 1 }, 40),
    ], { hasMore: true }))
    // 往前一页：这一轮的起点与 a.md。
    historyMock.mockResolvedValueOnce(historyPage([
      makeEntry('turn/start', { turn: 1 }, 10),
      makeEntry('tool/call', { turn: 1, step: 0, callId: 'c1', name: 'write_file', arguments: '{"file_path":"a.md"}' }, 11),
      makeEntry('tool/result', { turn: 1, step: 0, message: { source: { callId: 'c1' } } }, 12),
    ], { hasMore: true }))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    const title = await screen.findByText('本轮产出')
    const tail = title.closest('.chat-turn-tail') as HTMLElement
    expect(tail.textContent).toContain('2 个文件')
    expect(tail.textContent).toContain('a.md')
    expect(tail.textContent).toContain('b.md')
    expect(historyMock).toHaveBeenCalledTimes(2)
  })

  it('holds the card until the turn really ends, even when its tools already settled', async () => {
    // 真机复现：回合还在跑（两步之间，工具都不在跑了），卡片就提前冒出来。
    // 页里的行不带"回合已结束"这个信号，重建只能看工具是否在跑 —— 所以跑着的
    // 那一轮一律不画报告卡，等 turn/end 到了再出。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    const { container } = render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('还没有消息，发一句话开始吧')
    vi.useFakeTimers()
    try {
      const t0 = 1_700_000_000_000
      vi.setSystemTime(t0)
      emitTurnStart(mux, 80, t0 - 5_000, 2)
      emitSessionFrame(mux, 'tool/call', 81, t0, {
        turn: 2,
        step: 0,
        callId: 'c1',
        name: 'write',
        arguments: '{"file_path":"mid.md"}',
      })
      emitSessionFrame(mux, 'tool/result', 82, t0, { turn: 2, step: 0, message: { source: { callId: 'c1' } } })
      await settleLiveFold()
      // 工具都结束了，但这一轮还没收尾：不许出卡。
      expect(container.querySelector('.chat-turn-tail')).toBeNull()

      emitSessionFrame(mux, 'turn/end', 83, t0, { turn: 2 })
      await settleLiveFold()
      const tail = container.querySelector('.chat-turn-tail') as HTMLElement | null
      expect(tail).not.toBeNull()
      expect(tail?.textContent).toContain('mid.md')
    } finally {
      vi.useRealTimers()
    }
  })
  it('keeps the card when the list is replaced by a fresh page (no blink on entry)', async () => {
    // 真机：「点进会话，交付物卡片突然又消失了」。进会话时列表会被整份换掉好几次
    // （缓存页 → 网络页 → /compact 之类的重拉），页本身不带报告行 —— 换一次卡就闪
    // 没一次。这条把"换列表也要把已经画出来的卡带走"钉住。
    const withTurn = {
      rows: [
        { id: 'u-1', kind: 'user', text: '改两个文件', seq: 0, time: 0 },
        {
          id: 'a-1',
          kind: 'assistant',
          text: '好了',
          seq: 2,
          time: 2_000,
          turn: 4,
          tools: [{ callId: 'c1', name: 'edit', state: 'ok' }],
        },
      ],
      maxSeq: 5,
      hasMore: false,
    } as unknown as ChatPageResult
    loadChatPageMock.mockResolvedValue(withTurn)
    historyMock.mockResolvedValue(historyPage([
      makeEntry('turn/start', { turn: 4 }, 1),
      makeEntry('tool/call', { turn: 4, step: 0, callId: 'c1', name: 'edit', arguments: '{"file_path":"one.ts"}' }, 2),
      makeEntry('tool/result', {
        turn: 4,
        step: 0,
        message: { source: { callId: 'c1' } },
        meta: { path: 'one.ts', diffs: [{ path: 'one.ts', oldText: 'a', newText: 'b' }] },
      }, 3),
      makeEntry('turn/end', { turn: 4 }, 9),
    ]))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await waitFor(() => {
      expect(document.querySelector('.chat-turn-tail')?.textContent ?? '').toContain('one.ts')
    })
    // 重拉尾页（/compact 收尾、宿主权威页晚到都会走这条路）：新页同样没有报告行。
    sendCommandMock.mockResolvedValue({ matched: true })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/compact' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)) })
    expect(loadChatPageMock.mock.calls.length).toBeGreaterThan(1)
    await act(async () => { await Promise.resolve() })
    expect(document.querySelector('.chat-turn-tail')?.textContent ?? '').toContain('one.ts')
  })

  it('shows the permission chip from the history-tail projection and applies via /permission', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents(), {
      projections: {
        asOfSeq: 4,
        values: {
          permissions: {
            options: [
              { value: 'read-only', name: '只读' },
              { value: 'workspace-write', name: '读写工作区' },
            ],
            currentValue: 'read-only',
          },  
        } as Record<string, unknown>,
      },
    }))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    const chip = await screen.findByRole('button', { name: /只读/ })
    fireEvent.click(chip)
    // The sheet lists the presets; picking one dispatches the slash command.
    const writeOption = await screen.findByRole('button', { name: /读写工作区/ })
    fireEvent.click(writeOption)
    await waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith('s-1', '/permission workspace-write')
    })
  })

  it('lets the host override the optimistic permission value', async () => {
    // 药丸先写乐观值给即时反馈，但宿主可能压根没落盘（或归一化成别的档位）。乐观值
    // 留在药丸上，用户下次点开选择器就会看到"选了却没生效" —— 命令成功后再问一次
    // 投影，以宿主为准。
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents(), {
      projections: {
        asOfSeq: 4,
        values: {
          permissions: {
            options: [
              { value: 'read-only', name: '只读' },
              { value: 'workspace-write', name: '读写工作区' },
            ],
            currentValue: 'read-only',
          },
        } as Record<string, unknown>,
      },
    }))
    // 宿主坚持只读：这次切换并没有真落盘。
    readChatMock.mockResolvedValue({
      rows: [],
      maxSeq: 4,
      hasMore: false,
      projections: {
        asOfSeq: 4,
        values: {
          permissions: {
            options: [
              { value: 'read-only', name: '只读' },
              { value: 'workspace-write', name: '读写工作区' },
            ],
            currentValue: 'read-only',
          },
        },
      },
    } as unknown as Awaited<ReturnType<typeof readChat>>)
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    fireEvent.click(await screen.findByRole('button', { name: /只读/ }))
    fireEvent.click(await screen.findByRole('button', { name: /读写工作区/ }))
    await waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith('s-1', '/permission workspace-write')
      expect(readChatMock).toHaveBeenCalledWith('s-1')
    })
    // 乐观值必须被宿主的答案盖回去。
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /只读/ })).toBeTruthy()
      expect(screen.queryByRole('button', { name: /读写工作区/ })).toBeNull()
    })
  })

  it('requires an explicit confirm before enabling full access', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents(), {
      projections: {
        asOfSeq: 4,
        values: {
          permissions: {
            options: [{ value: 'danger-full-access', name: '完全权限' }],
            currentValue: 'workspace-write',
          },  
        } as Record<string, unknown>,
      },
    }))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    // The chip shows the derived label for the unmatched current value. The
    // popover is now the ONLY preset list, so one tap on the preset must open
    // the confirmation rather than switching silently.
    fireEvent.click(await screen.findByRole('button', { name: /Workspace Write/ }))
    fireEvent.click(await screen.findByRole('button', { name: /完全权限/ }))
    expect(await screen.findByText(/确认完全权限/)).toBeTruthy()
    expect(sendCommandMock).not.toHaveBeenCalled()
    // Cancelling dispatches nothing; opening again and confirming submits.
    fireEvent.click(screen.getByRole('button', { name: /取消/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Workspace Write/ }))
    fireEvent.click(await screen.findByRole('button', { name: /完全权限/ }))
    fireEvent.click(await screen.findByRole('button', { name: /确认开启/ }))
    await waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith('s-1', '/permission danger-full-access')
    })
  })
})

describe('ChatView initial-load race', () => {
  /** Minimal mux stand-in: captures the ChatView's frame listener for hand-off. */
  class FakeMux {
    listeners = new Set<(frame: unknown) => void>()
    cachedJobsFor(): unknown[] | undefined {
      return undefined
    }
    cachedQueueFor(): unknown[] | undefined {
      return undefined
    }
    onFrame(listener: (frame: unknown) => void): () => void {
      this.listeners.add(listener)
      return () => { this.listeners.delete(listener) }
    }
    emit(frame: unknown): void {
      for (const listener of this.listeners) listener(frame)
    }
  }

  it('keeps live events that arrive while the tail page is still loading', async () => {
    let resolveHistory: (page: ChatPageResult) => void = () => {}
    loadChatPageMock.mockReturnValue(new Promise<ChatPageResult>((resolve) => { resolveHistory = resolve }))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    // A live turn starts before the snapshot resolves: chunk, tool call, final.
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('assistant/chunk', { turn: 1, step: 0, chunk: { type: 'text-delta', text: '正在' } }, 6).event })
      mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('tool/call', { turn: 1, step: 0, callId: 'c9', name: 'bash', arguments: '{"cmd":"ls"}' }, 7).event })
      mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('assistant/message', { turn: 1, step: 0, message: { id: 'a-9', role: 'assistant', content: [{ type: 'text', text: '实时新消息' }] } }, 8).event })
      // 调用收尾：还挂着的 running 工具会让这一行读成"运行中"，头也就不报步数
      // （liveness 判据见 message-row.tsx）。这条契约要的是两枚**已结束**的折叠头。
      mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('tool/result', { turn: 1, step: 0, message: { source: { callId: 'c9' } } }, 9).event })
    })
    // The snapshot predates those events; resolving it must not drop them.
    await act(async () => { resolveHistory(rowPage(settledTurnEvents())) })

    expect(await screen.findByText('实时新消息')).toBeTruthy()
    // The history turn's tool disclosure plus the live one both render (two
    // expandable process heads; the step count moved into the expanded body in
    // P11, so the old `button[name=/步/]` probe no longer names them).
    expect(document.querySelectorAll('button.chat-proc-head').length).toBe(2)
  })

  it('carries the host view on live mux frames into the tool diff card', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    const mux = new FakeMux()
    const { container } = render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')

    // A live write call arrives over the mux with its diff-card view.
    await act(async () => {
      mux.emit({
        type: 'session/event',
        sessionId: 's-1',
        event: makeEntry('assistant/chunk', { turn: 1, step: 0, chunk: { type: 'text-delta', text: '写文件' } }, 20).event,
      })
      mux.emit({
        type: 'session/event',
        sessionId: 's-1',
        event: makeEntry('tool/call', { turn: 1, step: 0, callId: 'c-live', name: 'write', arguments: '{"file_path":"b.txt"}' }, 21).event,
        view: { for: 'call', view: { card: 'diff', title: 'Write b.txt', diffs: [{ path: 'b.txt', oldText: 'old', newText: 'new' }] } },
      })
      mux.emit({
        type: 'session/event',
        sessionId: 's-1',
        event: makeEntry('assistant/message', { turn: 1, step: 0, message: { id: 'a-live', role: 'assistant', content: [{ type: 'text', text: '实时完成' }] } }, 22).event,
      })
      // 调用收尾（不带新 view：调用时的 diff 卡保留），否则这一行是"运行中"。
      mux.emit({
        type: 'session/event',
        sessionId: 's-1',
        event: makeEntry('tool/result', { turn: 1, step: 0, message: { source: { callId: 'c-live' } } }, 23).event,
      })
    })

    // The live diff card rides inside the live row's process group, so it is
    // not in the DOM until that group is expanded; its body stays folded until
    // the artifact head itself is tapped.
    await screen.findByText('实时完成')
    const assistantRows = container.querySelectorAll('.chat-msg-assistant')
    const liveRow = assistantRows[assistantRows.length - 1] as HTMLElement
    // 折叠头两行：状态词（P11 起卡面不再带步数），然后是最后一步做了什么
    // （live 的 diff 卡就挂在这一行）。
    const liveHead = liveRow.querySelector('.chat-proc-head') as HTMLElement
    expect(liveRow.querySelectorAll('.chat-proc-line')).toHaveLength(2)
    expect(procStateOf(liveHead)).toBe('已完成')
    // 旧期望值 '1 步' → 新口径：卡面不带步数。
    expect(procTimeOf(liveHead)).toBe('')
    expect(liveHead.textContent).not.toContain('步')
    expect(procCurrentOf(liveHead)).toBe('写入 · b.txt')
    expect(liveHead.querySelector('.chat-proc-meta')!.textContent).toBe('改了 1 个文件')
    expect(liveRow.querySelector('.chat-artifact')).toBeNull()
    const groupHead = liveRow.querySelector('.chat-proc-head') as HTMLButtonElement
    expect(groupHead.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(groupHead)

    const head = liveRow.querySelector('.chat-artifact-head') as HTMLButtonElement
    expect(head.querySelector('.chat-artifact-title')!.textContent).toBe('Write b.txt')
    expect(head.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('old')).toBeNull()
    fireEvent.click(head)
    expect(await screen.findByText('old')).toBeTruthy()
    expect(screen.getByText('new')).toBeTruthy()
    expect(screen.queryByText('{"file_path":"b.txt"}')).toBeNull()
  })

  it('keeps the streaming row mounted when it settles (stable (turn, step) key)', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    const { container } = render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('还没有消息，发一句话开始吧')

    // A live turn starts: the synthetic id carries the chunk's seq.
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('assistant/chunk', { turn: 1, step: 0, chunk: { type: 'text-delta', text: '流式' } }, 6).event })
    })
    // Let the rAF micro-batch flush so the streaming row is mounted before we
    // capture its DOM node for the settle-in-place assertion below.
    await new Promise(resolve => setTimeout(resolve, 20))
    const row = container.querySelector('.chat-msg-assistant')
    expect(row).not.toBeNull()

    // The final event swaps the id to the host's authoritative one. The row
    // must NOT remount (keyed by (turn, step)): the same DOM node stays, so
    // the msg-in animation never replays and open states survive.
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('assistant/message', { turn: 1, step: 0, message: { id: 'a-9', role: 'assistant', content: [{ type: 'text', text: '流式' }] } }, 7).event })
    })
    expect(container.querySelector('.chat-msg-assistant')).toBe(row)
    expect(await screen.findByText('流式')).toBeTruthy()
  })

  it('re-pins when the same last row gets taller (cache page → network page)', async () => {
    // 真机：进会话有时不落到底、反而往上滑一小段。缓存页（矮）先上屏并钉到底，网络页
    // 到了把同一批行换成更高的版本；最后一行的身份（seq+是否 pending）没变，老代码在
    // 身份相同处直接 return，于是没人补钉。
    loadChatPageMock.mockResolvedValue(rowPage([
      makeEntry('assistant/message', {
        id: 'a-1',
        role: 'assistant',
        content: [{ type: 'text', text: '第一版（矮）' }],
      }, 2),
    ]))
    const mux = Object.assign(new FakeMux(), { isSseLive: () => true })
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    // 首次跟随：钉到底（高度 1000）。
    scrollHeightMock = 1_000
    await waitFor(() => { expect(scrollWrites.length).toBeGreaterThan(0) })
    const afterFirst = scrollWrites.length
    // 同一条行被折进更多内容（工具步并进这一轮）：最后一行身份不变，高度 1400。
    // 这正是「缓存页换网络页」「卡片补进来」时的形状。
    scrollHeightMock = 1_400
    mux.emit({
      type: 'session/event',
      sessionId: 's-1',
      event: {
        type: 'tool/call',
        seq: 3,
        time: Date.now(),
        data: { callId: 'c-1', name: 'read_file', arguments: '{"path":"a.ts"}' },
      },
    })
    mux.emit({
      type: 'session/event',
      sessionId: 's-1',
      event: {
        type: 'tool/result',
        seq: 4,
        time: Date.now(),
        data: { callId: 'c-1', output: 'ok' },
      },
    })
    await waitFor(() => { expect(scrollWrites.length).toBeGreaterThan(afterFirst) })
    expect(scrollWrites[scrollWrites.length - 1]).toBe(1_400)
  })

  it('进会话后高度还会长：布局安定前反复补钉，直到真的到底', async () => {
    // 真机：长列表的高度是分段长出来的（content-visibility 行铺开、卡片补进来），
    // 一次 pin 用的是偏小的 scrollHeight，之后就把画面留在历史里 —— 用户看到的是
    // 「进会话没有自动跳到底部」。
    loadChatPageMock.mockResolvedValue(rowPage([
      makeEntry('assistant/message', {
        id: 'a-grow',
        role: 'assistant',
        content: [{ type: 'text', text: '先短后长' }],
      }, 2),
    ]))
    // 首帧量到的是**估值**：内容刚好填满视口（600），pin 写 600。
    scrollHeightMock = 600
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    await waitFor(() => { expect(scrollWrites).toContain(600) })
    // 行真正铺开后高度是 1600：此时 top 还在 600，离底 400px（真机的症状）。
    // 没有任何消息变化，靠「布局安定前反复补钉」把它钉回去。
    scrollHeightMock = 1_600
    await waitFor(() => { expect(scrollWrites).toContain(1_600) }, { timeout: 2_000 })
  })

  it('手指还在滚的时候，新消息不抢画面', async () => {
    // 真机反馈：新消息到达时跟随逻辑会跟手动上滑打架。真实滚动之后 350ms 内一律让路。
    loadChatPageMock.mockResolvedValue(rowPage([
      makeEntry('assistant/message', { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '第一段' }] }, 2),
    ]))
    const mux = Object.assign(new FakeMux(), { isSseLive: () => true })
    scrollHeightMock = 4_000
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    await waitFor(() => { expect(scrollWrites.length).toBeGreaterThan(0) })
    const scroller = document.querySelector('.chat-scroll') as HTMLElement
    // 读者往上翻（真实手势：先有输入意图，再滚）
    scroller.scrollTop = 1_000
    userScroll(scroller, 1_000)
    const before = scrollWrites.length
    // 紧接着一条新消息到达：手势窗口内不许跟随
    mux.emit({
      type: 'session/event',
      sessionId: 's-1',
      event: { type: 'assistant/message', seq: 3, time: Date.now(), data: { id: 'a-2', role: 'assistant', content: [{ type: 'text', text: '新消息' }] } },
    })
    await waitFor(() => { expect(screen.getByText('新消息')).toBeTruthy() })
    expect(scrollWrites.length).toBe(before)
  })

  it('翻历史那一页不再「猜」交付卡：宁可先没有，也不要出现后又改', async () => {
    // 真机：往上翻历史时交付卡闪一下 —— 页里没有 turn/end 时先按工具行猜一张，
    // 几秒后 cardRecovery 读到真 turn/end 再换成正式版（文件清单可能变多）。
    // 现在历史页不猜，卡只来自页里真的带着的 turn/end。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    // 直接验渲染函数：没有 turn/end 的行集，开 / 猜两种模式的差别只在卡片数量。
    const rows = [
      { id: 'p1', kind: 'assistant', text: '改了两个文件', seq: 10, time: 1, turn: 3, step: 1 },
    ] as unknown as Parameters<typeof renderRows>[0]
    expect(renderRows(rows, false).some(row => row.kind === 'turn')).toBe(false)
  })

  it('caps the tail-load live buffer and re-pulls the history tail after an overflow', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let resolveHistory: (page: ChatPageResult) => void = () => {}
    loadChatPageMock
      .mockReturnValueOnce(new Promise<ChatPageResult>((resolve) => { resolveHistory = resolve }))
      // The overflow refill page folds into the list; the mock's row sits
      // past the buffered burst so the windowed list renders it at the bottom.
      .mockResolvedValueOnce(rowPage([
        makeEntry('assistant/message', {
          id: 'a-gap',
          role: 'assistant',
          content: [{ type: 'text', text: '补拉恢复' }],
        }, 601),
      ]))
    const mux = new FakeMux()
    // The 500+ buffered messages push the list past the window threshold:
    // give the scroller a real height so the tail window lands on the newest
    // burst rows (jsdom's layout values are all 0 otherwise).
    scrollHeightMock = 100_000
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    // 501 live final messages arrive before the snapshot resolves: the first one
    // is dropped by the 500-event cap, the remaining 500 stay buffered.
    await act(async () => {
      for (let index = 0; index <= MAX_TAIL_BUFFER_EVENTS; index++) {
        mux.emit({
          type: 'session/event',
          sessionId: 's-1',
          event: makeEntry('assistant/message', {
            id: `a-burst-${index}`,
            role: 'assistant',
            content: [{ type: 'text', text: `突发消息 ${index}` }],
          }, 100 + index).event,
        })
      }
    })

    // The overflow is logged exactly once, and the cap mentions the limit.
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain(String(MAX_TAIL_BUFFER_EVENTS))

    await act(async () => { resolveHistory(rowPage(turnEvents())) })

    // The capped buffer keeps the render bounded: the dropped oldest burst
    // message is gone from the buffered fold (it comes back via the refill).
    expect(await screen.findByText('突发消息 500')).toBeTruthy()
    expect(screen.queryByText('突发消息 0')).toBeNull()

    // The overflow triggered exactly one follow-up load, paging by the DROPPED
    // seq window's newest edge (the dropped event has seq 100 → beforeSeq 101),
    // still carrying the same abort signal as the initial load. The old flat
    // tail re-pull (beforeSeq undefined) could never return the dropped event.
    await waitFor(() => { expect(loadChatPageMock).toHaveBeenCalledTimes(2) })
    expect(loadChatPageMock.mock.calls[1]?.[0]).toBe('s-1')
    expect(loadChatPageMock.mock.calls[1]?.[1]).toBe(101)
    expect(loadChatPageMock.mock.calls[1]?.[2]).toBeInstanceOf(AbortSignal)
    expect(loadChatPageMock.mock.calls[1]?.[2]).toBe(loadChatPageMock.mock.calls[0]?.[2])

    // The refilled page (the dropped seq 100 event) folds back in.
    expect(await screen.findByText('补拉恢复')).toBeTruthy()
  })

  it('passes an AbortSignal to loadChatPage and aborts it on unmount', async () => {
    let capturedSignal: AbortSignal | undefined
    loadChatPageMock.mockImplementation((_sessionId, _beforeSeq, signal) => {
      capturedSignal = signal
      return Promise.resolve(rowPage(turnEvents()))
    })
    const view = render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    expect(await screen.findByText('已完成修改')).toBeTruthy()
    expect(loadChatPageMock).toHaveBeenCalledTimes(1)
    expect(loadChatPageMock.mock.calls[0]?.[0]).toBe('s-1')
    expect(loadChatPageMock.mock.calls[0]?.[1]).toBeUndefined()
    expect(loadChatPageMock.mock.calls[0]?.[2]).toBeInstanceOf(AbortSignal)
    expect(capturedSignal).toBeInstanceOf(AbortSignal)
    expect(capturedSignal?.aborted).toBe(false)

    view.unmount()
    expect(capturedSignal?.aborted).toBe(true)
  })
})

describe('ChatView model sheet', () => {
  it('labels the toolbar chip with the current model and selects a new one', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    const chip = await screen.findByRole('button', { name: /切换模型/ })
    // A（聚合读取）：目录先等 readChat 的 extras，宽限过后才自己补取，所以
    // chip 的文案是异步落位的。
    await waitFor(() => { expect(chip.textContent).toContain('fx-1') })

    fireEvent.click(chip)
    const deep = await screen.findByRole('button', { name: /FX 深度/ })
    fireEvent.click(deep)
    await waitFor(() => {
      expect(selectModelMock).toHaveBeenCalledWith('s-1', { provider: 'fx', model: 'fx-2', reasoningEffort: 'high' })
    })
  })

  it('takes the model directory from the readChat extras instead of a second request', async () => {
    loadChatPageMock.mockResolvedValue({
      ...rowPage(turnEvents()),
      extras: { models: { current: { provider: 'ex', model: 'ex-9' }, routable: true, groups: [], failures: [] } },
    })
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    const chip = await screen.findByRole('button', { name: /切换模型/ })
    await waitFor(() => { expect(chip.textContent).toContain('ex-9') })
    // 宽限窗口（120ms）过后也不该再发一次 session.models。
    await new Promise(resolve => setTimeout(resolve, 220))
    expect(modelsMock).not.toHaveBeenCalled()
  })

  it('offers effort choices for the current model and submits the picked effort', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    // The current model already is the effort-capable one.
    modelsMock.mockResolvedValue({
      current: { provider: 'fx', model: 'fx-2', reasoningEffort: 'high' },
      routable: true,
      groups: [
        {
          id: 'fx',
          name: 'FX',
          models: [
            { id: 'fx-1', name: 'FX 标准' },
            { id: 'fx-2', name: 'FX 深度', reasoning: { efforts: [{ id: 'high', name: '高' }], defaultEffort: 'high' } },
          ],
        },
      ],
      failures: [],
    } satisfies SessionModels)
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    fireEvent.click(await screen.findByRole('button', { name: /切换模型/ }))
    // Effort now lives in the same popover as the models (the duplicate full
    // sheet is gone), so no "全部…" hop is needed to reach it.
    const effort = await screen.findByRole('button', { name: /^高/ })
    fireEvent.click(effort)
    await waitFor(() => {
      expect(selectModelMock).toHaveBeenCalledWith('s-1', { provider: 'fx', model: 'fx-2', reasoningEffort: 'high' })
    })
  })
  it('explains a transport 403 on the model channel as a stale host', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    modelsMock.mockRejectedValue(new Error('HTTP 403'))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    fireEvent.click(await screen.findByRole('button', { name: /切换模型/ }))
    expect(await screen.findByText(/HTTP 403/)).toBeTruthy()
    expect(await screen.findByText(/重启 dsh web/)).toBeTruthy()
  })
})

describe('ChatView composer', () => {
  const inputBox = (): HTMLTextAreaElement => screen.getByRole('textbox') as HTMLTextAreaElement

  /** Dispatch one keydown through the React tree and return the real event. */
  const pressEnter = (input: HTMLTextAreaElement, shiftKey = false): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, shiftKey })
    input.dispatchEvent(event)
    return event
  }

  it('sends on Enter by default and keeps Shift+Enter inserting a newline', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')

    const input = inputBox()
    expect(input.getAttribute('enterKeyHint')).toBe('send')
    // 键盘行为提示不再写进占位文案（手机端规范：不出现 Enter/回车字样）。
    expect(input.getAttribute('placeholder')).toBe('说点什么...')

    fireEvent.change(input, { target: { value: '第一行' } })
    const enter = pressEnter(input)
    expect(enter.defaultPrevented).toBe(true)
    await waitFor(() => {
      expect(promptMock).toHaveBeenCalledWith('s-1', [{ type: 'text', text: '第一行' }])
    })

    // Shift+Enter stays a newline gesture and never sends.
    promptMock.mockClear()
    const shifted = pressEnter(input, true)
    expect(shifted.defaultPrevented).toBe(false)
    expect(promptMock).not.toHaveBeenCalled()
  })

  it('inserts a newline on Enter and sends only from the button when the preference is false', async () => {
    fetchMobilePreferencesMock.mockResolvedValue({ mobileEnterToSend: false })
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')

    const input = inputBox()
    await waitFor(() => { expect(input.getAttribute('enterKeyHint')).toBe('enter') })
    // The placeholder stays keyboard-agnostic in both composer modes.
    expect(input.getAttribute('placeholder')).toBe('说点什么...')

    // The handler no longer prevents Enter, so the browser's default inserts
    // a newline (emulated here through the controlled value) and no send fires.
    fireEvent.change(input, { target: { value: '第一行' } })
    const enter = pressEnter(input)
    expect(enter.defaultPrevented).toBe(false)
    fireEvent.change(input, { target: { value: '第一行\n' } })
    expect(input.value).toBe('第一行\n')
    expect(promptMock).not.toHaveBeenCalled()

    // The send button still sends the full multi-line draft.
    fireEvent.change(input, { target: { value: '第一行\n第二行' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => {
      expect(promptMock).toHaveBeenCalledWith('s-1', [{ type: 'text', text: '第一行\n第二行' }])
    })

    // Shift+Enter keeps inserting a newline in either mode.
    promptMock.mockClear()
    const shifted = pressEnter(input, true)
    expect(shifted.defaultPrevented).toBe(false)
    expect(promptMock).not.toHaveBeenCalled()
  })
})

// Controllable scrollHeight + a write log for the chat-scroll element. The
// accessors live on Element.prototype, so patching them here (file-wide)
// lets every scrollToBottom assignment drive a deterministic assertion
// regardless of when the effect runs relative to mount — including tests
// outside the scrolling describe, where jsdom's real layout values are 0.
let scrollHeightMock = 0
let scrollWrites: number[] = []
/** jsdom reports clientHeight as 0; the bottom-follow distance guard needs a viewport. */
let clientHeightMock = 600

const origScrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')
const origScrollTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
const origClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')

beforeAll(() => {
  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get() { return scrollHeightMock },
  })
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get(this: Element) { const stored = (this as unknown as Record<string, unknown>)['__scrollTop']; return typeof stored === 'number' ? stored : 0 },
    set(this: Element, value: number) { scrollWrites.push(value); (this as unknown as Record<string, unknown>)['__scrollTop'] = value },
  })
  Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get() { return clientHeightMock },
  })
})
afterAll(() => {
  if (origScrollHeight) Object.defineProperty(Element.prototype, 'scrollHeight', origScrollHeight)
  if (origScrollTop) Object.defineProperty(Element.prototype, 'scrollTop', origScrollTop)
  if (origClientHeight) Object.defineProperty(Element.prototype, 'clientHeight', origClientHeight)
})

beforeEach(() => { scrollHeightMock = 0; scrollWrites = []; clientHeightMock = 600 })

describe('ChatView scrolling', () => {
  /** A final assistant/message event (non-pending) appended live after the history turn. */
  const liveFinalEvent = (seq: number, turn = 1) => makeEntry('assistant/message', {
    turn,
    step: 0,
    message: { id: `a-${seq}`, role: 'assistant', content: [{ type: 'text', text: '实时新消息' }] },
  }, seq)

  it('positions to the latest message when a session is opened', async () => {
    scrollHeightMock = 400
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    // The tail page renders, then the commit-time effect pins scrollTop to the tail.
    expect(await screen.findByText('已完成修改')).toBeTruthy()
    expect(scrollWrites.at(-1)).toBe(400)
  })

  it('auto-scrolls to the bottom when a new live message arrives', async () => {
    scrollHeightMock = 400
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    expect(scrollWrites.at(-1)).toBe(400)
    // A real-time message grows content; the newly appended (non-pending) last
    // message must still pull the view down to the new bottom.
    scrollHeightMock = 800
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: liveFinalEvent(6).event })
    })
    expect(await screen.findByText('实时新消息')).toBeTruthy()
    expect(scrollWrites.at(-1)).toBe(800)
  })

  it('auto-extends the opening tail with one silent older page when more history exists', async () => {
    loadChatPageMock.mockResolvedValueOnce(rowPage(turnEvents(), { hasMore: true }))
    loadChatPageMock.mockResolvedValueOnce(rowPage(turnEvents(), { hasMore: false }))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    // The auto-extend pulled a second page (beforeSeq) without a tap.
    await waitFor(() => { expect(loadChatPageMock).toHaveBeenCalledTimes(2) })
    const secondCall = loadChatPageMock.mock.calls[1]
    expect(secondCall?.[0]).toBe('s-1')
    expect(secondCall?.[1]).toBeDefined()
    // The second page has no more history, so the manual button stays hidden.
    expect(screen.queryByRole('button', { name: /加载更早的消息/ })).toBeNull()
  })

  it('re-pins to the new bottom when the page lands after the cache seed', async () => {
    // 真机：进会话先画缓存（1 行），页随后落到十几行 —— 读者还停在缓存的旧底部，
    // 距底 1135px，最新一轮的交付物卡片就在屏幕外；探针里 4 张卡片都画出来了。
    // 缓存尾页和网络页常常结束在同一条消息上：末尾 key 不变，只是前面多出几行。
    scrollHeightMock = 200
    const fullPage = rowPage(turnEvents())
    vi.mocked(loadCachedHistory).mockResolvedValueOnce({
      rows: fullPage.rows.slice(-1),
      maxSeq: fullPage.maxSeq,
      hasMore: false,
    })
    loadChatPageMock.mockImplementation(async () => {
      // 页回来时内容已经撑高（真机上高度在同一个 commit 里就位）。
      scrollHeightMock = 1_400
      return fullPage
    })
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    expect(await screen.findByText('已完成修改')).toBeTruthy()
    // 页落地后必须重新贴到底，而不是停在缓存的旧底部。
    await waitFor(() => { expect(scrollWrites.at(-1)).toBe(1_400) })
  })

  it('keeps the current scroll position when older messages are loaded', async () => {
    scrollHeightMock = 400
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents(), { hasMore: true }))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    // 进会话现在把上下文铺开到页数上限（不再只补一页），按钮仍然留着（hasMore）。
    await waitFor(() => { expect(loadChatPageMock).toHaveBeenCalledTimes(5) })
    // Move to the bottom (streaming), as a stable baseline to preserve.
    scrollHeightMock = 800
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: liveFinalEvent(6).event })
    })
    await screen.findByText('实时新消息')
    const writesBefore = scrollWrites.length
    expect(scrollWrites.at(-1)).toBe(800)
    // Prepend an older page: the visual anchor is preserved by one scroll
    // write advancing the position by the REAL content growth (页面高度差).
    // 这里在翻页请求落地那一刻把高度从 800 提到 900 —— 模拟「上面插进来 100px」。
    loadChatPageMock.mockImplementationOnce(() => {
      scrollHeightMock = 900
      return Promise.resolve(rowPage(turnEvents(), { hasMore: false }))
    })
    fireEvent.click(screen.getByRole('button', { name: /加载更早的消息/ }))
    await waitFor(() => { expect(scrollWrites.length).toBe(writesBefore + 1) })
    const anchored = scrollWrites.at(-1) ?? 0
    // 800（原位置）+ 100（新插入内容的真实高度）= 900
    expect(anchored).toBe(900)
  })

  it('pages in another older page when the reader reaches the top, without a tap', async () => {
    // 真机：一进会话挂着「加载更早的消息」，长会话要连点很多次。读到接近顶部
    // 就该自动接上一页（无限上翻），按钮只留作重试。
    scrollHeightMock = 4_000
    clientHeightMock = 600
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents(), { hasMore: true }))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    // 进会话的铺开链先把页数预算用完。
    await waitFor(() => { expect(loadChatPageMock).toHaveBeenCalledTimes(5) })
    const el = document.querySelector('.chat-scroll') as HTMLElement
    // 用户一直上翻到顶：没有点击，只有滚动。写的是原型上的存储字段，不能把
    // scrollTop 重定义成只读属性——测试结束后代码还要往回写，那会抛未处理异常。
    ;(el as unknown as Record<string, unknown>)['__scrollTop'] = 0
    fireEvent.scroll(el)
    await waitFor(() => { expect(loadChatPageMock).toHaveBeenCalledTimes(6) })
    // 这一页落地后的锚点/跟随是在 rAF 里写的：等它跑完再结束用例，否则写到下一
    // 条用例的元素上，会把那边的滚动断言搅乱（实测下一改用例拿到 168 而不是 400）。
    await act(async () => { await new Promise(resolve => { setTimeout(resolve, 60) }) })
  })

  it('re-follows to the REAL bottom after the silent auto-extend prepend commits', async () => {
    // The real-browser bug: the silent auto-extend's re-follow used to run in
    // a rAF that read the PRE-commit scrollHeight (the prepend rows were not
    // in the DOM yet), pinned to the OLD tail, and left the view stranded
    // mid-history once the prepend landed — with no corrector left (the
    // stream follower key is unchanged by a prepend, and neither re-pin
    // effect runs below the window threshold). The follow must read the
    // POST-commit height: the last write lands on the real bottom.
    scrollHeightMock = 400
    clientHeightMock = 600
    loadChatPageMock.mockResolvedValueOnce(rowPage(turnEvents(), { hasMore: true }))
    let release!: (page: ChatPageResult) => void
    loadChatPageMock.mockReturnValueOnce(new Promise<ChatPageResult>(resolve => { release = resolve }))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    await waitFor(() => { expect(scrollWrites.at(-1)).toBe(400) })
    // The older page resolves as one commit that grows the real height far
    // beyond the stale tail (12 heavy rows → 2000px). The re-follow must
    // observe the committed height, never the pre-commit one.
    scrollHeightMock = 2000
    await act(async () => { release?.(rowPage(turnEvents(), { hasMore: false })) })
    await waitFor(() => { expect(scrollWrites.at(-1)).toBe(2000) })
    // And it must NOT strand: the view never rests on the stale tail value.
    expect(scrollWrites.at(-1)).not.toBe(400)
  })

  it('shows the jump-to-latest button once the reader scrolls away from the bottom', async () => {
    scrollHeightMock = 20_000
    clientHeightMock = 600
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    // At the bottom (opening position) the button stays hidden.
    expect(screen.queryByRole('button', { name: '回到最新消息' })).toBeNull()
    // Scrolling up through history (gap 20_000 − 5_000 − 600 ≫ threshold) reveals it.
    const scroller = document.querySelector('.chat-scroll')!
    userScroll(scroller, 5_000)
    expect(screen.getByRole('button', { name: '回到最新消息' })).toBeTruthy()
  })

  it('jumps to the bottom and hides the button on click', async () => {
    scrollHeightMock = 20_000
    clientHeightMock = 600
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    const scroller = document.querySelector('.chat-scroll')!
    userScroll(scroller, 5_000)
    fireEvent.click(screen.getByRole('button', { name: '回到最新消息' }))
    // The view pins to the new bottom and the button disappears.
    expect(scrollWrites.at(-1)).toBe(20_000)
    expect(screen.queryByRole('button', { name: '回到最新消息' })).toBeNull()
  })

  it('counts turns that arrive while away and clears the badge on jump', async () => {
    scrollHeightMock = 20_000
    clientHeightMock = 600
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    const scroller = document.querySelector('.chat-scroll')!
    userScroll(scroller, 5_000)
    // Two new turns arrive while the reader is away from the bottom.
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: liveFinalEvent(6, 1).event })
    })
    // Let the first rAF flush fold turn 1 before emitting turn 2, so the two
    // turns land in separate micro-batches and count as two unread turns.
    await new Promise(resolve => setTimeout(resolve, 20))
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: liveFinalEvent(7, 2).event })
    })
    const badge = await screen.findByText('2', { selector: '.chat-jump-badge' })
    expect(badge).toBeTruthy()
    // Jumping clears the tally.
    fireEvent.click(screen.getByRole('button', { name: '回到最新消息' }))
    expect(screen.queryByText('2', { selector: '.chat-jump-badge' })).toBeNull()
  })

  it('clears the unread badge when the reader manually scrolls back to the bottom', async () => {
    scrollHeightMock = 20_000
    clientHeightMock = 600
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    const scroller = document.querySelector('.chat-scroll')!
    userScroll(scroller, 5_000)
    // Two new turns arrive while the reader is away from the bottom.
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: liveFinalEvent(6, 1).event })
    })
    // Let the first rAF flush fold turn 1 before emitting turn 2, so the two
    // turns land in separate micro-batches and count as two unread turns.
    await new Promise(resolve => setTimeout(resolve, 20))
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: liveFinalEvent(7, 2).event })
    })
    const badge = await screen.findByText('2', { selector: '.chat-jump-badge' })
    expect(badge).toBeTruthy()
    // Manually scrolling back to the bottom clears the tally (no tap needed).
    fireEvent.scroll(scroller, { target: { scrollTop: 19_400 } })
    expect(screen.queryByText('2', { selector: '.chat-jump-badge' })).toBeNull()
    // The seen baseline advanced: a later turn while still at the bottom
    // does not re-arm the badge.
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: liveFinalEvent(8, 3).event })
    })
    expect(screen.queryByText('1', { selector: '.chat-jump-badge' })).toBeNull()
  })

  it('counts one badge per turn, not per message', async () => {
    scrollHeightMock = 20_000
    clientHeightMock = 600
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    const scroller = document.querySelector('.chat-scroll')!
    userScroll(scroller, 5_000)
    // Three messages of the SAME turn (tool call + follow-up chunks) count once.
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: liveFinalEvent(6, 1).event })
    })
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: liveFinalEvent(7, 1).event })
    })
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: liveFinalEvent(8, 1).event })
    })
    const badge = await screen.findByText('1', { selector: '.chat-jump-badge' })
    expect(badge).toBeTruthy()
  })

  it('长会话（130 行）贴底时内容变高仍补到真底，滚走的读者不动', async () => {
    // 行全渲染之后不再有"估高 → 测量收敛"的中间态，但列表在进会话后仍会继续长
    // （先画缓存、页后落、图片再撑开），所以补底逻辑必须还在。
    const many = Array.from({ length: 130 }, (_, i) => makeEntry('user/message', {
      id: `u-${i}`,
      role: 'user',
      content: [{ type: 'text', text: `消息${i}` }],
    }, i))
    scrollHeightMock = 20_000
    clientHeightMock = 600
    loadChatPageMock.mockResolvedValue(rowPage(many))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('消息129')
    await waitFor(() => { expect(scrollWrites.at(-1)).toBe(20_000) })
    // 内容变高：贴着底的读者跟到新底。
    scrollHeightMock = 25_000
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: liveFinalEvent(200).event })
    })
    await waitFor(() => { expect(scrollWrites.at(-1) ?? 0).toBeGreaterThan(20_000) })
    // 已经滚走的读者不动。
    scrollHeightMock = 30_000
    const scroller = document.querySelector('.chat-scroll')!
    userScroll(scroller, 5_000)
    const writesBefore = scrollWrites.length
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: liveFinalEvent(201).event })
    })
    expect(scrollWrites.length).toBe(writesBefore)
  })

  it('130 行全部渲染：没有估高 spacer，滚动只换内容不移窗', async () => {
    // 这是"落点准不准"的地基：以前超过阈值只渲染滚动位置附近的行，上下用估算
    // 高度撑开 —— 落点于是永远是估的。现在照桌面：已载入的行全在 DOM 里。
    const many = Array.from({ length: 130 }, (_, i) => makeEntry('user/message', {
      id: `u-${i}`,
      role: 'user',
      content: [{ type: 'text', text: `消息${i}` }],
    }, i))
    scrollHeightMock = 20_000
    loadChatPageMock.mockResolvedValue(rowPage(many))
    const mux = new FakeMux()
    const { container } = render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('消息129')
    expect(screen.queryAllByText(/^消息\d+$/).length).toBe(130)
    // 上下不再有 spacer（它们的高度就是"估出来的落点"）。
    expect(container.querySelectorAll('.chat-scroll > div[aria-hidden="true"]').length).toBe(0)
    // 滚到中间：首尾两行都还在 DOM 里，没有被移出窗口。
    const scroller = container.querySelector('.chat-scroll') as HTMLElement
    fireEvent.scroll(scroller, { target: { scrollTop: 9_000 } })
    expect(screen.getByText('消息0')).toBeTruthy()
    expect(screen.getByText('消息129')).toBeTruthy()
  })

  it('定位落点读的是行的真实几何，不是高度估算', async () => {
    // 130 行 + 一个已知 rect：目标行在内容坐标 1234px 处、容器顶 0。窗口化时期
    // 这个落点要用"前缀和估算"换算，偏几十上百像素；现在直接量、直接写。
    const many = Array.from({ length: 130 }, (_, i) => makeEntry('user/message', {
      id: `u-${i}`,
      role: 'user',
      content: [{ type: 'text', text: `消息${i}` }],
    }, i))
    scrollHeightMock = 20_000
    loadChatPageMock.mockResolvedValue(rowPage(many))
    const mux = new FakeMux()
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')
    const box = (): HTMLElement | null => document.querySelector('.chat-scroll') as HTMLElement | null
    const rect = (top: number, height: number): DOMRect => ({
      top, bottom: top + height, left: 0, right: 390, width: 390, height,
      x: 0, y: top, toJSON: () => ({}),
    } as DOMRect)
    Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: Element) {
        const scroller = box()
        if (scroller !== null && this === scroller) return rect(0, 600)
        // 目标行跟着滚动位移：写入 1226 之后它的 rect.top 正好是 8。
        if (this.closest !== undefined && this.closest('[data-message-id="u-20"]') !== null) {
          return rect(1_234 - (scroller?.scrollTop ?? 0), 100)
        }
        return rect(0, 0)
      },
    })
    try {
      render(<ChatView
        session={session}
        initialFocusMessageId="u-20"
        mux={mux as never}
        onBack={() => {}}
        showToolCalls={true}
        showSystemMessages={false}
      />)
      await waitFor(() => {
        expect(document.querySelector('[data-message-id="u-20"]')?.classList.contains('chat-msg-focus')).toBe(true)
      })
      // 1234 − 0（容器顶）− 8（呼吸位）= 1226，与任何估算值都无关。
      await waitFor(() => { expect(scrollWrites).toContain(1_226) })
      // 落点像素级：目标行的 rect.top 必须停在留白上（±2px）。以前的判据容差
      // 是一整屏（±150px 以上），偏半屏也算过 —— 这正是"定位不准"的现场。
      const landedTop = (document.querySelector('[data-message-id="u-20"]') as HTMLElement).getBoundingClientRect().top
      expect(Math.abs(landedTop - 8)).toBeLessThanOrEqual(2)
      // 而且不是靠反复盲写凑出来的：一次写 + 至多两次补偿。
      expect(scrollWrites.length).toBeLessThanOrEqual(3)
    } finally {
      if (original !== undefined) Object.defineProperty(Element.prototype, 'getBoundingClientRect', original)
      else delete (Element.prototype as unknown as Record<string, unknown>)['getBoundingClientRect']
    }
  })

  it('深历史里的搜索命中：定位到那一行并打上焦点标记', async () => {
    // 130 行全渲染之后不再有"把目标移出窗口"这类失效，但这条仍然是护栏：
    // 定位必须真的落在那一行上，而不是只在开屏的贴底位置上高亮。
    const many = Array.from({ length: 130 }, (_, i) => makeEntry('user/message', {
      id: `u-${i}`,
      role: 'user',
      content: [{ type: 'text', text: `消息${i}` }],
    }, i))
    scrollHeightMock = 20_000
    loadChatPageMock.mockResolvedValue(rowPage(many))
    const mux = new FakeMux()
    render(<ChatView
      session={session}
      initialFocusMessageId="u-20"
      initialFocusQuery="消息20"
      mux={mux as never}
      onBack={() => {}}
      showToolCalls={true}
      showSystemMessages={false}
    />)
    await screen.findByRole('button', { name: '发送' })
    await waitFor(() => {
      const row = document.querySelector('[data-message-id="u-20"]')
      expect(row).not.toBeNull()
      expect(row?.classList.contains('chat-msg-focus')).toBe(true)
    })
    // The target row must be RENDERED (inside the relocated window), not
    // windowed out by a competing tail window.
    expect(document.querySelector('[data-message-id="u-20"]')).not.toBeNull()
    // The locate must actually SCROLL to the row (a scrollTop write), not just
    // render it highlighted while the viewport stays at the tail — the
    // "highlighted but never jumped" failure.
    await waitFor(() => { expect(scrollWrites.length).toBeGreaterThan(0) })
  })

  it('locates a search hit that lives in OLDER history by paging back to it', async () => {
    // The target message is not in the opening tail page; the locate must
    // page older history until the row surfaces, then land on it. This is the
    // "search found it but the chat opened at the tail" scenario.
    const tail = Array.from({ length: 10 }, (_, i) => makeEntry('user/message', {
      id: `u-tail-${i}`,
      role: 'user',
      content: [{ type: 'text', text: `尾部消息${i}` }],
    }, 100 + i))
    const mid = Array.from({ length: 10 }, (_, i) => makeEntry('user/message', {
      id: `u-mid-${i}`,
      role: 'user',
      content: [{ type: 'text', text: `中间消息${i}` }],
    }, 50 + i))
    const older = Array.from({ length: 10 }, (_, i) => makeEntry('user/message', {
      id: `u-old-${i}`,
      role: 'user',
      content: [{ type: 'text', text: `旧消息${i}` }],
    }, i))
    // call 1 = opening tail (hasMore true, no target). call 2 = the locate's
    // direct jump to the target's page (beforeSeq = target+1 = 6) — 带定位打开时
    // 不再先铺开（铺开链会跟定位抢同一个往返）。call 3 = 没找到目标时按当前
    // 最早的 seq 继续往前翻，那页里才有目标。
    loadChatPageMock
      .mockResolvedValueOnce(rowPage(tail, { hasMore: true }))
      .mockResolvedValueOnce(rowPage(mid, { hasMore: true }))
      .mockResolvedValueOnce(rowPage(older, { hasMore: false }))
    const mux = new FakeMux()
    render(<ChatView
      session={session}
      initialFocusMessageId="u-old-5"
      initialFocusSeq={5}
      initialFocusQuery="旧消息5"
      mux={mux as never}
      onBack={() => {}}
      showToolCalls={true}
      showSystemMessages={false}
    />)
    await screen.findByRole('button', { name: '发送' })
    // The locate jumps straight to the target's page (beforeSeq = target+1)
    // instead of paging back one page at a time through deep history.
    await waitFor(() => { expect(loadChatPageMock).toHaveBeenCalledTimes(3) })
    expect(loadChatPageMock.mock.calls[1]?.[1]).toBe(6)
    await waitFor(() => {
      const row = document.querySelector('[data-message-id="u-old-5"]')
      expect(row).not.toBeNull()
      expect(row?.classList.contains('chat-msg-focus')).toBe(true)
    })
  })
})

describe('ChatView display toggles and context usage', () => {
  /** jsdom in this setup ships a bare localStorage object; install a real fake. */
  const makeStorage = (): Storage => {
    const map = new Map<string, string>()
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => { map.set(key, value) },
      removeItem: (key: string) => { map.delete(key) },
      clear: () => { map.clear() },
      key: (index: number) => [...map.keys()][index] ?? null,
      get length() { return map.size },
    } as Storage
  }

  /** A user/message whose source.kind is 'plugin' (injected system message). */
  const systemEvents = (): Array<{ event: WireEvent }> => [
    makeEntry('user/message', {
      id: 'u-plugin',
      role: 'user',
      content: [{ type: 'text', text: '系统注入消息' }],
      source: { kind: 'plugin', name: 'react-extension' },
    }, 0),
    makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '普通消息' }] }, 1),
  ]

  const toolEvents = (): Array<{ event: WireEvent }> => [
    makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '改文件' }] }, 0),
    makeEntry('assistant/message', {
      turn: 0,
      step: 0,
      message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '完成' }] },
    }, 1),
    makeEntry('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'bash', arguments: '{}' }, 2),
    // 调用收尾 ⇒ 这一轮真的"已结束"（还挂着的 running 工具按新判据算运行中，
    // 头部就不会再报"1 步"，见 message-row.tsx 的 liveness 判据）。
    makeEntry('tool/result', { turn: 0, step: 0, message: { source: { callId: 'c1' } } }, 3),
  ]

  beforeEach(() => {
    vi.stubGlobal('localStorage', makeStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hides injected user messages by default and reveals them via the showSystemMessages prop', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(systemEvents()))
    const view = render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    // The plugin-injected message is hidden by default; the real user message shows.
    expect(await screen.findByText('普通消息')).toBeTruthy()
    expect(screen.queryByText('系统注入消息')).toBeNull()

    // Flip the prop on: the injected row appears.
    view.rerender(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={true} />)
    expect(await screen.findByText('系统注入消息')).toBeTruthy()

    // Flip it back off: the injected row disappears again.
    view.rerender(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    expect(screen.queryByText('系统注入消息')).toBeNull()
  })

  it('hides the tool steps when the showToolCalls prop is off', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(toolEvents()))
    const view = render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    // The process group is visible by default (an expandable head). The old
    // `button[name=/步/]` probe is gone with the step count leaving the card face
    // (P11); the head's class is the direct handle now.
    expect(await screen.findByText('完成')).toBeTruthy()
    expect(document.querySelector('button.chat-proc-head')).not.toBeNull()

    view.rerender(<ChatView session={session} onBack={() => {}} showToolCalls={false} showSystemMessages={false} />)

    // The group is gone (no step rows left to fold) while the answer remains.
    expect(document.querySelector('.chat-proc')).toBeNull()
    expect(screen.getByText('完成')).toBeTruthy()
  })

  it('renders ONE process card for a whole turn split by the host\'s hidden injected rows', async () => {
    // 真机 turn 3 的形状（离线重放逐字复现的那段历史）：每 step 一条
    // assistant/message + 交错的 tool/result，step 之间夹着 source.kind ≠ 'user'
    // 的注入 user 行。修复前它渲染成三张过程卡（用时同为 1分45秒）；修复后必须
    // 只有一张，而且 D2 的 3 个工具一个都不能丢（展开体首行报 共 3 步，不是 1 步）。
    const t0 = 1_700_000_000_000
    loadChatPageMock.mockResolvedValue(rowPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '修一下' }] }, 450),
      makeEntryAt('turn/start', { turn: 3 }, 451, t0),
      makeEntry('assistant/message', {
        turn: 3,
        step: 0,
        message: { id: 'a-1', role: 'assistant', content: [{ type: 'reasoning', text: '先看结构' }, { type: 'text', text: '第一步' }] },
      }, 452),
      makeEntry('tool/call', { turn: 3, step: 0, callId: 'c1', name: 'read', arguments: '{"file_path":"a.ts"}' }, 453),
      makeEntry('tool/result', { turn: 3, step: 0, message: { source: { callId: 'c1' } } }, 454),
      makeEntry('user/message', { id: 'inject-compact', role: 'user', content: [{ type: 'text', text: 'compact-checkpoint' }], source: { kind: 'compact-checkpoint' } }, 456),
      makeEntry('assistant/message', {
        turn: 3,
        step: 1,
        message: { id: 'a-2', role: 'assistant', content: [{ type: 'text', text: '第二步' }] },
      }, 457),
      makeEntry('tool/call', { turn: 3, step: 1, callId: 'c2', name: 'bash', arguments: '{"cmd":"ls"}' }, 458),
      makeEntry('user/message', { id: 'inject-agent', role: 'user', content: [{ type: 'text', text: 'agent-instructions' }], source: { kind: 'agent-instructions' } }, 459),
      makeEntry('tool/result', { turn: 3, step: 1, message: { source: { callId: 'c2' } } }, 460),
      makeEntry('tool/call', { turn: 3, step: 1, callId: 'c3', name: 'bash', arguments: '{"cmd":"pytest -q"}' }, 461),
      makeEntry('tool/result', { turn: 3, step: 1, message: { source: { callId: 'c3' } } }, 462),
      makeEntry('user/message', { id: 'inject-skill', role: 'user', content: [{ type: 'text', text: 'skill-catalog' }], source: { kind: 'skill-catalog' } }, 464),
      makeEntry('assistant/message', {
        turn: 3,
        step: 2,
        message: { id: 'a-3', role: 'assistant', content: [{ type: 'text', text: '改完了' }] },
      }, 468),
      makeEntry('user/message', { id: 'inject-runtime', role: 'user', content: [{ type: 'text', text: 'runtime-context' }], source: { kind: 'runtime-context' } }, 469),
      makeEntryAt('turn/end', { turn: 3, reason: { kind: 'ok' } }, 470, t0 + 105_000),
    ]))
    // 每一行都带 (turn, step)：重复的 React key 会在这条断言里现形（React 用
    // console.error 报 "Encountered two children with the same key"）。
    const consoleErrors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    try {
      const head = await findProcHead()
      // 一轮一卡：三张卡合成一张。
      expect(container.querySelectorAll('.chat-proc')).toHaveLength(1)
      expect(procStateOf(head)).toBe('已完成')
      // 3 个工具全在（D2，展开体首行报步数），用时定格在真机那段 1分45秒。
      // 旧期望值 '用时1分45秒 · 3 步' → P11 新口径：卡面第一行只有用时。
      expect(procTimeOf(head)).toBe('用时1分45秒')
      expect(head.textContent).not.toContain('步')
      // 一轮一卡：最后一步的文本在组外当答案，前两步的叙述留在组内。
      const answer = container.querySelector('.chat-flow-answer') as HTMLElement
      expect(answer.textContent).toContain('改完了')
      expect(container.querySelector('.chat-proc')!.contains(answer)).toBe(false)
      fireEvent.click(head)
      const body = container.querySelector('.chat-proc-body') as HTMLElement
      // D2 的 3 个工具一个都不能丢：展开体首行报 3 步（旧口径是卡面 '· 3 步'）。
      expect(body.querySelector('.chat-proc-steps')!.textContent).toBe('共 3 步')
      expect(within(body).getByText('第一步')).toBeTruthy()
      expect(within(body).getByText('第二步')).toBeTruthy()
      expect(within(body).queryByText('先看结构')).toBeNull()
      // 隐藏注入行既没被渲染，也不再是屏障。
      expect(container.textContent).not.toContain('compact-checkpoint')
      expect(container.textContent).not.toContain('runtime-context')
      expect(consoleErrors.mock.calls.filter(call => String(call[0]).includes('same key'))).toHaveLength(0)
    } finally {
      consoleErrors.mockRestore()
    }
  })

  it('renders the host diff-card view as a collapsible artifact inside the process group', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '改文件' }] }, 0),
      makeEntry('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: '正在写' } }, 1),
      makeEntryWithView('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'write', arguments: '{"file_path":"a.txt"}' }, 2,
        { for: 'call', view: { card: 'diff', title: 'Write a.txt', diffs: [{ path: 'a.txt', oldText: 'old line', newText: 'new line' }] } }),
      makeEntry('assistant/message', {
        turn: 0,
        step: 0,
        message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '完成' }] },
      }, 3),
      // 调用收尾 ⇒ 行是"已结束"（不带新 view：调用时的 diff 卡保留）。
      makeEntry('tool/result', { turn: 0, step: 0, message: { source: { callId: 'c1' } } }, 4),
    ]))
    const { container } = render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    // Collapsed by default: neither the step row nor the diff card is in the
    // DOM, and the answer already sits outside the group.
    const groupHead = await findProcHead()
    expect(groupHead.getAttribute('aria-expanded')).toBe('false')
    // 两行头：状态词（P11 起卡面不带步数）/ 最后一步做了什么（含改动量一句人话）。
    expect(groupHead.querySelectorAll('.chat-proc-line')).toHaveLength(2)
    expect(procStateOf(groupHead)).toBe('已完成')
    // 旧期望值 '1 步' → 新口径：卡面第一行不带步数。
    expect(procTimeOf(groupHead)).toBe('')
    expect(groupHead.textContent).not.toContain('步')
    expect(procCurrentOf(groupHead)).toBe('写入 · a.txt')
    expect(groupHead.querySelector('.chat-proc-meta')!.textContent).toBe('改了 1 个文件')
    expect(container.querySelector('.chat-artifact')).toBeNull()
    expect(container.querySelector('.chat-step')).toBeNull()
    expect(container.querySelector('.chat-flow-answer')!.textContent).toContain('完成')

    // Tap 1 expands the group: the artifact head (title + tally) appears, and
    // its diff body is folded by default.
    fireEvent.click(groupHead)
    expect(groupHead.getAttribute('aria-expanded')).toBe('true')
    const head = await screen.findByRole('button', { name: /Write a\.txt/ })
    expect(head.getAttribute('aria-expanded')).toBe('false')
    // The +/- tally splits into green (add) and red (del) stat spans.
    expect(screen.getByText('+1', { selector: '.chat-artifact-stat-add' })).toBeTruthy()
    expect(screen.getByText('−1', { selector: '.chat-artifact-stat-del' })).toBeTruthy()
    expect(screen.queryByText('old line')).toBeNull()
    expect(screen.queryByText('new line')).toBeNull()

    // Tap 2 expands the red/green diff body.
    fireEvent.click(head)
    expect(await screen.findByText('old line')).toBeTruthy()
    expect(screen.getByText('new line')).toBeTruthy()
    const delRow = screen.getByText('old line').closest('.chat-tool-diff-row')
    const addRow = screen.getByText('new line').closest('.chat-tool-diff-row')
    expect(delRow?.className).toContain('chat-tool-diff-del')
    expect(addRow?.className).toContain('chat-tool-diff-add')

    // The process timeline names the act in Chinese and keeps only that — no
    // duplicated diff, no raw arguments JSON.
    expect(screen.getByText('写入')).toBeTruthy()
    expect(screen.queryByText('{"file_path":"a.txt"}')).toBeNull()

    // The step row carries the same +/- tally as the artifact head (one shared
    // calculation), so the timeline reads like the desktop's row suffix.
    const stepRow = screen.getByText('写入').closest('.chat-step')
    expect(stepRow?.querySelector('.chat-step-tally-add')?.textContent).toBe('+1')
    expect(stepRow?.querySelector('.chat-step-tally-del')?.textContent).toBe('−1')

    // The answer is judged by step: it lives OUTSIDE the group, anchored to
    // the final step's seq.
    const answer = container.querySelector('.chat-flow-answer') as HTMLElement
    expect(answer.getAttribute('data-step-seq')).toBe('3')
    expect(answer.getAttribute('data-part-id')).toBe('answer')
    expect(container.querySelector('.chat-proc')!.contains(answer)).toBe(false)
  })

  it('embeds the diff artifact at its call time point between the text runs', async () => {
    // Two steps of one turn: step 1 speaks then writes a file, step 2 speaks
    // after. The settled flow renders text → artifact → text in DOM order.
    loadChatPageMock.mockResolvedValue(rowPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '改文件' }] }, 0),
      makeEntry('assistant/message', {
        turn: 0,
        step: 0,
        message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '先看这个' }] },
      }, 1),
      makeEntryWithView('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'write', arguments: '{"file_path":"a.txt"}' }, 2,
        { for: 'call', view: { card: 'diff', title: 'Write a.txt', diffs: [{ path: 'a.txt', oldText: 'old line', newText: 'new line' }] } }),
      makeEntry('assistant/message', {
        turn: 0,
        step: 0,
        message: { id: 'a-2', role: 'assistant', content: [{ type: 'text', text: '再看那个' }] },
      }, 3),
    ]))
    const { container } = render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    // Only the answer renders while the group stays collapsed: the earlier
    // step's narration and the artifact are both inside the folded body.
    const answer = await screen.findByText('再看那个')
    expect(container.querySelector('.chat-flow-text[data-part-id="text-0"]')).toBeNull()
    expect(container.querySelector('.chat-artifact')).toBeNull()

    fireEvent.click(container.querySelector('.chat-proc-head')!)
    const order = [...container.querySelectorAll('.chat-flow-text, .chat-step, .chat-artifact')].map((el) => {
      if (el.classList.contains('chat-artifact')) return 'artifact'
      if (el.classList.contains('chat-step')) return 'step'
      return el.getAttribute('data-part-id') === 'answer' ? 'answer' : 'narration'
    })
    expect(order).toEqual(['narration', 'step', 'artifact', 'answer'])
    // The narration is anchored inside the group at its own step; the answer
    // is anchored to the LAST step and stays outside, after the group.
    const narration = container.querySelector('.chat-flow-text[data-part-id="text-0"]') as HTMLElement
    expect(narration.getAttribute('data-step-seq')).toBe('2')
    expect(narration.textContent).toContain('先看这个')
    expect(container.querySelector('.chat-proc')!.contains(narration)).toBe(true)
    expect(answer.closest('.chat-flow-text')?.getAttribute('data-step-seq')).toBe('3')
    expect(answer.closest('.chat-flow-text')?.getAttribute('data-part-id')).toBe('answer')
    expect(container.querySelector('.chat-proc')!.contains(answer)).toBe(false)
  })

  it('renders the context meter from the contextPressure projection', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents(), {
      projections: {
        values: { contextPressure: { contextWindow: 100_000, pressureTokens: 30_000, projectedTokens: 30_000 } },
      },
    }))
    const { container } = render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    expect(await screen.findByText('30%')).toBeTruthy()
    // The ring arc matches the figure exactly (C = 2π·10.5 ≈ 65.97).
    const fill = container.querySelector('.chat-context-ring-fill')
    expect(fill?.getAttribute('stroke-dasharray')).toBe('19.791 65.97')
  })

  it('shows the exact usage figures when the ring is tapped and closes again', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents(), {
      projections: {
        values: { contextPressure: { contextWindow: 100_000, pressureTokens: 30_000, projectedTokens: 30_000 } },
      },
    }))
    const { container } = render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    const ring = await screen.findByText('30%')
    fireEvent.click(ring)
    expect(await screen.findByText('上下文用量')).toBeTruthy()
    expect(screen.getByText(/30k/)).toBeTruthy()
    expect(screen.getByText(/100k/)).toBeTruthy()
    expect(screen.getByText(/已使用 30%/)).toBeTruthy()
    // Tapping outside (the pop scrim) closes it again.
    fireEvent.click(container.querySelector('.chat-context-pop-scrim') as Element)
    await waitFor(() => expect(screen.queryByText('上下文用量')).toBeNull())
  })

  it('adds the warn class when context pressure is at or above 80%', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents(), {
      projections: {
        values: { contextPressure: { contextWindow: 100_000, pressureTokens: 80_000, projectedTokens: 80_000 } },
      },
    }))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    const meter = await screen.findByText('80%')
    expect(meter.closest('.chat-context')?.className).toContain('chat-context-warn')
  })

  it('renders a persistent context chip with a dash placeholder when there is no usage/context data', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    const chip = await screen.findByText('上下文 --')
    expect(chip.className).not.toContain('chat-context-warn')
  })
})

describe('ChatView in-place quick picker strips', () => {
  /** History with the permissions projection (readonly / workspace-write / full). */
  function permissionHistory(): ChatPageResult {
    return rowPage(turnEvents(), {
      projections: {
        asOfSeq: 5,
        values: {
          permissions: {
            currentValue: 'readonly',
            options: [
              { value: 'readonly', name: '只读' },
              { value: 'workspace-write', name: '工作区写入', description: '改文件需授权' },
              { value: 'danger-full-access', name: '完全权限', description: '全部操作' },
            ],
          },
        },
      },
    })
  }

  it('opens the model panel on the model pill and highlights the current model', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    fireEvent.click(screen.getByRole('button', { name: /切换模型/ }))
    expect(await screen.findByText('FX 标准')).toBeTruthy()
    expect(screen.getByText('FX 深度')).toBeTruthy()
    const selected = screen.getByText('FX 标准').closest('.chat-picker-row')
    expect(selected?.className).toContain('chat-picker-row-selected')
    // The panel lists every model directly (no search box) and is now the
    // only model surface: the duplicate full sheet and its "全部…" hop are
    // gone, so nothing else must be reachable from here.
    expect(screen.queryByRole('searchbox', { name: '搜索模型' })).toBeNull()
    expect(screen.queryByRole('button', { name: '全部…' })).toBeNull()
  })

  it('shows thinking-effort choices for the current model right in the panel', async () => {
    modelsMock.mockResolvedValue({
      current: { provider: 'fx', model: 'fx-2', reasoningEffort: 'high' },
      routable: true,
      groups: [
        {
          id: 'fx',
          name: 'FX',
          models: [
            { id: 'fx-1', name: 'FX 标准' },
            { id: 'fx-2', name: 'FX 深度', reasoning: { efforts: [{ id: 'high', name: '高' }], defaultEffort: 'high' } },
          ],
        },
      ],
      failures: [],
    } satisfies SessionModels)
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    fireEvent.click(screen.getByRole('button', { name: /切换模型/ }))
    expect(await screen.findByText('思考强度')).toBeTruthy()
    const effort = screen.getByText('高').closest('.chat-picker-row')
    expect(effort?.className).toContain('chat-picker-row-selected')
  })

  it('labels same-named models with their provider, so the two V4.1-Flash rows differ', async () => {
    // 实测：两个 provider 各有一个 DeepSeek-V4.1-Flash，列表里两行一模一样，用户
    // 只能靠上方的分组标题猜自己在选谁。重名时才补 provider。
    modelsMock.mockResolvedValue({
      current: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
      routable: true,
      groups: [
        { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1-Flash' }] },
        { id: 'account', name: 'DeepSeek Account', models: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1-Flash' }] },
        { id: 'agnes', name: 'agnes-ai', models: [{ id: 'agnes-2.5-flash', name: 'agnes-2.5-flash' }] },
      ],
      failures: [],
    } satisfies SessionModels)
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    fireEvent.click(screen.getByRole('button', { name: /切换模型/ }))
    expect(await screen.findByText('DeepSeek-V4.1-Flash · DeepSeek')).toBeTruthy()
    expect(screen.getByText('DeepSeek-V4.1-Flash · DeepSeek Account')).toBeTruthy()
    // 独名的那项不加后缀，保持干净。
    expect(screen.getByText('agnes-2.5-flash')).toBeTruthy()
  })

  it('shows the model in force even when the catalog does not list it', async () => {
    // 实测：chip 是 v4.1-flash:1017，目录里没有这一项，整张表没有一项打勾。
    modelsMock.mockResolvedValue({
      current: { provider: 'modelflare', model: 'v4.1-flash:1017' },
      routable: true,
      groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1-Flash' }] }],
      failures: [],
    } satisfies SessionModels)
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    fireEvent.click(screen.getByRole('button', { name: /切换模型/ }))
    expect(await screen.findByText('当前')).toBeTruthy()
    // chip 上也写着同一个 id，查询限定在面板内。
    const panel = screen.getByRole('menu', { name: '选择模型' })
    const row = within(panel).getByText('v4.1-flash:1017').closest('.chat-picker-row')
    expect(row?.className).toContain('chat-picker-row-selected')
  })

  it('switches the model directly from the strip and closes it', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    fireEvent.click(screen.getByRole('button', { name: /切换模型/ }))
    const card = await screen.findByText('FX 深度')
    fireEvent.click(card)
    expect(selectModelMock).toHaveBeenCalledWith('s-1', { provider: 'fx', model: 'fx-2', reasoningEffort: 'high' })
    await waitFor(() => expect(screen.queryByRole('menu', { name: '选择模型' })).toBeNull())
    // The chip label follows the model id returned by the host.
    expect(await screen.findByText('fx-2')).toBeTruthy()
  })

  it('shows a retry when the model catalog fails to load', async () => {
    modelsMock.mockRejectedValueOnce(new Error('HTTP 500'))
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    fireEvent.click(screen.getByRole('button', { name: /切换模型/ }))
    expect(await screen.findByText('重试')).toBeTruthy()
    fireEvent.click(screen.getByText('重试'))
    expect(await screen.findByText('FX 标准')).toBeTruthy()
  })

  it('dismisses the strip when the scrim is tapped', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    const { container } = render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    fireEvent.click(screen.getByRole('button', { name: /切换模型/ }))
    await screen.findByText('FX 标准')
    const scrim = container.querySelector('.chat-picker-scrim')
    expect(scrim).not.toBeNull()
    fireEvent.click(scrim as Element)
    await waitFor(() => expect(screen.queryByRole('menu', { name: '选择模型' })).toBeNull())
  })

  it('opens the permission strip and switches through /permission', async () => {
    loadChatPageMock.mockResolvedValue(permissionHistory())
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    fireEvent.click(screen.getByRole('button', { name: /切换权限/ }))
    expect(await screen.findByText('工作区写入')).toBeTruthy()
    fireEvent.click(screen.getByText('工作区写入'))
    expect(sendCommandMock).toHaveBeenCalledWith('s-1', '/permission workspace-write')
    await waitFor(() => expect(screen.queryByRole('menu', { name: '选择权限' })).toBeNull())
    // pill 只有 32px 高：可见文本用中文短名，完整值留在 aria-label 里（否则会被省略号吃掉）。
    expect(await screen.findByText('可写')).toBeTruthy()
    expect(screen.getByRole('button', { name: '切换权限：工作区写入' })).toBeTruthy()
  })
  it('routes the full-access preset through the confirming sheet, never directly', async () => {
    loadChatPageMock.mockResolvedValue(permissionHistory())
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    fireEvent.click(screen.getByRole('button', { name: /切换权限/ }))
    const dangerCard = await screen.findByText('完全权限')
    expect(dangerCard.closest('.chat-picker-row')?.className).toContain('chat-picker-row-danger')
    fireEvent.click(dangerCard)
    expect(sendCommandMock).not.toHaveBeenCalled()
    // The popover is the only preset list now, so picking full access there
    // must raise the confirm itself — the old sheet hop is gone, and with it
    // the silent-switch path that skipped the warning.
    await waitFor(() => expect(screen.queryByRole('menu', { name: '选择权限' })).toBeNull())
    expect(await screen.findByText('确认完全权限')).toBeTruthy()
    expect(screen.getByText(/开启完全权限后/)).toBeTruthy()
  })
})

/** Emit one session lifecycle frame for the chat's session (file-level: the
 * stop-button suite and the plan-strip suite both use it). */
function emitSessionEvent(mux: FakeMux, type: string, seq: number): void {
  act(() => {
    mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry(type, {}, seq).event })
  })
}

describe('ChatView stop button (#1041)', () => {
  it('switches the composer primary to a stop button while running and cancels the turn', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    // Idle: the primary button is the (empty-draft disabled) send button.
    const sendButton = await screen.findByRole('button', { name: '发送' })
    expect((sendButton as HTMLButtonElement).disabled).toBe(true)

    // Turn starts: the primary becomes an enabled stop button (square icon).
    emitSessionEvent(mux, 'turn/start', 1)
    const stopButton = (await screen.findByRole('button', { name: '停止' })) as HTMLButtonElement
    expect(stopButton.disabled).toBe(false)

    fireEvent.click(stopButton)
    await waitFor(() => expect(cancelSessionMock).toHaveBeenCalledWith('s-1'))

    // Turn ends: the primary flips back to send.
    emitSessionEvent(mux, 'turn/end', 2)
    expect(await screen.findByRole('button', { name: '发送' })).toBeTruthy()
  })

  it('disables the stop button while the cancel request is in flight', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    let resolveCancel: (() => void) | undefined
    cancelSessionMock.mockReturnValue(new Promise<{ accepted: true }>((resolve) => {
      resolveCancel = () => { resolve({ accepted: true }) }
    }))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    emitSessionEvent(mux, 'turn/start', 1)
    const stopButton = (await screen.findByRole('button', { name: '停止' })) as HTMLButtonElement
    fireEvent.click(stopButton)

    // In flight: disabled and re-labeled; a second tap cannot double-submit.
    const inflight = (await screen.findByRole('button', { name: '停止中' })) as HTMLButtonElement
    expect(inflight.disabled).toBe(true)
    fireEvent.click(inflight)
    expect(cancelSessionMock).toHaveBeenCalledTimes(1)

    await act(async () => { resolveCancel?.() })
    emitSessionEvent(mux, 'turn/end', 2)
    expect(await screen.findByRole('button', { name: '发送' })).toBeTruthy()
  })

  it('surfaces a cancel failure through the chat error line', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    cancelSessionMock.mockRejectedValue(new Error('cancel exploded'))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    emitSessionEvent(mux, 'turn/start', 1)
    fireEvent.click(await screen.findByRole('button', { name: '停止' }))
    expect(await screen.findByText(/cancel exploded/)).toBeTruthy()
  })

  it('keeps the permission pill when the page carries no projection, and pulls on tap', async () => {
    // 冷启动/深链直进会话时，宿主的会话枚举还没跑过，尾页快速通道带不回权限投影。
    // 按钮曾经整块不渲染——用户看到的就是"权限面板消失了"。它现在总是在，缺数据
    // 时点一下就地补。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    readChatMock.mockResolvedValue({
      rows: [],
      maxSeq: 1,
      hasMore: false,
      projections: { asOfSeq: 1, values: { permissions: { currentValue: 'workspace-write' } } },
    })
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    fireEvent.click(screen.getByRole('button', { name: '切换权限：读取中' }))
    await waitFor(() => { expect(readChatMock).toHaveBeenCalled() })
    // The projection that lands seeds the picker and opens it.
    expect(await screen.findByRole('button', { name: /切换权限：workspace-write/ })).toBeTruthy()
  })
  it('reconciles a lost turn/end frame against the host running state', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    vi.useFakeTimers()
    try {
      // Turn starts over the live stream, but the turn/end frame is lost to
      // the reconnect (no correction ever arrives over SSE).
      emitSessionEvent(mux, 'turn/start', 1)
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()

      // The host's own view is authoritative: while it still runs, the
      // reconciliation must not clobber the indicator.
      listSessionsMock.mockResolvedValue({
        items: [{ sessionId: 's-1', running: true } as never],
        hasMore: false,
      } as SessionPage)
      await vi.advanceTimersByTimeAsync(10_000)
      // Ten silent seconds in, the wording is 输出中; reconciliation
      // with a still-running host must NOT clear the row.
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()

      // The host reports the turn finished: the indicator self-heals.
      listSessionsMock.mockResolvedValue({
        items: [{ sessionId: 's-1', running: false } as never],
        hasMore: false,
      } as SessionPage)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(screen.queryByRole('status', { name: '输出中' })).toBeNull()
      expect(screen.getByRole('button', { name: '发送' })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reconciles from the folded log tail instead of inflating the whole history', async () => {
    // session.history has to inflate the entire log (34 s on a 52 MB session) —
    // that wait was the "refreshes slowly" the phone showed. The tail already
    // says whether the turn is open, in ~20 ms, so it must be the first probe.
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    vi.useFakeTimers()
    try {
      emitSessionEvent(mux, 'turn/start', 1)
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()

      // Tail without a turn/start anchor = the turn already ended.
      logTailMock.mockResolvedValue({ rows: [], maxSeq: 3, hasMore: false })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(screen.getByRole('button', { name: '发送' })).toBeTruthy()
      expect(logTailMock).toHaveBeenCalled()
      expect(historyMock).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the indicator when the tail and the host both say the turn is open', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    vi.useFakeTimers()
    try {
      emitSessionEvent(mux, 'turn/start', 1)
      // The turn is still open: keep the indicator and its clock.
      logTailMock.mockResolvedValue({ rows: [], maxSeq: 3, hasMore: false, turnStartAt: 1_700_000_000_000 })
      runningSessionsMock.mockResolvedValue({ sessionIds: [session.sessionId] })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(screen.getByRole('button', { name: '停止' })).toBeTruthy()
      expect(historyMock).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the turn running when the log tail cannot see the boundary at all', async () => {
    // 真机实测的病灶：一轮工具跑二十几步之后，48 帧的尾切里全是工具事件，宿主的
    // mobile.logTail 只回 rows/maxSeq/hasMore/lastEventAt——没有 turnStartAt。旧代码把
    // "没有锚点"当成"这一轮收工了"，于是命令还跑着，过程框已经写着已完成，而且
    // 十秒一次的核对每次都重新判成已完成，永远不纠正回来。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    vi.useFakeTimers()
    try {
      emitSessionEvent(mux, 'turn/start', 1)
      logTailMock.mockResolvedValue({
        rows: [],
        maxSeq: 3,
        hasMore: false,
        // 既没有 turnStartAt、也没有 turnOpen：这一小段里根本见不到边界。
        lastEventAt: Date.now(),
      })
      runningSessionsMock.mockResolvedValue({ sessionIds: [session.sessionId] })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()
      expect(screen.queryByRole('status', { name: '已完成' })).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes the turn as soon as the log tail reports a turn/end boundary', async () => {
    // 反方向：边界明确收口就立刻收工，不等宿主的集合，也不等事件静默。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    vi.useFakeTimers()
    try {
      emitSessionEvent(mux, 'turn/start', 1)
      logTailMock.mockResolvedValue({ rows: [], maxSeq: 4, hasMore: false, lastEventAt: Date.now(), turnOpen: false })
      // 宿主集合还说在跑也不算——边界是日志写下来的事实。
      runningSessionsMock.mockResolvedValue({ sessionIds: [session.sessionId] })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(screen.queryByRole('status', { name: '输出中' })).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a silent turn alive when the host still counts it as running', async () => {
    // 真机的反例：命令跑了很久（日志十分钟没一行事件），宿主集合却认这一轮。此前
    // "最后事件已经很久就判收工"会把正在跑的一轮判成已完成。集合说在跑，就是在跑。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    vi.useFakeTimers()
    try {
      emitSessionEvent(mux, 'turn/start', 1)
      logTailMock.mockResolvedValue({
        rows: [],
        maxSeq: 3,
        hasMore: false,
        turnStartAt: 1_700_000_000_000,
        lastEventAt: 1_700_000_001_000,
      })
      runningSessionsMock.mockResolvedValue({ sessionIds: [session.sessionId] })
      // 时钟推到十分钟之后：日志彻底静了，宿主集合仍认它。
      vi.setSystemTime(1_700_000_601_000)
      await vi.advanceTimersByTimeAsync(20_000)
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()
      expect(screen.queryByRole('status', { name: '已完成' })).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the process card running while an open tool call is alive, even with no running flag', async () => {
    // 真机现象：命令还在跑（或者正在改文件），过程框的头却写着「已完成」，而里面那条
    // 工具行还停在「运行中」——同一个框里前后矛盾。原因是行级判据挂在 running 这个
    // 启发式旗标上：它一翻假，settled 立刻把所有头改成已完成。日志里的锚点还开着，
    // 那这一轮就是开着的，工具行也就还活着。
    loadChatPageMock.mockResolvedValue(rowPage([
      { event: { type: 'turn/start', seq: 1, time: 1_700_000_000_000, data: { turn: 1 } } as WireEvent },
      { event: { type: 'user/message', seq: 2, time: 1_700_000_000_100, data: { id: 'u-1', role: 'user', content: [{ type: 'text', text: '跑一下' }] } } as WireEvent },
      { event: { type: 'tool/call', seq: 3, time: 1_700_000_000_200, data: { turn: 1, step: 0, callId: 'c1', name: 'bash', arguments: '{"cmd":"pnpm verify"}' } } as WireEvent },
    ], { turnStartAt: 1_700_000_000_000 }))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('跑一下')
    expect(screen.getAllByText('深度求索中').length).toBeGreaterThan(0)
    expect(screen.queryByText('已完成')).toBeNull()
  })

  it('takes the turn verdict from the atomic snapshot, not from the log window', async () => {
    // 主路径换成原子快照：宿主的 turn 判定、行、队列、目标、待办是同一次往返里的
    // 同一个切面。这里让快照说「在跑」、尾页说「收工」，过程框必须跟着宿主。
    const t0 = Date.now()
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const api = await import('../api.ts')
    vi.mocked(api.sessionState).mockResolvedValue({
      sessionId: 's-1',
      rows: [],
      maxSeq: 5,
      queue: [],
      queueRevision: 0,
      turn: { running: true, turnStartAt: t0 - 90_000 },
      asOf: t0,
    })
    // 尾页谎称收工：宿主的结论优先。
    logTailMock.mockResolvedValue({ rows: [], maxSeq: 5, hasMore: false, lastEventAt: t0, turnOpen: false })
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    vi.useFakeTimers()
    try {
      emitSessionEvent(mux, 'turn/start', 1)
      vi.setSystemTime(Date.now())
      await vi.advanceTimersByTimeAsync(20_000)
      await act(async () => { await Promise.resolve() })
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()
      // 回合判定不再单独走 mobile.turnState（那条通道已经并进快照）。
      expect(turnStateMock).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      resetSessionStateMock()
    }
  })

  it('does not read a silent log as "the turn is over": a long command keeps its clock', async () => {
    // 静默不是收工的凭据。一条编译命令跑三分钟、一次大文件读写，这段时间日志里一行
    // 事件都没有；此前"最后事件已经很久就判收工"正是"命令还在跑、过程框却写着已完成"
    // 的来源（工具行还停在运行中，同一个框里前后矛盾）。收工只认两条硬证据：最后一条
    // 边界是 turn/end，或者宿主自己说这轮不跑了。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    vi.useFakeTimers()
    try {
      emitSessionEvent(mux, 'turn/start', 1)
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()
      logTailMock.mockResolvedValue({
        rows: [],
        maxSeq: 3,
        hasMore: false,
        turnStartAt: 1_700_000_000_000,
        // 边界还开着，而且十分钟没有任何新事件——命令正在跑，只是不出声。
        lastEventAt: 1_700_000_000_500,
      })
      // 宿主说这一轮还在跑，那就还在跑（列表行不可信，要问专用集合）。
      runningSessionsMock.mockResolvedValue({ sessionIds: [session.sessionId] })
      vi.setSystemTime(1_700_000_600_500)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('still clears the indicator on a silent tail once the host says the turn is not running', async () => {
    // 反方向留一手：日志静了、边界还开着，但宿主自己说这轮不跑了——那就是真的没在跑
    // （turn/end 丢在断流窗口里的情形）。宿主的运行集合是它自己的知识，帧会丢，它不会。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    vi.useFakeTimers()
    try {
      emitSessionEvent(mux, 'turn/start', 1)
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()
      logTailMock.mockResolvedValue({
        rows: [],
        maxSeq: 3,
        hasMore: false,
        turnStartAt: 1_700_000_000_000,
        lastEventAt: 1_700_000_000_500,
      })
      runningSessionsMock.mockResolvedValue({ sessionIds: [] })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(screen.queryByRole('status', { name: '输出中' })).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the turn running while the tail is still moving even when the host set is empty', async () => {
    // 反方向：宿主的运行集合靠帧维护，实测一整轮零帧，它说"没在跑"的时候
    // 真实的那一轮可能正跑得好好的。以前这里以集合为准，于是手机把正在跑的
    // 一轮显示成已完成；现在尾页"还在动"就是真相。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    vi.useFakeTimers()
    try {
      emitSessionEvent(mux, 'turn/start', 1)
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()
      logTailMock.mockResolvedValue({
        rows: [],
        maxSeq: 3,
        hasMore: false,
        turnStartAt: 1_700_000_000_000,
        // Freshly written: the turn is alive right now, whatever the host set says.
        lastEventAt: Date.now() + 60_000,
      })
      runningSessionsMock.mockResolvedValue({ sessionIds: [] })
      await vi.advanceTimersByTimeAsync(20_000)
      // 帧静默一会儿之后措辞会从"输出中"变成"输出中"，但这一轮**仍然
      // 在跑**——判据是它没有翻成"已完成"。那才是这条测试要守的东西。
      expect(screen.queryByRole('status', { name: '已完成' })).toBeNull()
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })
  it('clears the indicator even when the session is off the first list page (missing row)', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    vi.useFakeTimers()
    try {
      emitSessionEvent(mux, 'turn/start', 1)
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()

      // The phone's session.list pages by updatedAt (NOT activity): a session
      // that has been quiet for a while falls off the first page even while
      // its turn is open. The list therefore has no row for it - the old
      // "row missing => skip" gate stuck the indicator forever. The history
      // tail is authoritative: a finished turn still self-heals.
      listSessionsMock.mockResolvedValue({
        items: [{ sessionId: 'other-session', running: false } as never],
        hasMore: false,
      } as SessionPage)
      historyMock.mockResolvedValue(historyPage([makeEntry('turn/end', {}, 60)]))
      await vi.advanceTimersByTimeAsync(10_000)
      expect(historyMock).toHaveBeenCalled()
      expect(screen.queryByRole('status', { name: '输出中' })).toBeNull()
      expect(screen.getByRole('button', { name: '发送' })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the indicator when the session is off the first list page but the turn is open (missing row)', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    vi.useFakeTimers()
    try {
      emitSessionEvent(mux, 'turn/start', 1)
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()

      // Same missing-row situation, but the turn is still open (history tail
      // ends in turn/start, e.g. the agent parked on a subagent): the scan
      // must NOT clear the indicator.
      listSessionsMock.mockResolvedValue({
        items: [{ sessionId: 'other-session', running: false } as never],
        hasMore: false,
      } as SessionPage)
      historyMock.mockResolvedValue(historyPage([makeEntry('turn/start', {}, 60)]))
      await vi.advanceTimersByTimeAsync(10_000)
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('flags the link but keeps the turn clock (process-card first line) when the host goes unreachable', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('还没有消息，发一句话开始吧')

    vi.useFakeTimers()
    try {
      // 秒表现在只活在过程卡第一行：先发一枚带 turn 号的 turn/start（折叠才知道
      // 锚点），再发一枚 live chunk 把"运行中"的行落进 DOM。
      const startedAt = Date.now()
      emitTurnStart(mux, 1, startedAt)
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()
      emitChunk(mux, 2, startedAt)
      flushLiveFold()
      // 假时钟下不用 waitFor（它在假时钟里会自己推进计时器，拖垮这个用例）。
      const head = procHeadEl()
      expect(head).not.toBeNull()
      expect(head.className).toContain('chat-proc-head-static')
      expect(head.getAttribute('aria-label')).toBe('深度求索中')
      expect(procStateOf(head)).toBe('深度求索中')
      expect(head.querySelector('.chat-proc-time')).toBeNull()

      // The host goes unreachable: every reconciliation probe fails. A single
      // blip must not touch the row; sustained failure (the host can never
      // answer) flags the LINK - it must NOT drop the turn, because that is
      // what used to zero the running clock mid-work on a flaky phone link.
      listSessionsMock.mockRejectedValue(new Error('host unreachable'))
      await vi.advanceTimersByTimeAsync(10_000)
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()
      // Third consecutive failure (30 s of unreachability): the wording
      // becomes 连接中断 while the turn and its clock stay alive.
      await vi.advanceTimersByTimeAsync(10_000)
      expect(screen.getByRole('status', { name: '连接中断' })).toBeTruthy()
      expect(screen.queryByRole('status', { name: '输出中' })).toBeNull()
      // 底部状态行只有措辞：秒表（和任何数字）都不在那里。
      expect(turnStatusEl().textContent).toBe('连接中断')
      expect(turnStatusEl().querySelector('.chat-turn-time')).toBeNull()
      expect(document.querySelector('.chat-turn-time')).toBeNull()
      // 秒表还在走，而且在过程卡第一行：网络抖动没把它清零。
      expect(procStateOf(head)).toBe('深度求索中')
      expect(procTimeOf(head)).toBe('用时30秒')
      // The turn is deliberately still open - that is the whole point: the
      // composer keeps offering 停止 instead of falling back to 发送.
      expect(screen.getByRole('button', { name: '停止' })).toBeTruthy()

      // The link recovers: the wording returns and the clock never restarted
      // (the recalibrated host offset must not rewind it).
      listSessionsMock.mockResolvedValue({
        items: [{ sessionId: 's-1', running: true } as never],
        hasMore: false,
      } as SessionPage)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(procTimeOf(head)).toBe('用时40秒')
      emitChunk(mux, 41, Date.now())
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()
      expect(turnStatusEl().textContent).toBe('输出中')
      expect(procTimeOf(head)).toBe('用时40秒')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the indicator when the agent is parked on a subagent (list running=false, turn open)', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    vi.useFakeTimers()
    try {
      emitSessionEvent(mux, 'turn/start', 1)
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()

      // The list says the agent is not running (it parks while a subagent
      // runs), but the turn is still open - the history tail ends in
      // turn/start, not turn/end. Reconciliation must NOT clear the row.
      listSessionsMock.mockResolvedValue({
        items: [{ sessionId: 's-1', running: false } as never],
        hasMore: false,
      } as SessionPage)
      historyMock.mockResolvedValue(historyPage([makeEntry('turn/start', {}, 50)]))
      await vi.advanceTimersByTimeAsync(10_000)
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the indicator at 输出中 while frames go silent', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    // The agent is genuinely running throughout this test: reconciliation
    // must not consult history (its default turn/end mock would clear the
    // indicator) while the frame stream just goes quiet.
    listSessionsMock.mockResolvedValue({
      items: [{ sessionId: 's-1', running: true } as never],
      hasMore: false,
    } as SessionPage)
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    vi.useFakeTimers()
    try {
      emitSessionEvent(mux, 'turn/start', 1)
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()

      // Frames keep flowing for a while: the wording stays 输出中.
      await vi.advanceTimersByTimeAsync(5_000)
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()

      // The stream stops but the turn is still open: back-office wording.
      await vi.advanceTimersByTimeAsync(7_000)
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()

      // Any frame at all - even another session's (the memory-upkeep
      // subagent streams on the same mux) - restores the typing wording.
      act(() => { mux.emit({ type: 'session/event', sessionId: 's-sub', event: makeEntry('assistant/message', {}, 5).event }) })
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()

      emitSessionEvent(mux, 'turn/end', 9)
      // The status row is gone (the context ring keeps its own role=status,
      // so assert on the wording, not the bare role).
      expect(screen.queryByText('输出中')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ChatView run-status strip (session/jobs)', () => {
  const job = (id: string, status: string, label = '整理记忆'): never => ({
    id, kind: 'subagent', label, status, startedAt: 1_700_000_000_000,
  }) as never

  it('shows a strip from a session/jobs frame and lists jobs in the sheet', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    // No jobs yet: the strip is absent.
    expect(screen.queryByRole('button', { name: /后台任务/ })).toBeNull()

    act(() => { mux.emit({ type: 'session/jobs', sessionId: 's-1', jobs: [job('subagent-1', 'running', '整理记忆')] }) })
    const strip = screen.getByRole('button', { name: /后台任务 1 个运行中/ })
    expect(strip).toBeTruthy()

    // Open the run-status sheet: the job row is listed there.
    fireEvent.click(strip)
    expect(screen.getByRole('dialog', { name: '运行状态' })).toBeTruthy()
    expect(screen.getByText('整理记忆')).toBeTruthy()
    expect(screen.getByText(/子代理 · 运行中/)).toBeTruthy()
  })

  it('ignores session/jobs frames for other sessions', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    act(() => { mux.emit({ type: 'session/jobs', sessionId: 's-other', jobs: [job('subagent-9', 'running')] }) })
    expect(screen.queryByRole('button', { name: /后台任务/ })).toBeNull()
  })

  it('hides the strip when the jobs snapshot empties', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    act(() => { mux.emit({ type: 'session/jobs', sessionId: 's-1', jobs: [{ id: 'subagent-1', kind: 'subagent', label: '整理记忆', status: 'running', startedAt: 1_700_000_000_000 }] }) })
    expect(screen.getByRole('button', { name: /后台任务/ })).toBeTruthy()

    // The host sends [] when the last task settles: the strip fades out then unmounts.
    act(() => { mux.emit({ type: 'session/jobs', sessionId: 's-1', jobs: [] }) })
    await waitFor(() => { expect(screen.queryByRole('button', { name: /后台任务/ })).toBeNull() })
  })

  it('seeds the strip from the mux-cached snapshot when a chat opens', async () => {
    // The mux baseline arrived at app boot, before this chat was mounted; the
    // tasks were cached by the client and replay on mount.
    const mux = new FakeMux()
    mux.cached['s-1'] = [job('pwsh-7', 'running', '后台构建')]
    loadChatPageMock.mockResolvedValue(rowPage([]))
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    // No frame has arrived yet — the strip already reflects the cached task.
    expect(screen.getByRole('button', { name: /后台任务 1 个运行中/ })).toBeTruthy()
  })

  it('keeps the strip absent when the mux has no cached snapshot', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    expect(screen.queryByRole('button', { name: /后台任务/ })).toBeNull()
  })
})

describe('ChatView foreground-subagent badge + tree sheet', () => {
  const runningChild = (): never => ({
    kind: 'child', id: 's-sub', mode: 'one-shot', activity: 'running', hasChildren: false, label: '整理记忆',
  }) as never

  it('shows running subagents in the run-status strip and sheet', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    subagentsListMock.mockResolvedValue({ entries: [runningChild()], parentAvailable: true })
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    // The flat subagent fetch (mounted on open) reports one running subagent
    // → the run-status strip mentions it.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '子代理 1 个运行中' })).toBeTruthy()
    })
    // Tapping the strip opens the run-status sheet with the subagent section.
    fireEvent.click(screen.getByRole('button', { name: '子代理 1 个运行中' }))
    expect(screen.getByRole('dialog', { name: '运行状态' })).toBeTruthy()
    expect(screen.getByText('整理记忆')).toBeTruthy()
    expect(screen.getByText('运行中')).toBeTruthy()
  })

  it('omits the run-status strip when no subagent/job/todo is live', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    subagentsListMock.mockResolvedValue({
      entries: [{ kind: 'child', id: 's-sub', mode: 'one-shot', activity: 'inactive', hasChildren: false, label: '整理记忆' } as never],
      parentAvailable: true,
    })
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    await waitFor(() => { expect(subagentsListMock).toHaveBeenCalled() })
    // An idle subagent alone does not surface the run-status strip.
    expect(screen.queryByRole('button', { name: /子代理/ })).toBeNull()
  })
})

describe('ChatView message visibility and long text folding (#1065)', () => {
  const toolOnlyEvents = (): Array<{ event: WireEvent }> => [
    makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '查询文件' }] }, 0),
    makeEntry('assistant/message', {
      turn: 0,
      step: 0,
      message: { id: 'a-1', role: 'assistant', content: [] },
    }, 1),
    makeEntry('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'read_file', arguments: '{"path":"/a"}' }, 2),
  ]

  it('hides assistant message completely (no air bubble) when only tool calls exist and showToolCalls is off', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(toolOnlyEvents()))
    const { container } = render(<ChatView session={session} onBack={() => {}} showToolCalls={false} showSystemMessages={false} />)

    expect(await screen.findByText('查询文件')).toBeTruthy()
    // showToolCalls is off: no tool disclosure, and the entire assistant
    // message bubble is not rendered (no air bubble). The old
    // `button[name=/步/]` probe died with the step count leaving the card face
    // (P11) — the direct assertion is that no process group renders at all.
    expect(container.querySelector('.chat-proc')).toBeNull()
    const msgElements = container.querySelectorAll('.chat-msg')
    expect(msgElements.length).toBe(1)
    expect(msgElements[0]?.classList.contains('chat-msg-user')).toBe(true)
  })

  it('renders failed tag even if assistant message has no text or reasoning', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '测试失败' }] }, 0),
      makeEntry('assistant/message', {
        turn: 0,
        step: 0,
        message: { id: 'a-1', role: 'assistant', content: [] },
      }, 1),
      makeEntry('turn/end', { turn: 0, reason: { kind: 'error', message: 'timeout' } }, 2),
    ]))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    expect(await screen.findByText('测试失败')).toBeTruthy()
    expect(await screen.findByText('本次回复失败')).toBeTruthy()
  })

  it('collapses terminal assistant text exceeding LONG_TEXT_LIMIT and toggles open/close', async () => {
    const longText = 'A'.repeat(LONG_TEXT_LIMIT + 100)
    loadChatPageMock.mockResolvedValue(rowPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '生成长文本' }] }, 0),
      makeEntry('assistant/message', {
        turn: 0,
        step: 0,
        message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: longText }] },
      }, 1),
    ]))
    const { container } = render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    expect(await screen.findByText('生成长文本')).toBeTruthy()
    const toggleButton = await screen.findByRole('button', { name: new RegExp(`展开全文（${LONG_TEXT_LIMIT + 100} 字）`) })
    expect(toggleButton).toBeTruthy()
    expect(container.querySelector('.chat-md-collapsed')).not.toBeNull()

    // Expand
    fireEvent.click(toggleButton)
    expect(await screen.findByRole('button', { name: '收起' })).toBeTruthy()
    expect(container.querySelector('.chat-md-collapsed')).toBeNull()
  })

  it('does not collapse terminal assistant text within LONG_TEXT_LIMIT', async () => {
    const shortText = 'B'.repeat(LONG_TEXT_LIMIT)
    loadChatPageMock.mockResolvedValue(rowPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '生成中等文本' }] }, 0),
      makeEntry('assistant/message', {
        turn: 0,
        step: 0,
        message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: shortText }] },
      }, 1),
    ]))
    const { container } = render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    expect(await screen.findByText('生成中等文本')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /展开全文/ })).toBeNull()
    expect(container.querySelector('.chat-md-collapsed')).toBeNull()
  })
})

describe('ChatView in-body think tags', () => {
  // The tag pair built from char codes so the source bytes can never be
  // garbled: ASCII " <think>" / " </think>".
  const OPEN = String.fromCharCode(60, 116, 104, 105, 110, 107, 62)
  const CLOSE = String.fromCharCode(60, 47, 116, 104, 105, 110, 107, 62)

  it('renders the body think tags as a collapsed disclosure and expands on tap', async () => {
    const events = [
      makeEntry('user/message', { id: 'u-2', role: 'user', content: [{ type: 'text', text: '分析一下' }] }, 0),
      makeEntry('assistant/message', {
        turn: 0,
        step: 0,
        message: {
          id: 'a-2',
          role: 'assistant',
          content: [{ type: 'text', text: '先想再答\n\n' + OPEN + '先看结构\n再看细节' + CLOSE + '\n\n结论' }],
        },
      }, 1),
    ]
    loadChatPageMock.mockResolvedValue(rowPage(events))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    expect(await screen.findByText('分析一下')).toBeTruthy()
    // Paragraphs render around the folded block; the block itself collapses.
    expect(await screen.findByText('先想再答')).toBeTruthy()
    const head = await screen.findByRole('button', { name: /思考过程/ })
    expect(head.getAttribute('aria-expanded')).toBe('false')
    // Collapsed: only the one-line summary (first line) shows; body is hidden.
    expect(screen.queryByText('再看细节')).toBeNull()
    // The surrounding text flows into distinct paragraphs (no br spacing).
    expect(screen.getByText('结论')).toBeTruthy()

    fireEvent.click(head)
    expect(head.getAttribute('aria-expanded')).toBe('true')
    expect(await screen.findByText(/再看细节/)).toBeTruthy()
  })

  it('clamps a long in-body think block to five lines with a reveal-more action', async () => {
    const thinkLines = Array.from({ length: 8 }, (_, k) => `深层思考第 ${k + 1} 行`).join('\n')
    const events = [
      makeEntry('user/message', { id: 'u-3', role: 'user', content: [{ type: 'text', text: '为什么' }] }, 0),
      makeEntry('assistant/message', {
        turn: 0,
        step: 0,
        message: {
          id: 'a-3',
          role: 'assistant',
          content: [{ type: 'text', text: OPEN + thinkLines + CLOSE }],
        },
      }, 1),
    ]
    loadChatPageMock.mockResolvedValue(rowPage(events))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    const head = await screen.findByRole('button', { name: /思考过程/ })
    fireEvent.click(head)
    // Expanded view stops at five lines; the rest hides behind the reveal.
    expect(await screen.findByText(/深层思考第 5 行/)).toBeTruthy()
    expect(screen.queryByText(/深层思考第 6 行/)).toBeNull()
    const more = await screen.findByRole('button', { name: '还有 3 行思考...' })
    fireEvent.click(more)
    expect(await screen.findByText(/深层思考第 8 行/)).toBeTruthy()
  })

  it('rides the message tail as a footnote: think folds render inside .chat-md-notes after the answer', async () => {
    const events = [
      makeEntry('user/message', { id: 'u-4', role: 'user', content: [{ type: 'text', text: '顺序' }] }, 0),
      makeEntry('assistant/message', {
        turn: 0,
        step: 0,
        message: {
          id: 'a-4',
          role: 'assistant',
          content: [{ type: 'text', text: '开头段\n\n' + OPEN + '中间思考' + CLOSE + '\n\n结尾段' }],
        },
      }, 1),
    ]
    loadChatPageMock.mockResolvedValue(rowPage(events))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    await screen.findByText('开头段')
    await screen.findByText('结尾段')
    // The fold lives in the footnote container…
    const notes = document.querySelector('.chat-msg-assistant .chat-md-body .chat-md-notes')
    expect(notes).not.toBeNull()
    const heads = Array.from(notes?.querySelectorAll('button') ?? [])
    expect(heads.some(button => button.textContent?.includes('思考过程'))).toBe(true)
    // …and the notes block is the LAST child of the body (never interrupting
    // the answer flow, even though the tag sits mid-text).
    const body = document.querySelector('.chat-msg-assistant .chat-md-body')
    const children = Array.from(body?.children ?? [])
    expect(children[children.length - 1]).toBe(notes)
  })
})

describe('ChatView text selection vs custom menu', () => {
  /** Render one assistant message and return { textEl, bubble }. */
  async function renderOneTurn(): Promise<{ textEl: Element; bubble: Element }> {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('改一下代码')
    const textEl = await screen.findByText('已完成修改')
    const bubble = textEl.closest('.chat-msg')
    if (bubble === null) throw new Error('no .chat-msg bubble')
    return { textEl, bubble }
  }

  it('gives priority to an existing text selection: contextmenu shows no custom menu', async () => {
    const { textEl } = await renderOneTurn()
    // With a live selection the system menu wins — no custom menu appears.
    const spy = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '已完成修改' } as Selection)
    try {
      fireEvent.contextMenu(textEl)
    } finally {
      spy.mockRestore()
    }
    expect(screen.queryByRole('menuitem', { name: '复制' })).toBeNull()

    // Without a selection the custom menu still opens (whole-message copy).
    fireEvent.contextMenu(textEl)
    expect(await screen.findByRole('menuitem', { name: '复制' })).toBeTruthy()
  })

  it('starts a long-press menu on message text and bubble chrome', async () => {
    const { textEl, bubble } = await renderOneTurn()
    // Clear any pending state from previous events.
    fireEvent.touchMove(bubble, { touches: [{ clientX: 10, clientY: 10 }] })

    // Long-press on the rendered markdown text arms the menu timer (the
    // custom menu now owns message text; code blocks/images still defer).
    const spy = vi.spyOn(window, 'setTimeout')
    try {
      fireEvent.touchStart(textEl, { touches: [{ clientX: 50, clientY: 50 }] })
      const timerCalls = spy.mock.calls.filter(([, ms]) => ms === 500)
      expect(timerCalls.length).toBeGreaterThan(0)
      // Fire the armed timer: the custom menu opens (whole-message copy).
      const timer = timerCalls[0]?.[0] as unknown as () => void
      act(() => { timer() })
      expect(await screen.findByRole('menuitem', { name: '复制' })).toBeTruthy()
    } finally {
      spy.mockRestore()
    }

    // Long-press on the bubble chrome (padding area): the menu timer is armed.
    const spy2 = vi.spyOn(window, 'setTimeout')
    try {
      fireEvent.touchStart(bubble, { touches: [{ clientX: 50, clientY: 50 }] })
      const timerCalls = spy2.mock.calls.filter(([, ms]) => ms === 500)
      expect(timerCalls.length).toBeGreaterThan(0)
      // Fire the armed timer: the custom menu opens (whole-message copy).
      const timer = timerCalls[0]?.[0] as unknown as () => void
      act(() => { timer() })
      expect(await screen.findByRole('menuitem', { name: '复制' })).toBeTruthy()
    } finally {
      spy2.mockRestore()
    }
  })

  it('turns a command-row press into row-scoped actions, not the whole reply', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    // 过程行在折叠的组里，展开才有行可长按。
    fireEvent.click(document.querySelector('button.chat-proc-head') as Element)
    const row = await screen.findByText('运行命令')
    const stepRow = row.closest('.chat-step')
    expect(stepRow).not.toBeNull()
    fireEvent.contextMenu(stepRow as Element)
    const menu = await screen.findByRole('menu', { name: '消息操作' })
    // 行头先告诉用户操作的是哪一行，动作也换成行级的，并且有可见的取消。
    expect(menu.textContent).toContain((stepRow as HTMLElement).getAttribute('data-step-title') ?? '运行命令')
    expect(within(menu).getByRole('menuitem', { name: '复制这一行' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: '取消' })).toBeTruthy()
    // 行级菜单不再堆三个"复制"变体，也不把整条回复拿去分享。
    expect(within(menu).queryByRole('menuitem', { name: '复制原文' })).toBeNull()
    expect(within(menu).queryByRole('menuitem', { name: '分享' })).toBeNull()
    fireEvent.click(within(menu).getByRole('menuitem', { name: '取消' }))
    await waitFor(() => { expect(screen.queryByRole('menu', { name: '消息操作' })).toBeNull() })
  })

  it('hands the pressed block to the system selection from 选择文字', async () => {
    const { textEl } = await renderOneTurn()
    window.getSelection()?.removeAllRanges()
    fireEvent.contextMenu(textEl)
    const menu = await screen.findByRole('menu', { name: '消息操作' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: '选择文字' }))
    // 菜单让位，选区落在正文上——用户接着能拖手柄、用系统菜单复制片段。
    await waitFor(() => { expect(screen.queryByRole('menu', { name: '消息操作' })).toBeNull() })
    expect(window.getSelection()?.toString()).toContain('已完成修改')
    window.getSelection()?.removeAllRanges()
  })

  it('drops the custom menu the moment the browser starts a selection', async () => {
    const { textEl } = await renderOneTurn()
    window.getSelection()?.removeAllRanges()
    fireEvent.contextMenu(textEl)
    expect(await screen.findByRole('menu', { name: '消息操作' })).toBeTruthy()
    const range = document.createRange()
    range.selectNodeContents(textEl)
    window.getSelection()?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await waitFor(() => { expect(screen.queryByRole('menu', { name: '消息操作' })).toBeNull() })
    window.getSelection()?.removeAllRanges()
  })

  it('places the menu above a row that sits at the bottom of the screen', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    fireEvent.click(document.querySelector('button.chat-proc-head') as Element)
    const stepRow = (await screen.findByText('运行命令')).closest('.chat-step') as HTMLElement
    // jsdom 的 rect 全是 0，测不出翻边；给这一行一个「贴着屏幕底部」的真实位置。
    vi.spyOn(stepRow, 'getBoundingClientRect').mockReturnValue({
      top: 700, bottom: 744, left: 24, right: 360, height: 44, width: 336, x: 24, y: 700, toJSON: () => ({}),
    } as DOMRect)
    fireEvent.contextMenu(stepRow)
    const menu = await screen.findByRole('menu', { name: '消息操作' })
    const top = Number.parseFloat(menu.style.top)
    // 下方放不下 → 菜单整体落在这一行上方，不盖住它。
    expect(top).toBeLessThanOrEqual(700)
    expect(top).toBeGreaterThan(0)
  })

  it('edits and resends a user message through the context menu', async () => {
    await renderOneTurn()
    promptMock.mockClear()
    const userEl = await screen.findByText('改一下代码')
    fireEvent.contextMenu(userEl)
    const edit = await screen.findByRole('menuitem', { name: '编辑并重新发送' })
    fireEvent.click(edit)
    // The edit dialog opens with the original text prefilled.
    const input = await screen.findByRole('textbox', { name: '编辑并重新发送' })
    fireEvent.change(input, { target: { value: '改一下代码2' } })
    // The dialog's confirm button ("发送"), not the composer's.
    const dialog = await screen.findByRole('dialog', { name: '编辑并重新发送' })
    fireEvent.click(within(dialog).getByRole('button', { name: '发送' }))
    await waitFor(() => { expect(promptMock).toHaveBeenCalled() })
  })

  it('closes the context menu on Escape', async () => {
  // iPad/外接键盘上背景点击够不到，Esc 是唯一顺手的取消方式。
  await renderOneTurn()
  const userEl = await screen.findByText('改一下代码')
  fireEvent.contextMenu(userEl)
  expect(await screen.findByRole('menu', { name: '消息操作' })).toBeTruthy()
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => { expect(screen.queryByRole('menu', { name: '消息操作' })).toBeNull() })
})
it('regenerates the last assistant reply via its footer button', async () => {
    await renderOneTurn()
    promptMock.mockClear()
    const regenerate = await screen.findByRole('button', { name: '重新生成回复' })
    fireEvent.click(regenerate)
    await waitFor(() => { expect(promptMock).toHaveBeenCalled() })
  })

  it('keeps the regenerate affordance to one icon: no verb on screen', async () => {
    // 手机上"重新生成"四个字白占 ~48px，而这一行本来只有时间戳。含义留在
    // aria-label/title 里，视觉上只有一个可点的 ↻。
    await renderOneTurn()
    const regenerate = await screen.findByRole('button', { name: '重新生成回复' })
    expect(regenerate.textContent).toBe('↻')
    expect(regenerate.textContent).not.toContain('重新生成')
  })

  it('sends one prompt even when the icon is tapped twice before the turn starts', async () => {
    // 点下到轮次真的开跑之间有个窗口，这段时间按钮还在屏上。旧实现双击会
    // 追加两条"请忽略上一条回答"，而这些行删不掉。
    //
    // 这里故意在同一帧里派发两次**原生** click：React 还没来得及把 disabled
    // 刷上去，所以能挡住的只可能是那个 in-flight 闸门（用 fireEvent 是测不到
    // 它的——第二次点击撞上的已经是禁用按钮）。
    await renderOneTurn()
    promptMock.mockClear()
    promptMock.mockImplementation(() => new Promise(() => {}))
    const regenerate = await screen.findByRole('button', { name: '重新生成回复' })
    act(() => {
      regenerate.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      regenerate.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      regenerate.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await waitFor(() => { expect(promptMock).toHaveBeenCalledTimes(1) })
    // 已发出：原地转圈并禁用，语义也跟着变。
    const busy = await screen.findByRole('button', { name: '正在重新回答' })
    expect(busy.className).toContain('chat-msg-regenerate-busy')
    expect((busy as HTMLButtonElement).disabled).toBe(true)
  })

  it('turns the icon red and lets it be tapped again when the send fails', async () => {
    await renderOneTurn()
    promptMock.mockClear()
    promptMock.mockRejectedValue(new Error('offline'))
    const regenerate = await screen.findByRole('button', { name: '重新生成回复' })
    fireEvent.click(regenerate)
    await waitFor(() => {
      const failed = screen.getByRole('button', { name: '重新生成回复' })
      expect(failed.className).toContain('chat-msg-regenerate-failed')
      expect((failed as HTMLButtonElement).disabled).toBe(false)
    })
    // 失败后闸门放开：还能再点一次。
    fireEvent.click(screen.getByRole('button', { name: '重新生成回复' }))
    await waitFor(() => { expect(promptMock).toHaveBeenCalledTimes(2) })
  })

  it('lets an image through to the native menu: contextmenu on <img> shows no custom menu', async () => {
    const events = [
      makeEntry('user/message', { id: 'u-5', role: 'user', content: [{ type: 'text', text: '发图' }] }, 0),
      makeEntry('assistant/message', {
        turn: 0,
        step: 0,
        message: {
          id: 'a-5',
          role: 'assistant',
          content: [{ type: 'text', text: '看图 ![夜景](https://platform-outputs.agnes-ai.space/x.png) 结尾' }],
        },
      }, 1),
    ]
    loadChatPageMock.mockResolvedValue(rowPage(events))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText(/结尾/)
    const img = document.querySelector<HTMLImageElement>('.chat-msg img')
    expect(img).not.toBeNull()
    // Long-press/right-click on the image must NOT arm the custom menu — the
    // native "save image" action has to win.
    fireEvent.contextMenu(img as HTMLImageElement)
    expect(screen.queryByRole('menuitem', { name: '复制' })).toBeNull()
    // The bubble chrome still gets its menu.
    const bubble = img?.closest('.chat-msg') ?? null
    fireEvent.contextMenu(bubble as Element)
    expect(await screen.findByRole('menuitem', { name: '复制' })).toBeTruthy()
  })
})

describe('ChatView streaming preview', () => {
  it('keeps **bold** and `code` styled while a paragraph is still streaming (tail preview)', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    // A single unclosed paragraph (no blank line yet) stays in the plain-text
    // tail preview — inline markdown must still render as real tags so a
    // paragraph falling back into the tail never flashes literal **text**.
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('assistant/chunk', { turn: 1, step: 0, chunk: { type: 'text-delta', index: 0, text: '这是 **加粗** 和 `代码` 内容' } }, 6).event })
    })
    const bold = await screen.findByText('加粗')
    expect(bold.tagName).toBe('STRONG')
    const code = screen.getByText('代码')
    expect(code.tagName).toBe('CODE')
  })

  it('keeps a paragraph bold after a multi-step merge rewrites the text (guard reset → tail preview)', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    // Step 0 streams a closed paragraph — stable, markdown-rendered.
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('assistant/chunk', { turn: 1, step: 0, chunk: { type: 'text-delta', index: 0, text: '第一段 **加粗**\n\n' } }, 6).event })
    })
    const bold = await screen.findByText('加粗')
    expect(bold.tagName).toBe('STRONG')
    // Step 0 finalizes with an authoritative text that differs from the chunk
    // accumulation (blank line collapsed) — the message settles, markdown stays.
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('assistant/message', { turn: 1, step: 0, message: { id: 'a-6', role: 'assistant', content: [{ type: 'text', text: '第一段 **加粗**\n第二段' }] } }, 7).event })
    })
    await screen.findByText(/第二段/)
    expect(screen.getAllByText('加粗')[0]!.tagName).toBe('STRONG')
    // Step 1 streams: the same-turn rows coalesce into one pending message
    // whose text is re-joined from the authoritative step-0 text — the
    // text-rewrite guard resets the stable blocks and the paragraph falls
    // back into the tail preview. The preview must still render **bold**.
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '第三段' } }, 8).event })
    })
    await screen.findByText(/第三段/)
    // The merge judges the answer BY STEP: the last step's text keeps the
    // transcript, while the earlier rewritten paragraph moves INTO the
    // collapsed process group as narration — still bold, never literal markup.
    expect(screen.getByText('第三段')).toBeTruthy()
    // Scope to the LIVE row: the history turn renders its own process group
    // with the same collapsed head shape.
    const liveRow = [...document.querySelectorAll('.chat-msg-assistant')]
      .filter(el => el.textContent?.includes('第三段')).pop() as HTMLElement
    expect(liveRow.querySelector('.chat-flow-text[data-part-id="answer"]')?.getAttribute('data-step-seq')).toBe('8')
    expect(screen.queryByText('加粗')).toBeNull()
    const groupHead = liveRow.querySelector('.chat-proc-head') as HTMLButtonElement
    expect(groupHead.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(groupHead)
    const bolds = await screen.findAllByText('加粗')
    expect(bolds.length).toBeGreaterThan(0)
    expect(bolds[0]!.tagName).toBe('STRONG')
    expect(screen.queryByText('**加粗**')).toBeNull()
  })
})

describe('ChatView voice cleanup', () => {
  it('releases the mic when the chat unmounts during mic authorization', async () => {
    const trackStop = vi.fn()
    const cancel = vi.fn(() => { trackStop() })
    let resolveRecorder: ((recorder: VoiceRecording) => void) | undefined
    startVoiceRecordingMock.mockReturnValue(new Promise(resolve => { resolveRecorder = resolve }))
    voiceSupportedMock.mockReturnValue(true)
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    const { unmount } = render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    // Open the mic; getUserMedia is still authorizing (the promise is pending).
    fireEvent.click(await screen.findByRole('button', { name: '语音输入' }))
    // The user leaves the chat before authorization resolves.
    unmount()
    // Authorization resolves after unmount: the recorder must be cancelled so
    // the MediaStream tracks are stopped (no mic leak, no stuck indicator).
    await act(async () => { resolveRecorder!({ stop: vi.fn(), cancel, snapshot: () => undefined }) })
    expect(cancel).toHaveBeenCalled()
    expect(trackStop).toHaveBeenCalled()
  })
})

describe('ChatView queued echo', () => {
  it('hands a queued message back to the composer when a host restart swallowed it', async () => {
    // 队列只活在宿主内存里：重启后这条既不在 inbox、也没进对话，必须还给用户，
    // 不能让「已排队」变成字消失了。
    localStorage.setItem('dsh.palm.queuedEcho', JSON.stringify([
      { sessionId: 's-1', text: '重启前排队的那句话', at: Date.now() - 60_000 },
    ]))
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    const input = await screen.findByPlaceholderText('说点什么...') as HTMLTextAreaElement
    await waitFor(() => {
      expect(input.value).toBe('重启前排队的那句话')
    })
    // 还过一次就销账，下次打开不会重复塞进输入框。
    expect(localStorage.getItem('dsh.palm.queuedEcho')).toBe('[]')
  })
})

describe('ChatView queued echo while a turn runs', () => {
  it('never hands a queued message back while the host may still be claiming it', async () => {
    // 真实故障：队列把消息认领成下一轮的那几秒，手机端看到「队列空了、对话里还没有」，
    // 就当成丢失把原文塞回输入框 —— 而消息其实已经发出去了。回合在跑时一律不判丢失。
    // 排队后一直没在手机上看到卡片（旧前端/轮询没命中）也一样：只要回合在跑，
    // 就不能拿「很久没见」当丢失证据。
    localStorage.setItem('dsh.palm.queuedEcho', JSON.stringify([
      { sessionId: 's-1', text: '其实已经发出去的那句话', at: Date.now() - 300_000 },
    ]))
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={{ ...session, running: true }} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    const input = await screen.findByPlaceholderText('说点什么...') as HTMLTextAreaElement
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(input.value).toBe('')
    // 底稿也不能丢：真正丢消息时还要靠它回填。
    expect(localStorage.getItem('dsh.palm.queuedEcho') ?? '').toContain('其实已经发出去的那句话')
    localStorage.clear()
  })
})

it('shows live captions while the user is still talking', async () => {
  // 边录边看字：宿主没有流式 ASR，靠滚动重转；松手后的最终转写仍然说了算。
  startVoiceRecordingMock.mockResolvedValue({
    stop: vi.fn(),
    cancel: vi.fn(),
    snapshot: () => 'wav-so-far',
  })
  voiceSupportedMock.mockReturnValue(true)
  loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
  render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
  fireEvent.click(await screen.findByRole('button', { name: '语音输入' }))
  await waitFor(() => {
    expect(document.querySelector('.voice-text-live')?.textContent).toBe('转写出来的文本')
  }, { timeout: 6000 })
  // 字幕用的是「已录到的音频」快照，不是最终 WAV。
  expect(vi.mocked(transcribeVoice)).toHaveBeenCalledWith('wav-so-far', expect.anything())
})

describe('ChatView voice sheet', () => {
  it('offers 取消 and releases the mic without filling the composer', async () => {
    // 以前面板只能点背景退出：用户按「取消」找不到，按「完成」又会被塞一段转写。
    const cancel = vi.fn()
    const stop = vi.fn()
    startVoiceRecordingMock.mockResolvedValue({ stop, cancel, snapshot: () => undefined })
    voiceSupportedMock.mockReturnValue(true)
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    fireEvent.click(await screen.findByRole('button', { name: '语音输入' }))
    const cancelButton = await screen.findByRole('button', { name: '取消' })
    fireEvent.click(cancelButton)
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '语音输入' })).toBeNull()
    })
    expect(cancel).toHaveBeenCalled()
    // 取消是丢弃，不是完成：不能去转写，也不能把录音停下来当成提交。
    expect(stop).not.toHaveBeenCalled()
    expect((screen.getByPlaceholderText('说点什么...') as HTMLTextAreaElement).value).toBe('')
  })

  it('closes the voice sheet on Escape and hands the focus back', async () => {
    // 面板只能点背景关掉，而背景正是手指最容易误触的位置；外接键盘/读屏用户没有
    // Esc 就等于没有出口。焦点也要进来（否则 Tab 落在背后的页面上）再还回去。
    const cancel = vi.fn()
    startVoiceRecordingMock.mockResolvedValue({ stop: vi.fn(), cancel, snapshot: () => undefined })
    voiceSupportedMock.mockReturnValue(true)
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    const trigger = await screen.findByRole('button', { name: '语音输入' })
    trigger.focus()
    fireEvent.click(trigger)
    const sheet = await screen.findByRole('dialog', { name: '语音输入' })
    // 焦点必须先落到面板里的「完成」上。
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe('完成')
    })
    fireEvent.keyDown(sheet, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '语音输入' })).toBeNull()
    })
    expect(cancel).toHaveBeenCalled()
    // 焦点回到打开它的那颗按钮上，继续按空格还是「语音输入」。
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger)
    })
  })

  it('drops a transcript that comes back after the sheet was closed', async () => {
    // 关掉面板时正在转写：结果回来不能偷偷塞进输入框。
    const cancel = vi.fn()
    let resolveStop: ((value: string) => void) | undefined
    startVoiceRecordingMock.mockResolvedValue({
      stop: () => new Promise<string>(resolve => { resolveStop = resolve }),
      cancel,
      snapshot: () => undefined,
    })
    voiceSupportedMock.mockReturnValue(true)
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    fireEvent.click(await screen.findByRole('button', { name: '语音输入' }))
    fireEvent.click(await screen.findByRole('button', { name: '完成' }))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: '语音输入' })).not.toBeNull() })
    // 面板仍开着（转写中），用户等不及按了取消。
    fireEvent.click(await screen.findByRole('button', { name: '取消' }))
    await act(async () => { resolveStop!('BWFTR0JTRTQ=') })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '语音输入' })).toBeNull()
    })
    expect((screen.getByPlaceholderText('说点什么...') as HTMLTextAreaElement).value).toBe('')
  })
})

describe('ChatView delete session', () => {
  it('archives the session on the host, clears the outbox, and returns to the list', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    removeOutboxForSessionMock.mockResolvedValue(undefined)
    const onBack = vi.fn()
    render(<ChatView session={session} onBack={onBack} showToolCalls={true} showSystemMessages={false} />)
    // Open the 更多 menu and pick 删除会话.
    fireEvent.click(await screen.findByRole('button', { name: '更多' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /删除会话/ }))
    // Confirm the destructive action.
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    await waitFor(() => {
      expect(removeOutboxForSessionMock).toHaveBeenCalledWith('s-1')
      // The delete is REAL (host archive write): the session cannot
      // resurrect on the next roster fetch.
      expect(archiveSessionApiMock).toHaveBeenCalledWith('s-1')
      expect(onBack).toHaveBeenCalled()
    })
  })
})

describe('ChatView composer IME guard', () => {
  it('does not send on Enter while a Chinese IME is composing', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    const input = await screen.findByPlaceholderText('说点什么...')
    fireEvent.change(input, { target: { value: '你好' } })
    // IME composition Enter (isComposing true) must not fire a send.
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false, isComposing: true })
    expect(promptMock).not.toHaveBeenCalled()
    // A normal Enter sends.
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false, isComposing: false })
    await waitFor(() => { expect(promptMock).toHaveBeenCalled() })
  })
})

describe('ChatView send failure', () => {
  it('keeps the draft on a failed send and surfaces the error line', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    const input = await screen.findByPlaceholderText('说点什么...') as HTMLInputElement
    fireEvent.change(input, { target: { value: '这条没发出去' } })
    // The host rejects the prompt.
    vi.mocked(promptMock).mockRejectedValueOnce(new Error('HTTP 403'))
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false, isComposing: false })
    // The draft survives so the user can retry (the draft is only wiped on
    // success), and the chat error line explains why the send failed.
    await waitFor(() => {
      expect((screen.getByPlaceholderText('说点什么...') as HTMLInputElement).value).toBe('这条没发出去')
      expect(screen.getByText(/HTTP 403/)).toBeTruthy()
    })
  })
})

describe('ChatView offline banner', () => {
  it('ignores a lying navigator.onLine: the banner only follows real requests', async () => {
    // 真机故障：安卓上 navigator.onLine 会一直停在 false，横幅就永远挂着、
    // 消息永远进离线队列，而网络其实早就好了。所以启动时不采信它。
    const onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    expect(screen.queryByText('网络已断开，消息将在恢复后发送')).toBeNull()
    onLine.mockRestore()
  })

  it('shows the offline banner on the browser hint and clears it when the host answers', async () => {
    // 断线提示立刻给横幅（fail-safe），但恢复不能只等 online 事件：
    // 宿主一旦答话（这里用一帧实时事件代表）就立刻撤掉。
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    act(() => { window.dispatchEvent(new Event('offline')) })
    expect(await screen.findByText('网络已断开，消息将在恢复后发送')).toBeTruthy()
    act(() => {
      mux.emit({
        type: 'event',
        event: { type: 'todo/write', seq: 9_000, time: Date.now(), data: { items: [] } },
      } as never)
    })
    await waitFor(() => { expect(screen.queryByText('网络已断开，消息将在恢复后发送')).toBeNull() })

  })
  it('queues a prompt while the host is unreachable and sends it once the host answers', async () => {
    // 真机承诺的是「网络恢复后自动发送」：横幅挂着时进队列，宿主一答话就自动发出去。
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    const mux = new FakeMux()
    vi.mocked(listOutbox).mockResolvedValue([])
    const enqueueMock = vi.mocked(await import('../offline.ts')).enqueuePrompt
    const flushMock = vi.mocked(await import('../offline.ts')).flushOutbox
    flushMock.mockClear()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    act(() => { window.dispatchEvent(new Event('offline')) })
    await screen.findByText('网络已断开，消息将在恢复后发送')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '断网时写的话' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => { expect(enqueueMock).toHaveBeenCalledWith(expect.objectContaining({ text: '断网时写的话' })) })
    expect(prompt).not.toHaveBeenCalled()
    // 宿主答话（一帧实时事件）：横幅撤掉，队列自动排空。
    vi.mocked(listOutbox).mockResolvedValue([{ id: 'o9', sessionId: 's-1', text: '断网时写的话', queuedAt: 1 }])
    act(() => {
      mux.emit({
        type: 'event',
        event: { type: 'todo/write', seq: 9_100, time: Date.now(), data: { items: [] } },
      } as never)
    })
    await waitFor(() => { expect(flushMock).toHaveBeenCalled() })
  })
  it('removes an individual queued entry from the banner', async () => {
    listOutboxMock.mockResolvedValue([{ id: 'o1', sessionId: 's-1', text: '离线消息', queuedAt: 1 }])
    removeFromOutboxMock.mockResolvedValue(undefined)
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    // The banner lists the queued entry.
    expect(await screen.findByText('离线消息')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '移除待发送消息' }))
    await waitFor(() => { expect(removeFromOutboxMock).toHaveBeenCalledWith('o1') })
  })
})

describe('ChatView pending-message queue dock', () => {
  it('renders the queue from a session/queue snapshot and mutates it', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    // No queue yet: no dock.
    expect(screen.queryByText('排队消息')).toBeNull()
    // A queue snapshot arrives → the dock shows the queued message.
    act(() => {
      mux.emit({
        type: 'session/queue',
        sessionId: 's-1',
        items: [{ id: 'q1', placement: 'queued', message: { id: 'm1', role: 'user', content: [{ type: 'text', text: '排队消息' }], source: { kind: 'user' } } }],
      })
    })
    expect(await screen.findByText('排队消息')).toBeTruthy()
    // 删除必须同时清掉本地底稿：留下的底稿会在 20 秒后被对账当成「没送达」放回输入框，
    // 用户会看到自己刚删掉的排队消息自己复活。
    rememberQueuedEcho({ sessionId: 's-1', text: '排队消息', at: Date.now() })
    expect(readQueuedEchoes().some(echo => echo.text === '排队消息')).toBe(true)
    // Remove calls updateQueue.
    fireEvent.click(screen.getByRole('button', { name: '删除排队消息' }))
    await waitFor(() => { expect(updateQueueMock).toHaveBeenCalledWith('s-1', 'q1', { kind: 'remove' }) })
    await waitFor(() => { expect(readQueuedEchoes().some(echo => echo.text === '排队消息')).toBe(false) })
  })

  it('follows an edit: the echo carries the new text, not the old one', async () => {
    // 编辑后底稿还留着旧文本，认领时对账会把旧文本当「没送达」放回输入框 —— 用户看到
    // 自己改过的排队消息又变回原样，还会重复发送。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    act(() => {
      mux.emit({
        type: 'session/queue',
        sessionId: 's-1',
        items: [{ id: 'q2', placement: 'queued', message: { id: 'm2', role: 'user', content: [{ type: 'text', text: '排队原文' }], source: { kind: 'user' } } }],
      })
    })
    expect(await screen.findByText('排队原文')).toBeTruthy()
    rememberQueuedEcho({ sessionId: 's-1', text: '排队原文', at: Date.now() })
    fireEvent.click(screen.getByRole('button', { name: '编辑排队消息' }))
    const editor = document.querySelector('.queue-dockInput') as HTMLInputElement
    fireEvent.change(editor, { target: { value: '改后文本' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(updateQueueMock).toHaveBeenCalledWith('s-1', 'q2', { kind: 'edit', content: [{ type: 'text', text: '改后文本' }] })
    })
    await waitFor(() => {
      const texts = readQueuedEchoes().map(echo => echo.text)
      expect(texts).toContain('改后文本')
      expect(texts).not.toContain('排队原文')
    })
  })

  it('asks the host for the queue on open and draws what it returns', async () => {
    // 投影帧到不了手机（实测排队后 6 秒 0 帧），所以打开会话时必须主动问一次快照，
    // 否则上次排进来的消息在这台手机上永远看不到。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const inboxMock = vi.mocked(await import('../api.ts')).inboxOf
    inboxMock.mockResolvedValueOnce({ inbox: { 'next-turn': [{ id: 'q1', role: 'user', content: [{ type: 'text', text: '打开时就该看见' }], source: { kind: 'user' } }] } })
    render(<ChatView session={session} mux={new FakeMux() as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    expect(await screen.findByText('打开时就该看见')).toBeTruthy()
  })

  it('shows queued messages from the host inbox projection'
  , async () => {
    // 宿主只发投影帧（inbox），从不发 session/queue：手机端如果只等后者，
    // 排队卡片就永远不出现（实测：排队后 6 秒内 0 帧、无卡片）。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    act(() => {
      mux.emit({
        type: 'session/projection',
        sessionId: 's-1',
        key: 'inbox',
        value: { 'next-turn': [{ id: 'q1', role: 'user', content: [{ type: 'text', text: '投影里的排队' }], source: { kind: 'user' } }], 'next-step': [] },
      })
    })
    expect(await screen.findByText('投影里的排队')).toBeTruthy()
    // 宿主的 next-step（插话）不是"排队等下一轮"，不进这张卡片。
    act(() => {
      mux.emit({
        type: 'session/projection',
        sessionId: 's-1',
        key: 'inbox',
        value: { 'next-turn': [], 'next-step': [{ id: 'q2', role: 'user', content: [{ type: 'text', text: '插话里的' }], source: { kind: 'user' } }] },
      })
    })
    await waitFor(() => { expect(screen.queryByText('投影里的排队')).toBeNull() })
  })

  it('asks the host for the queue right after a turn starts, instead of waiting for the next poll', async () => {
    // 真机：桌面端排队消息还在，手机端整条没了。本地的 turn/start 处理把队列清空
    // （队首被认领），而认领只拿走一条；剩下的要等下一次轮询才回来，空闲时是 20 秒。
    // 清空之后必须立刻问一次宿主真值，这条钉住那次 fresh 对账。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    const inboxMock = vi.mocked(await import('../api.ts')).inboxOf
    inboxMock.mockResolvedValue({ inbox: { 'next-turn': [] } })
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    const before = inboxMock.mock.calls.filter(([, options]) => options?.fresh === true).length
    act(() => { emitSessionEvent(mux, 'turn/start', 1) })
    await vi.waitFor(() => {
      const fresh = inboxMock.mock.calls.filter(([, options]) => options?.fresh === true).length
      expect(fresh).toBeGreaterThan(before)
    })
  })
  it('keeps a steered row visible while the host still lists it as queued', async () => {
    // 真机：点了「立即发送」之后手机端整条消失，桌面端还挂着。宿主把这条在队列帧里
    // 标成 steering，而排队条只渲染 queued —— 可它的 next-turn 投影里还有它（桌面端
    // 读的就是那份）。手机端不该比桌面端更早地把它藏起来。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    const { container } = render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    act(() => {
      mux.emit({
        type: 'session/queue',
        sessionId: 's-1',
        items: [{ id: 'q1', placement: 'steering', message: { id: 'm1', role: 'user', content: [{ type: 'text', text: '插队的那条' }], source: { kind: 'user' } } }],
      })
    })
    await screen.findByText('插队的那条')
    expect(container.querySelector('[data-queue-dock]')).not.toBeNull()
  })
  it('floats the queue dock above the model and permission row', async () => {
    // 桌面端把队列挂在输入框外、模型/权限那一行上面；手机端曾经塞在 .chat-composer
    // 里，视觉上成了输入框的一部分。DOM 顺序就是视觉顺序，这里直接钉住。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    const { container } = render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    act(() => {
      mux.emit({
        type: 'session/queue',
        sessionId: 's-1',
        items: [{ id: 'q1', placement: 'queued', message: { id: 'm1', role: 'user', content: [{ type: 'text', text: '排队消息' }], source: { kind: 'user' } } }],
      })
    })
    await screen.findByText('排队消息')
    const dock = container.querySelector('[data-queue-dock]')
    const tools = container.querySelector('.chat-tools')
    expect(dock).not.toBeNull()
    expect(tools).not.toBeNull()
    expect(dock !== null && tools !== null && (dock.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true)
  })

  it('HUD 顺序：目标在最上，排队居中，模型行在下（阶段 3 起固定）', async () => {
    // 顺序改由 `SessionHud` 统一决定：为什么在跑（目标）→ 接下来发什么（排队）→
    // 跑到哪了（任务）。三条都在模型/权限行之上，DOM 顺序就是视觉顺序。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    const { container } = render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    act(() => {
      mux.emit({
        type: 'session/projection',
        sessionId: 's-1',
        key: 'goal',
        value: { current: { id: 'g-1', objective: '手机端目标条', phase: 'active', revision: 1 } },
      })
    })
    await screen.findByText('进行中的目标')
    act(() => {
      mux.emit({
        type: 'session/queue',
        sessionId: 's-1',
        items: [{ id: 'q1', placement: 'queued', message: { id: 'm1', role: 'user', content: [{ type: 'text', text: '排队消息' }], source: { kind: 'user' } } }],
      })
    })
    await screen.findByText('排队消息')
    const dock = container.querySelector('[data-queue-dock]')
    const bar = container.querySelector('[data-goal-bar]')
    const tools = container.querySelector('.chat-tools')
    expect(dock).not.toBeNull()
    expect(bar).not.toBeNull()
    expect(tools).not.toBeNull()
    // 目标在上、排队居中（阶段 3 起由 SessionHud 固定这个顺序）。
    expect(dock !== null && bar !== null && (bar.compareDocumentPosition(dock) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true)
    expect(bar !== null && tools !== null && (bar.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true)
  })

  it('hides the goal bar the moment the goal completes', async () => {
    // 「目标结束再清掉」：宿主把相位改成 complete 就该整条消失，不用等下一帧队列。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    act(() => {
      mux.emit({ type: 'session/projection', sessionId: 's-1', key: 'goal', value: { current: { id: 'g-1', objective: '做完了', phase: 'active' } } })
    })
    await screen.findByText('进行中的目标')
    act(() => {
      mux.emit({ type: 'session/projection', sessionId: 's-1', key: 'goal', value: { current: { id: 'g-1', objective: '做完了', phase: 'complete' } } })
    })
    // 整条 DOM 必须消失：只断言文案会漏掉「相位变了但条子还在」那种情况。
    await waitFor(() => { expect(document.querySelector('[data-goal-bar]')).toBeNull() })
  })

  it('seeds the goal bar from the host on open (cold start has no frame)', async () => {
    // 冷启动没有任何目标帧：只等帧的话，手机上已经存在的目标要等下一次变更才出现。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const goalMock = vi.mocked(await import('../api.ts')).goalOf
    goalMock.mockResolvedValueOnce({ goal: { current: { id: 'g-9', objective: '冷启动就该看见', phase: 'active' } } })
    render(<ChatView session={session} mux={new FakeMux() as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    expect(await screen.findByText('冷启动就该看见')).toBeTruthy()
  })

  it('picks a goal created inside the session up while idle (no turn, no frame)', async () => {
    // 真机 2026-10-22：会话里 `/goal 做个测试`，宿主回了 Goal created，手机上却没有目标条。
    // 命令不产生回合；现在目标随原子快照回来（空闲 8 秒一次对账），不再自己轮询。
    //
    // 注意：假时钟下 **不能** 用 findBy*/waitFor（它们靠真实定时器等），否则永远等不到。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const api = await import('../api.ts')
    vi.mocked(api.goalOf).mockResolvedValue({ goal: null })
    vi.useFakeTimers()
    try {
      render(<ChatView session={session} mux={new FakeMux() as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
      await act(async () => { await Promise.resolve() })
      // 快照随后把新建的目标带回来（同一份往返里还带着行/队列/回合）。
      vi.mocked(api.sessionState).mockResolvedValue({
        sessionId: 's-1',
        rows: [],
        maxSeq: 1,
        queue: [],
        queueRevision: 0,
        turn: { running: false },
        goal: { current: { id: 'g-new', objective: '做个测试', phase: 'active' } },
        goalActivation: 'armed',
        asOf: Date.now(),
      })
      await act(async () => { await vi.advanceTimersByTimeAsync(9_000) })
      await act(async () => { await Promise.resolve() })
      expect(screen.getByText('做个测试')).toBeTruthy()
    } finally {
      vi.useRealTimers()
      resetSessionStateMock()
    }
  })

  it('asks for the goal right after a send, so a new goal bar shows up at once', async () => {
    // `/goal …` 是命令：不进 queue，也不开回合。发完不问一次，条子要等下一轮轮询。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const api = await import('../api.ts')
    vi.mocked(api.goalOf).mockResolvedValue({ goal: null })
    render(<ChatView session={session} mux={new FakeMux() as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    const input = await screen.findByPlaceholderText('说点什么...') as HTMLTextAreaElement
    const before = vi.mocked(api.goalOf).mock.calls.length
    fireEvent.change(input, { target: { value: '/goal 做个测试' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => { expect(vi.mocked(api.goalOf).mock.calls.length).toBeGreaterThan(before) })
  })

  it('mounts a dedicated any-file input for 文件 and image-only pickers elsewhere', async () => {
    // 真机上的病根：点「文件」弹出的还是相册。现在文件那一项是 label 直连一个静态
    // input——它从挂载起就没有 accept，浏览器没有"上一次的配置"可沿用，也不需要
    // 程序化 click()。图片和拍照仍走现造的节点，带图片类型（拍照另外带 capture）。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    render(<ChatView session={session} mux={new FakeMux() as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByPlaceholderText('说点什么...')
    fireEvent.click(screen.getByRole('button', { name: '添加内容' }))
    const fileItem = await screen.findByRole('menuitem', { name: /^文件/ })
    const fileInput = fileItem.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).not.toBeNull()
    expect(fileInput.hasAttribute('accept')).toBe(false)
    expect(fileInput.multiple).toBe(true)
    expect(fileInput.classList.contains('chat-picker-input')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '添加内容' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /拍照/ }))
    const cameraNode = document.querySelector('input.chat-picker-input') as HTMLInputElement
    expect(cameraNode.getAttribute('accept')).toBe('image/*')
    expect(cameraNode.getAttribute('capture')).toBe('environment')
    expect(cameraNode.multiple).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '添加内容' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /图片/ }))
    const imageNode = document.querySelector('input.chat-picker-input') as HTMLInputElement
    expect(imageNode.getAttribute('accept')).toBe('image/*')
    expect(imageNode.hasAttribute('capture')).toBe(false)
    expect(imageNode.multiple).toBe(true)
    expect(cameraNode).not.toBe(imageNode)
  })

  it('路径里有空格时用引号包起来，别让 agent 读到半截路径', async () => {
    // 真机症状：点了宿主机上的 `D:\my project\a.ts`，输入框里是 `@D:\my project\a.ts`，
    // agent 按空白切词只拿到 `@D:\my`，去读一个不存在的文件。
    expect(quotePathForReference('D:\\work\\a.ts')).toBe('D:\\work\\a.ts')
    expect(quotePathForReference('D:\\my project\\a.ts')).toBe('"D:\\my project\\a.ts"')
    expect(quotePathForReference("D:\\a b\\c d.md")).toBe('"D:\\a b\\c d.md"')
  })

  it('inserts a host path from the 电脑文件 browser when the phone cannot pick files', async () => {
    // 真机上系统选择器只给相机/相册时，这条是唯一能挑到文档的路：从宿主的目录列表里
    // 点一个文件，把 `@路径` 写进输入框（这套系统里 @ 前缀就是文件引用）。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const api = await import('../api.ts')
    const listDirectoryMock = vi.mocked(api.listDirectory)
    // 按路径分派，不依赖调用次数（挂载几次都拿到同一份结果）。
    listDirectoryMock.mockImplementation(async (calledPath?: string) => {
      if (calledPath === 'D:\\work\\sub') {
        return {
          path: 'D:\\work\\sub',
          home: 'C:\\Users\\me',
          crumbs: [{ name: 'D:\\', path: 'D:\\', hidden: false }, { name: 'work', path: 'D:\\work', hidden: false }, { name: 'sub', path: 'D:\\work\\sub', hidden: false }],
          entries: [],
          truncated: false,
        }
      }
      return {
        path: 'D:\\work',
        home: 'C:\\Users\\me',
        crumbs: [{ name: 'D:\\', path: 'D:\\', hidden: false }, { name: 'work', path: 'D:\\work', hidden: false }],
        entries: [
          { name: 'sub', path: 'D:\\work\\sub', hidden: false, kind: 'dir' },
          { name: '报告.pdf', path: 'D:\\work\\报告.pdf', hidden: false, kind: 'file', bytes: 2048 },
        ],
        truncated: false,
      }
    })
    render(<ChatView session={session} mux={new FakeMux() as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByPlaceholderText('说点什么...')
    fireEvent.click(screen.getByRole('button', { name: '添加内容' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /电脑文件/ }))
    // 目录与文件都列出来，文件带字节数。
    await screen.findByText('sub')
    expect(await screen.findByText('报告.pdf')).toBeTruthy()
    expect(screen.getByText('2 KB')).toBeTruthy()
    // 点目录是进入下一层；点文件是引用它。
    fireEvent.click(screen.getByText('sub'))
    await waitFor(() => { expect(listDirectoryMock).toHaveBeenLastCalledWith('D:\\work\\sub', { files: true }) })
    await screen.findByText('这个目录是空的')
    fireEvent.click(screen.getByRole('button', { name: '上一级' }))
    await screen.findByText('报告.pdf')
    fireEvent.click(screen.getByText('报告.pdf'))
    await waitFor(() => {
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('@D:\\work\\报告.pdf ')
    })
  })

  it('stages a picked file through the host and sends it as a receipt part', async () => {
    // 「+」→「文件」：文件不是内联进 prompt 的，先交给宿主附件服务落盘拿 receipt，
    // 线上只传 { type: 'file', receiptId }。这条盯的是整条链路不断。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const api = await import('../api.ts')
    const { container } = render(
      <>
        <ChatView session={session} mux={new FakeMux() as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />
        <ToastHost />
      </>,
    )
    await screen.findByPlaceholderText('说点什么...')
    fireEvent.click(screen.getByRole('button', { name: '添加内容' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /^文件/ }))
    const menuItem = await screen.findByRole('menuitem', { name: /^文件/ })
    const picker = menuItem.querySelector('input[type="file"]') as HTMLInputElement
    expect(picker).not.toBeNull()
    const file = new File(['hello'], 'notes.pdf', { type: 'application/pdf' })
    // 把上传卡在"未回包"：真机上这一步要几十秒，chip 必须在这期间就看得见。
    const pending: { settle?: (value: { receiptId: string; name: string; bytes: number }) => void } = {}
    vi.mocked(api.uploadAttachment).mockImplementationOnce(() => new Promise((resolve) => {
      pending.settle = resolve
    }) as never)
    fireEvent.change(picker, { target: { files: [file] } })
    // 真机反馈的现场：chip 必须**当场**出现并显示"上传中…"，而不是等回包才出现
    // （以前发送框一片空白，看着像附件没加进去）。
    await screen.findByText('notes.pdf')
    expect(screen.getByText('上传中…')).toBeTruthy()
    // 字节是在 chip 挂出来之后才读、才传的：等它到宿主。
    await waitFor(() => { expect(vi.mocked(api.uploadAttachment)).toHaveBeenCalledTimes(1) })
    const [calledSession, calledFile] = vi.mocked(api.uploadAttachment).mock.calls[0] ?? []
    expect(calledSession).toBe('s-1')
    expect(calledFile?.name).toBe('notes.pdf')
    // 上传中不允许发（否则静默少一个文件）。
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await screen.findByText('附件还在上传，稍等一下')
    expect(promptMock).not.toHaveBeenCalled()
    // 回包之后 chip 从"上传中…"转成大小；这时候才允许发。
    await act(async () => { pending.settle?.({ receiptId: 'receipt-notes.pdf', name: 'notes.pdf', bytes: 12 }) })
    await screen.findByText('12 B')
    expect(screen.queryByText('上传中…')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => { expect(promptMock).toHaveBeenCalled() })
    const parts = promptMock.mock.calls[0]?.[1] as Array<{ type: string; receiptId?: string }>
    expect(parts.some(part => part.type === 'file' && part.receiptId === 'receipt-notes.pdf')).toBe(true)
  })

  it('上传失败的附件留在发送框里，点一下就重传', async () => {
    // 以前失败是直接消失：发送框里什么都看不到，用户以为"附件没加进去"。
    // 现在保留那一条、标红、可点重传；发送时被挡下（不会静默少一个文件）。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const api = await import('../api.ts')
    vi.mocked(api.uploadAttachment).mockRejectedValueOnce(new Error('nope'))
    render(
      <>
        <ChatView session={session} mux={new FakeMux() as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />
        <ToastHost />
      </>,
    )
    await screen.findByPlaceholderText('说点什么...')
    fireEvent.click(screen.getByRole('button', { name: '添加内容' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /^文件/ }))
    const picker = (await screen.findByRole('menuitem', { name: /^文件/ })).querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(picker, { target: { files: [new File(['x'], 'bad.bin')] } })
    // 名字还在，状态是"上传失败，点按重试"。
    await screen.findByText('bad.bin')
    const retry = await screen.findByRole('button', { name: '重新上传 bad.bin' })
    expect(screen.getByRole('list', { name: '待发送附件' })).toBeTruthy()
    // 带着失败的那条发不出去。
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await screen.findByText('有附件上传失败，点一下那条重试或移除')
    expect(promptMock).not.toHaveBeenCalled()
    // 点重试 → 第二次成功 → 变成 ready（显示大小），可以正常发出收据。
    fireEvent.click(retry)
    await waitFor(() => { expect(screen.getByText('12 B')).toBeTruthy() })
    expect(vi.mocked(api.uploadAttachment)).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => { expect(promptMock).toHaveBeenCalled() })
    const parts = promptMock.mock.calls[0]?.[1] as Array<{ type: string; receiptId?: string }>
    expect(parts.some(part => part.type === 'file' && part.receiptId === 'receipt-bad.bin')).toBe(true)
  })

  it('refuses a file over 20 MB without asking the host', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const api = await import('../api.ts')
    const { container } = render(
      <>
        <ChatView session={session} mux={new FakeMux() as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />
        <ToastHost />
      </>,
    )
    await screen.findByPlaceholderText('说点什么...')
    fireEvent.click(screen.getByRole('button', { name: '添加内容' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /^文件/ }))
    const picker = (await screen.findByRole('menuitem', { name: /^文件/ })).querySelector('input[type="file"]') as HTMLInputElement
    const huge = new File(['x'], 'huge.zip')
    Object.defineProperty(huge, 'size', { value: 21 * 1024 * 1024 })
    fireEvent.change(picker, { target: { files: [huge] } })
    await screen.findByText('huge.zip 超过 20 MB，已忽略')
    expect(vi.mocked(api.uploadAttachment)).not.toHaveBeenCalled()
  })

  it('clears the goal through the host service, not a slash command', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    act(() => {
      mux.emit({ type: 'session/projection', sessionId: 's-1', key: 'goal', value: { current: { id: 'g-1', objective: '要清掉的目标', phase: 'active' } } })
    })
    await screen.findByText('进行中的目标')
    fireEvent.click(screen.getByLabelText('清除目标'))
    const api = await import('../api.ts')
    await waitFor(() => { expect(vi.mocked(api.goalAction)).toHaveBeenCalledWith('s-1', 'clear', {}) })
    // 走了服务就不该再发命令行动作（两条都发会把同一件事做两遍）。
    expect(vi.mocked(sendCommandMock)).not.toHaveBeenCalledWith('s-1', '/goal clear')
  })

  it('shows 继续 for a disarmed goal and re-arms it through the host service', async () => {
    // 桌面端那条 ⏸ 只撤授权，durable 相位仍是 active。只读相位的话手机还写着
    // 「暂停」——用户报的就是这个。插件把 activation 一起带下来，条子按桌面端
    // 的规则换成「继续」，按下即重新授权。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    const api = await import('../api.ts')
    vi.mocked(api.goalOf).mockResolvedValue({
      goal: { current: { id: 'g-1', objective: '暂停中的目标', phase: 'active', revision: 3 } },
      activation: 'disarmed',
    })
    vi.mocked(api.goalAction).mockResolvedValue({
      goal: { current: { id: 'g-1', objective: '暂停中的目标', phase: 'active', revision: 4 } },
      activation: 'armed',
    })
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('暂停中的目标')
    // 撤授权时不该出现「暂停」（再点一次没有语义），出现的是「继续」。
    expect(screen.queryByRole('button', { name: '暂停' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    await waitFor(() => { expect(vi.mocked(api.goalAction)).toHaveBeenCalledWith('s-1', 'resume', {}) })
    // 恢复之后条子回到「暂停」（授权回来了）。
    await screen.findByRole('button', { name: '暂停' })
  })

  it('falls back to the /goal command when the host has no goal service', async () => {
    // 老宿主没有 mobile.goalAction：动作仍要生效，只是语义精度退化到命令行那条路。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    const api = await import('../api.ts')
    vi.mocked(api.goalAction).mockRejectedValue(new Error('unknown method'))
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    act(() => {
      mux.emit({ type: 'session/projection', sessionId: 's-1', key: 'goal', value: { current: { id: 'g-1', objective: '老宿主上的目标', phase: 'active', revision: 1 } } })
    })
    await screen.findByText('进行中的目标')
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    await waitFor(() => { expect(vi.mocked(sendCommandMock)).toHaveBeenCalledWith('s-1', '/goal pause') })
  })

  it('flips the bar to 继续 the moment the desktop pauses (activation frame)', async () => {
    // 桌面端点暂停只撤授权，durable 相位不变 → 没有 goal 投影帧。少了这一帧，
    // 手机要等到重开会话才发现自己该显示「继续」。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    act(() => {
      mux.emit({ type: 'session/projection', sessionId: 's-1', key: 'goal', value: { current: { id: 'g-1', objective: '桌面刚暂停的目标', phase: 'active', revision: 2 } } })
    })
    await screen.findByText('进行中的目标')
    expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy()
    act(() => {
      mux.emit({ type: 'goal/activation', sessionId: 's-1', activation: 'disarmed' })
    })
    await screen.findByText('已暂停的目标')
    expect(screen.getByRole('button', { name: '继续' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '暂停' })).toBeNull()
  })

  it('fills the composer with a picked command instead of running it', async () => {
    // 桌面端从命令菜单选 `/goal` 是把它填进输入框（蓝色 chip + 光标在参数区），
    // 由用户补目标内容再发；手机端原来选中即执行，带参命令连参数都填不了。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    fireEvent.click(screen.getByRole('button', { name: '斜杠命令' }))
    fireEvent.click(await screen.findByRole('menuitem'))
    // chip 出现、命令行**没有**被立刻发出去
    expect(await screen.findByText('/goal')).toBeTruthy()
    expect(vi.mocked(sendCommandMock)).not.toHaveBeenCalled()
    // 参数在输入框里，回车即发：线上仍是一整行命令行
    const box = screen.getByPlaceholderText('输入命令参数，回车执行')
    fireEvent.change(box, { target: { value: '把手机端命令模块对齐桌面' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => {
      expect(vi.mocked(sendCommandMock)).toHaveBeenCalledWith('s-1', '/goal 把手机端命令模块对齐桌面')
    })
  })

  it('claims a command the user typed by hand once the directory arrives', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    fireEvent.change(screen.getByPlaceholderText('说点什么...'), { target: { value: '/goal 手敲的目标' } })
    // 目录是异步拉回来的：回来后命令词收成 chip，参数留在输入框。
    expect(await screen.findByText('/goal')).toBeTruthy()
    expect((screen.getByPlaceholderText('输入命令参数，回车执行') as HTMLTextAreaElement).value).toBe('手敲的目标')
    // chip 撤掉 = 取消这条命令：chip 与参数一起清空，输入框回到普通状态，
    // 不能把 `/goal` 又拼回框里（点了 × 却看见命令还在，等于没生效）。
    fireEvent.click(screen.getByRole('button', { name: '取消命令' }))
    await waitFor(() => {
      expect(screen.queryByText('/goal')).toBeNull()
    })
    const cleared = screen.getByPlaceholderText('说点什么...') as HTMLTextAreaElement
    expect(cleared.value).toBe('')
  })

  it('画出一条刚发出的排队消息，即使宿主快照还没带上它', async () => {
    // 真机 bug：回合跑着时点发送，排队条还是空的。原因是两处清早：
    //   ①写请求成功就把乐观项删了；②快照的队列版本一变就删。
    // 而宿主读的是几分钟前的投影快照 —— 版本先涨、条目后到，中间这段时间什么都没有。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    const api = await import('../api.ts')
    // 快照：队列是空的，但版本已经是 3（说明宿主"处理过写"，却还没把条目吐出来）。
    vi.mocked(api.sessionState).mockResolvedValueOnce({
      sessionId: 's-1',
      rows: [],
      maxSeq: 0,
      queue: [],
      queueRevision: 3,
      turn: { running: true },
      asOf: Date.now(),
    })
    promptMock.mockResolvedValue(undefined)
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    emitSessionEvent(mux, 'turn/start', 1)
    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '排队里的一条' } })
    fireEvent.click(screen.getByRole('button', { name: '排队发送' }))
    await waitFor(() => { expect(screen.getByText('排队里的一条')).toBeTruthy() })
  })

  it('steers a queued message into the running turn', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    // A running turn enables the steer action.
    emitSessionEvent(mux, 'turn/start', 1)
    act(() => {
      mux.emit({
        type: 'session/queue',
        sessionId: 's-1',
        items: [{ id: 'q1', placement: 'queued', message: { id: 'm1', role: 'user', content: [{ type: 'text', text: '插话消息' }], source: { kind: 'user' } } }],
      })
    })
    await screen.findByText('插话消息')
    fireEvent.click(screen.getByRole('button', { name: '立即插入当前回合' }))
    await waitFor(() => { expect(updateQueueMock).toHaveBeenCalledWith('s-1', 'q1', { kind: 'steer' }) })
    // 插队成功后排队条必须当场消失：宿主的待发投影不推到手机，只等帧的话这条
    // 会一直挂到下一轮对账，用户看到的就是「插队发送之后排队消息没消失」。
    await waitFor(() => { expect(screen.queryByText('插话消息')).toBeNull() })
  })

  it('flips running off when a steer is rejected but keeps the queue dock', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    // A running turn enables the steer action.
    emitSessionEvent(mux, 'turn/start', 1)
    act(() => {
      mux.emit({
        type: 'session/queue',
        sessionId: 's-1',
        items: [{ id: 'q1', placement: 'queued', message: { id: 'm1', role: 'user', content: [{ type: 'text', text: '插话消息' }], source: { kind: 'user' } } }],
      })
    })
    await screen.findByText('插话消息')
    // The host rejects the steer because the agent is no longer running.
    vi.mocked(updateQueueMock).mockRejectedValueOnce(new RpcCallError({ code: 'steer-unavailable', message: 'current turn no longer accepts steering' }))
    fireEvent.click(screen.getByRole('button', { name: '立即插入当前回合' }))
    await waitFor(() => { expect(updateQueueMock).toHaveBeenCalledWith('s-1', 'q1', { kind: 'steer' }) })
    // The running indicator flips off (steer is only offered while running),
    // but the queue row itself stays: the view is authoritative host data and
    // converges via the next session/queue frame or the session/subscribed
    // re-baseline, never by a local clear on failure.
    await waitFor(() => {
      expect((screen.getByRole('button', { name: '立即插入当前回合' }) as HTMLButtonElement).disabled).toBe(true)
    })
    expect(screen.queryByText('插话消息')).not.toBeNull()
  })
  it('宿主的错误码带命名空间前缀时，也要走「这条已经不在队列里」这条分支', async () => {
    // 真机 bug：宿主返回 `session/queue-item-not-found`，界面判的是裸名
    // `queue-item-not-found` —— 分支从不成立，于是把「这条已经发出去/被删除」误报成
    // 「删除没送到宿主，检查一下网络再试」，用户只能看到一个删不掉的排队条 + 一句错话。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<><ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} /><ToastHost /></>)
    await screen.findByRole('button', { name: '发送' })
    act(() => {
      mux.emit({
        type: 'session/queue',
        sessionId: 's-1',
        items: [{ id: 'q7', placement: 'queued', message: { id: 'm7', role: 'user', content: [{ type: 'text', text: '带前缀的排队' }], source: { kind: 'user' } } }],
      })
    })
    await screen.findByText('带前缀的排队')
    // inbox 立刻回空队列：别触发 400ms 重试链（这个文件里还有对时序敏感的用例）。
    vi.mocked(await import('../api.ts')).inboxOf.mockResolvedValueOnce({ inbox: { 'next-turn': [] } })
    vi.mocked(updateQueueMock).mockRejectedValueOnce(new RpcCallError({ code: 'session/queue-item-not-found', message: 'queued item is no longer pending' }))
    fireEvent.click(screen.getByRole('button', { name: '删除排队消息' }))
    await waitFor(() => { expect(screen.queryByText('带前缀的排队')).toBeNull() })
    // 报的是真原因（toast 由 ToastHost 渲染：错误码归一化后「这条已经不在队列里」这条路才成立）
    await waitFor(() => { expect(document.body.textContent ?? '').toContain('这条已经不在队列里了') })
    expect(document.body.textContent ?? '').not.toContain('删除没送到宿主')
  })

  it('本地乐观项不能拿去调宿主：删除就是本地删掉', async () => {
    // 乐观项 id 是 local-*，宿主根本不知道它。以前拿它去调 session.updateQueue，
    // 必然失败并弹「删除没送到宿主」（真机：点删除，排队条还在）。
    //
    // 这里直接把乐观项塞进状态仓，不走发送链路 —— 发送链路会改 promptMock/inboxMock
    // 的默认实现，漏给后面那几个对时序与回执敏感的用例（实测会连锁失败）。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    act(() => { addOptimisticQueueItem('s-1', { text: '本地乐观排队', placement: 'queued' }) })
    await screen.findByText('本地乐观排队')
    const before = vi.mocked(updateQueueMock).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '删除排队消息' }))
    await waitFor(() => { expect(screen.queryByText('本地乐观排队')).toBeNull() })
    // 一次宿主调用都不该发出去
    expect(vi.mocked(updateQueueMock).mock.calls.length).toBe(before)
  })

  it('drops a queued row the host no longer knows about', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    act(() => {
      mux.emit({
        type: 'session/queue',
        sessionId: 's-1',
        items: [{ id: 'q1', placement: 'queued', message: { id: 'm1', role: 'user', content: [{ type: 'text', text: '删不掉的排队' }], source: { kind: 'user' } } }],
      })
    })
    await screen.findByText('删不掉的排队')
    // 手机上那份队列可能是打开会话时的旧快照（宿主的投影帧到不了手机），
    // 宿主早就没有 q1 了 —— 再点删除只会得到 queue-item-not-found。
    vi.mocked(updateQueueMock).mockRejectedValueOnce(new RpcCallError({ code: 'queue-item-not-found', message: 'no such queue item' }))
    const inboxMock = vi.mocked(await import('../api.ts')).inboxOf
    inboxMock.mockResolvedValue({ inbox: { 'next-turn': [] } })
    fireEvent.click(screen.getByRole('button', { name: '删除排队消息' }))
    await waitFor(() => { expect(updateQueueMock).toHaveBeenCalledWith('s-1', 'q1', { kind: 'remove' }) })
    // 这张卡片已经没有对应的队列项了，必须走人 —— 留着就是一张删不掉的幽灵。
    await waitFor(() => { expect(screen.queryByText('删不掉的排队')).toBeNull() })
  })

  it('asks the host again when a mutation is rejected (a claimed message must leave the dock)', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    act(() => {
      mux.emit({
        type: 'session/queue',
        sessionId: 's-1',
        items: [{ id: 'q1', placement: 'queued', message: { id: 'm1', role: 'user', content: [{ type: 'text', text: '排队消息' }], source: { kind: 'user' } } }],
      })
    })
    await screen.findByText('排队消息')
    // The host rejects the remove (agent detached / item already claimed).
    vi.mocked(updateQueueMock).mockRejectedValueOnce(new RpcCallError({ code: 'queue-item-not-found', message: 'queued item is no longer pending' }))
    fireEvent.click(screen.getByRole('button', { name: '删除排队消息' }))
    await waitFor(() => { expect(updateQueueMock).toHaveBeenCalledWith('s-1', 'q1', { kind: 'remove' }) })
    // 行不凭空删（队列以宿主为准），但必须**立刻现查一次**：宿主说这条已开始发送，
    // 手机上又没有投影帧，不查就永远挂着那张卡片。
    const inboxMock = vi.mocked(await import('../api.ts')).inboxOf
    await waitFor(() => {
      expect(inboxMock).toHaveBeenCalledWith('s-1', { fresh: true })
    })
  })

  it('reconciles the queue again when the phone comes back to the foreground', async () => {
    // 真机：桌面端把排队消息投出去了，手机上那张卡片还挂着「排队中」。息屏/切后台
    // 那段时间的帧本来就会丢，切回来必须立刻对一次账。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    const inboxMock = vi.mocked(await import('../api.ts')).inboxOf
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    const before = inboxMock.mock.calls.length
    inboxMock.mockResolvedValue({ inbox: { 'next-turn': [] } })
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => { expect(inboxMock.mock.calls.length).toBe(before + 1) })
  })

  it('keeps polling the queue after the turn ends (the old code stopped while idle)', async () => {
    // 只在 running 时轮询，等于「这一轮结束后队列再也不会对账」——而投递恰恰发生在
    // 回合结束前后。这里用假定时器确认空闲态仍有 10 秒一轮的对账（20 秒太慢：手机端
    // 会在这段时间里看着队列"消失"，而桌面端一直有）。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    const inboxMock = vi.mocked(await import('../api.ts')).inboxOf
    vi.useFakeTimers()
    try {
      render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
      await act(async () => { await Promise.resolve() })
      const before = inboxMock.mock.calls.length
      // 一条空闲会话不该在挂载后立刻连打（那才是病）：1 秒内没有新请求。
      await act(async () => { vi.advanceTimersByTime(1_000) })
      expect(inboxMock.mock.calls.length).toBe(before)
      // 但空闲态必须继续对账（回合结束后投递还得更新）：8 秒窗口内至少一轮。
      // 现在这条节奏由原子快照承担，顺带把目标/待办/回合一起带回来。
      await act(async () => { vi.advanceTimersByTime(8_000) })
      expect(inboxMock.mock.calls.length).toBeGreaterThan(before)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the command chip on the composer line, not in a row of its own', async () => {
    // 输入框里文字多的时候，命令那一行单独占一整行、把输入区顶得很别扭。
    // chip 要和输入框排在同一行的中心线上。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    const { container } = render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    fireEvent.click(screen.getByRole('button', { name: '斜杠命令' }))
    fireEvent.click(await screen.findByRole('menuitem'))
    await screen.findByText('/goal')
    // chip 在输入框外壳里面（和 textarea 同一个 .chat-field），不是并排的第二个控件，
    // 也不是输入框上方另起一行。
    const field = container.querySelector('.chat-field')
    expect(field).not.toBeNull()
    expect(field?.querySelector('.chat-command-chip')).not.toBeNull()
    expect(field?.querySelector('textarea.chat-input')).not.toBeNull()
    expect(container.querySelector('.chat-inputbar > .chat-command-chip')).toBeNull()
  })

  it('clears the queue dock on turn/start (claimed messages must not linger)', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    act(() => {
      mux.emit({
        type: 'session/queue',
        sessionId: 's-1',
        items: [{ id: 'q1', placement: 'queued', message: { id: 'm1', role: 'user', content: [{ type: 'text', text: '排队消息' }], source: { kind: 'user' } } }],
      })
    })
    await screen.findByText('排队消息')
    // A turn start claims the pending queue; the local queue view is cleared
    // so a claimed message never lingers as a phantom row.
    emitSessionEvent(mux, 'turn/start', 1)
    await waitFor(() => { expect(screen.queryByText('排队消息')).toBeNull() })
  })

  it('drops the queue dock on session/subscribed (mux-generation re-baseline)', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    act(() => {
      mux.emit({
        type: 'session/queue',
        sessionId: 's-1',
        items: [{ id: 'q1', placement: 'queued', message: { id: 'm1', role: 'user', content: [{ type: 'text', text: '排队消息' }], source: { kind: 'user' } } }],
      })
    })
    await screen.findByText('排队消息')
    // A reconnect opens a new mux generation: the host re-subscribes this
    // session and only re-pushes a queue baseline when non-empty. The local
    // view must drop first so an empty (omitted) baseline reads as "no queue"
    // instead of replaying the previous generation's phantom rows.
    act(() => { mux.emit({ type: 'session/subscribed', sessionId: 's-1', lastSeq: 42 }) })
    await waitFor(() => { expect(screen.queryByText('排队消息')).toBeNull() })
    // The same generation then re-baselines a still-pending queue → it shows
    // again; the drop was the reset, not a deletion.
    act(() => {
      mux.emit({
        type: 'session/queue',
        sessionId: 's-1',
        items: [{ id: 'q2', placement: 'queued', message: { id: 'm2', role: 'user', content: [{ type: 'text', text: '重新排队' }], source: { kind: 'user' } } }],
      })
    })
    expect(await screen.findByText('重新排队')).toBeTruthy()
  })

  it('drops jobs on session/subscribed alongside the queue dock', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    act(() => { mux.emit({ type: 'session/jobs', sessionId: 's-1', jobs: [{ id: 'subagent-1', kind: 'subagent', label: '整理记忆', status: 'running', startedAt: 1 }] as never }) })
    expect(screen.getByRole('button', { name: /后台任务 1 个运行中/ })).toBeTruthy()
    // Same generation reset as the queue: the jobs mirror drops so an omitted
    // (empty) baseline cannot replay a phantom task list.
    act(() => { mux.emit({ type: 'session/subscribed', sessionId: 's-1', lastSeq: 42 }) })
    await waitFor(() => { expect(screen.queryByRole('button', { name: /后台任务/ })).toBeNull() })
  })
})

describe('ChatView run-status strip (todo/write)', () => {
  const TODOS = [{ content: '写代码', status: 'in_progress' as const }, { content: '发版', status: 'completed' as const }]

  it('shows a strip from a live todo/write frame and lists items in the sheet', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    // No todo yet: no strip.
    expect(screen.queryByRole('button', { name: /任务 / })).toBeNull()
    act(() => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('todo/write', { todos: TODOS }, 40).event })
    })
    const strip = screen.getByRole('button', { name: /任务 1\/2/ })
    expect(strip).toBeTruthy()

    // Open the run-status sheet: the plan items are listed there.
    fireEvent.click(strip)
    expect(screen.getByRole('dialog', { name: '运行状态' })).toBeTruthy()
    expect(screen.getByText('写代码')).toBeTruthy()
    expect(screen.getByText('发版')).toBeTruthy()
  })

  it('seeds the strip from the history tail (newest todo/write wins)', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([
      makeEntry('todo/write', { todos: [{ content: '旧任务', status: 'pending' }] }, 10),
      ...turnEvents(),
      makeEntry('todo/write', { todos: TODOS }, 30),
    ]))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    expect(await screen.findByRole('button', { name: /任务 1\/2/ })).toBeTruthy()
  })

  it('clears the strip on turn/start (no jobs) and re-adopts later snapshots', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([makeEntry('todo/write', { todos: TODOS }, 10)]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    expect(await screen.findByRole('button', { name: /任务 1\/2/ })).toBeTruthy()

    // A new turn starts: the host clears the projection; the strip fades out then unmounts.
    emitSessionEvent(mux, 'turn/start', 20)
    await waitFor(() => { expect(screen.queryByRole('button', { name: /任务 / })).toBeNull() })

    // The new turn writes its own plan.
    act(() => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('todo/write', { todos: [{ content: '新一轮', status: 'in_progress' }] }, 21).event })
    })
    expect(screen.getByRole('button', { name: /任务 0\/1/ })).toBeTruthy()
  })

  it('ignores malformed todo snapshots and keeps the previous strip', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    act(() => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('todo/write', { todos: TODOS }, 40).event })
    })
    expect(screen.getByRole('button', { name: /任务 1\/2/ })).toBeTruthy()
    act(() => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('todo/write', { todos: 'bad' }, 41).event })
    })
    expect(screen.getByRole('button', { name: /任务 1\/2/ })).toBeTruthy()
  })

  it('normalizes in_progress leftovers to completed on turn/end', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    // 显式放宽这一处的等待：状态条依赖异步投影落地，全量并发跑（186 个文件）时
    // 默认 1s 会偶发超时（本地单独跑 3/3 全过）。只改等待，不改任何断言。
    await screen.findByRole('button', { name: '发送' }, { timeout: 5_000 })

    act(() => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('todo/write', { todos: TODOS }, 40).event })
    })
    expect(screen.getByRole('button', { name: /任务 1\/2/ })).toBeTruthy()

    // 挂一个在跑的后台任务：全完成时状态条会淡出（真机要求的「不留一条空话」），
    // 有这个任务才还能看到这一行，正好用它验证归一化后的计数。
    act(() => { mux.emit({ type: 'session/jobs', sessionId: 's-1', jobs: [{ id: 'subagent-1', kind: 'subagent', label: '整理记忆', status: 'running', startedAt: 1_700_000_000_000 }] }) })
    // The turn ends while '写代码' is still in_progress: it reads as completed
    // (the host normalizes the projection the same way), so the strip counts
    // 2/2 until the next turn/start clears the whole plan.
    emitSessionEvent(mux, 'turn/end', 41)
    const strip = screen.getByRole('button', { name: /任务 2\/2/ })
    fireEvent.click(strip)
    expect(screen.getByRole('dialog', { name: '运行状态' })).toBeTruthy()
    expect(screen.getByText('写代码')).toBeTruthy()
    expect(screen.getByText('发版')).toBeTruthy()
  })

  it('normalizes an in_progress leftover through the reconcile path when the live turn/end frame is lost', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    vi.useFakeTimers()
    try {
      // The turn opens and writes an intermediate plan...
      emitSessionEvent(mux, 'turn/start', 30)
      act(() => {
        mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('todo/write', { todos: TODOS }, 31).event })
      })
      expect(screen.getByRole('button', { name: /任务 1\/2/ })).toBeTruthy()

      // ...but the turn/end frame never arrives (degraded SSE). The host says
      // the session is idle; the reconcile scan finds the turn/end in the
      // history tail and must normalize the leftover, not just clear running.
      listSessionsMock.mockResolvedValue({
        items: [{ sessionId: 's-1', running: false } as never],
        hasMore: false,
      } as SessionPage)
      historyMock.mockResolvedValue(historyPage([makeEntry('turn/end', {}, 60)]))
      // 同上：留一个在跑的后台任务，条子才不会被「全完成自动收起」收掉。
      act(() => { mux.emit({ type: 'session/jobs', sessionId: 's-1', jobs: [{ id: 'subagent-1', kind: 'subagent', label: '整理记忆', status: 'running', startedAt: 1_700_000_000_000 }] }) })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(screen.queryByRole('status', { name: '输出中' })).toBeNull()
      expect(screen.getByRole('button', { name: /任务 2\/2/ })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ChatView turn clock (#outputting timer)', () => {
  const T0 = 1_700_000_000_000

  /** 最后一条助手行里的过程卡头 —— 秒表唯一出现在它的第一行。 */
  const lastProcHead = (): HTMLElement => {
    const rows = document.querySelectorAll('.chat-msg-assistant')
    return (rows[rows.length - 1] as HTMLElement).querySelector('.chat-proc-head') as HTMLElement
  }
  /** 卡第一行的时间半句（没渲染时是空串）。 */
  const procTime = (head: HTMLElement = lastProcHead()): string =>
    head.querySelector('.chat-proc-time')?.textContent ?? ''

  /** 一页"进行中的回合"：turn/start＋一枚文本 chunk（没有 assistant/message 就
   *  不会收尾）。行的锚点因此就是日志里的 turn/start 时间 —— 重载进一个已经跑了
   *  90 秒的回合，秒表必须从真正的起点数，而不是从挂载那一刻。 */
  const runningTurnPage = (startedAt: number, chunkAt = startedAt + 1_000): ChatPageResult => rowPage([
    makeEntryAt('turn/start', { turn: 0 }, 1, startedAt),
    makeEntryAt('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: '在写' } }, 2, chunkAt),
  ], { turnStartAt: startedAt })

  it('shows the elapsed clock only once the turn has run past the 3s threshold', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    // 尾页必须**已经落地**再进假时钟：尾页没落地时 live 帧只会进缓冲区。
    await screen.findByText('还没有消息，发一句话开始吧')
    vi.useFakeTimers()
    try {
      vi.setSystemTime(T0)
      // A young turn (2s in): the state word only, no clock yet.
      emitTurnStart(mux, 60, Date.now() - 2_000)
      emitChunk(mux, 61, Date.now())
      await settleLiveFold()
      expect(procStateOf(lastProcHead())).toBe('深度求索中')
      expect(procTime()).toBe('')
      expect(lastProcHead().getAttribute('aria-label')).toBe('深度求索中')

      // 底部状态行只剩措辞（输出中 ＋ 三个点）：秒表已经不在那里了。
      expect(turnStatusEl().textContent).toBe('输出中')
      expect(turnStatusEl().querySelector('.chat-turn-time')).toBeNull()
      expect(document.querySelector('.chat-turn-time')).toBeNull()

      // A turn started 20s ago (anchor from the logged turn/start, desktop
      // parity): the clock appears with the true elapsed duration.
      emitTurnStart(mux, 62, T0 - 20_000, 1)
      emitChunk(mux, 63, T0, 1)
      await settleLiveFold()
      expect(procStateOf(lastProcHead())).toBe('深度求索中')
      expect(procTime()).toBe('用时20秒')

      // turn/end stamps the frozen duration and clears the bottom indicator;
      // the settled card keeps reporting what the turn cost.
      emitSessionFrame(mux, 'turn/end', 64, T0, { turn: 1 })
      await settleLiveFold()
      expect(screen.queryByRole('status', { name: '输出中' })).toBeNull()
      expect(turnStatusEl()).toBeNull()
      expect(procStateOf(lastProcHead())).toBe('已完成')
      expect(procTime()).toBe('用时20秒')
    } finally {
      vi.useRealTimers()
    }
  })

  it('一帧慢包不会把秒表的宿主偏移拖回去（偏移取窗口内最大值）', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('还没有消息，发一句话开始吧')
    vi.useFakeTimers()
    try {
      vi.setSystemTime(T0)
      // 锚点是日志里的回合起点：20 秒前。
      emitTurnStart(mux, 70, T0 - 20_000, 1)
      // 一帧低延迟的普通事件：宿主时间比本机快 4 秒（真实偏移），
      // 读数 = 20 + 4 = 24 秒。
      emitChunk(mux, 71, T0 + 4_000, 1)
      await settleLiveFold()
      expect(procTime()).toBe('用时24秒')

      // 紧接着一帧慢包：它的样本被延迟压低 4 秒。每帧直接覆盖偏移的话，
      // 秒表会当场从 24 秒掉回 20 秒（再来一帧又跳回去 —— 就是"节奏很怪"）。
      // 取窗口内最大值后，慢包只是没被采纳，读数不动。
      emitChunk(mux, 72, T0, 1)
      await settleLiveFold()
      expect(procTime()).toBe('用时24秒')
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores the clock anchor from the loaded tail page (mid-turn reload keeps the real elapsed)', async () => {
    // The window carries the open turn/start's logged time (desktop parity):
    // an entry into an already-running turn counts from the true start.
    // Fake timers come up BEFORE render so the page's microtask resolution
    // lands inside the fake time zone and the clock effect re-anchors there.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(T0)
      historyMock.mockResolvedValue({ events: [], hasMore: false } as HistoryPage)
      loadChatPageMock.mockResolvedValue(runningTurnPage(T0 - 90_000))
      const mux = new FakeMux()
      render(<ChatView session={{ ...session, running: true }} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
      // Flush the page promise (microtask): the anchor lands, the effect
      // ticks once on the frozen clock — 90s of real elapsed, not mount time.
      await flushPageLoad()
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()
      expect(procStateOf(lastProcHead())).toBe('深度求索中')
      expect(procTime()).toBe('用时1分30秒')

      // A live turn/end closes the turn: the indicator goes out and the card
      // freezes the duration it counted.
      emitSessionFrame(mux, 'turn/end', 60, T0, { turn: 0 })
      await settleLiveFold()
      expect(screen.queryByRole('status', { name: '输出中' })).toBeNull()
      expect(procStateOf(lastProcHead())).toBe('已完成')
      expect(procTime()).toBe('用时1分30秒')

      // A fresh turn/start re-anchors: the new row's clock counts from ITS
      // start, not from the previous turn's elapsed.
      emitTurnStart(mux, 61, T0 - 5_000, 1)
      emitChunk(mux, 62, T0, 1)
      await settleLiveFold()
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()
      expect(procTime()).toBe('用时5秒')
    } finally {
      vi.useRealTimers()
    }
  })

  it('takes the clock anchor from the turn rows when the page carries none', async () => {
    // 真机现象：有时候一进会话，用时从 0 开始数。尾页的 turnStartAt 靠"最后一条
    // 边界"判，边界落在切口之外就是空的；此时行上也没有 turnStartAt（它的
    // turn/start 同样在窗口外），于是整页只剩挂载时刻可用 —— 一个已经跑了 89 秒
    // 的会话，秒表从 0 数起。行自己的时间一直在，拿它当锚点虽然略短（少了首步
    // 的生成耗时），但方向对。
    vi.useFakeTimers()
    try {
      vi.setSystemTime(T0)
      historyMock.mockResolvedValue({ events: [], hasMore: false } as HistoryPage)
      loadChatPageMock.mockResolvedValue(rowPage([
        makeEntryAt('tool/call', { turn: 0, step: 0, callId: 'c-89', name: 'bash', arguments: '{}' }, 2, T0 - 89_000),
      ]))
      const mux = new FakeMux()
      render(<ChatView session={{ ...session, running: true }} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
      await flushPageLoad()
      expect(procStateOf(lastProcHead())).toBe('深度求索中')
      expect(procTime()).toBe('用时1分29秒')
    } finally {
      vi.useRealTimers()
    }
  })

  describe('ChatView queue claim / turn switching', () => {
  /** 第 index 个助手行里的过程卡头（按 DOM 顺序）。 */
  function procHeadAt(index: number): HTMLElement | null {
    const rows = document.querySelectorAll('.chat-msg-assistant')
    const row = rows[index]
    if (row === undefined) return null
    return row.querySelector('.chat-proc-head') as HTMLElement | null
  }
  function stateAt(index: number): string {
    const head = procHeadAt(index)
    return head === null ? '' : procStateOf(head)
  }
  /** 当前还在跑的过程卡数量：任何时刻最多 1 张。 */
  function liveCount(): number {
    return Array.from(document.querySelectorAll('.chat-msg-assistant'))
      .filter(row => {
        const head = row.querySelector('.chat-proc-head')
        return head !== null && procStateOf(head as HTMLElement) === '深度求索中'
      }).length
  }

  it('插话（steer）在同一轮里追加用户消息时，不能把正在跑的卡清零', async () => {
    // 判据不能选「更新的用户消息」：插话、排队消息被认领都在同一轮里追加用户行。
    vi.useFakeTimers()
    try {
      vi.setSystemTime(T0)
      loadChatPageMock.mockResolvedValue(rowPage([]))
      const mux = new FakeMux()
      render(<ChatView session={{ ...session, running: true }} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
      await flushPageLoad()
      emitTurnStart(mux, 300, T0 - 5_000, 0)
      emitChunk(mux, 301, T0 - 4_000, 0)
      await settleLiveFold()
      expect(procStateOf(lastProcHead())).toBe('深度求索中')

      // 插话：用户行比锚点新，但轮号没变 —— 这一轮还在跑。
      emitSessionFrame(mux, 'user/message', 302, T0 - 1_000, { id: 'u-steer', role: 'user', content: [{ type: 'text', text: '顺便再改一处' }] })
      await settleLiveFold()
      emitSessionFrame(mux, 'assistant/chunk', 303, T0, { turn: 0, step: 1, chunk: { type: 'text-delta', index: 0, text: '好' } })
      await settleLiveFold()

      // 同一轮可以有多张过程卡同时活着（按步分卡），但这一轮不能被清零。
      expect(procStateOf(lastProcHead())).toBe('深度求索中')
      expect(liveCount()).toBeGreaterThanOrEqual(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('连续两轮都漏掉边界帧时，上一轮的卡全部落定', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(T0)
      loadChatPageMock.mockResolvedValue(rowPage([]))
      const mux = new FakeMux()
      render(<ChatView session={{ ...session, running: true }} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
      await flushPageLoad()
      emitTurnStart(mux, 400, T0 - 90_000, 0)
      emitChunk(mux, 401, T0 - 89_000, 0)
      await settleLiveFold()
      expect(stateAt(0)).toBe('深度求索中')
      expect(liveCount()).toBe(1)

      // 排队第一条被认领（边界帧全丢，只有新一轮的行到）。
      emitSessionFrame(mux, 'assistant/message', 402, T0 - 60_000, {
        turn: 1,
        step: 0,
        message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '第一条已处理' }] },
      })
      await settleLiveFold()
      expect(stateAt(0)).not.toBe('深度求索中')
      expect(liveCount()).toBe(0)

      // 排队第二条被认领。
      emitSessionFrame(mux, 'assistant/message', 403, T0 - 10_000, {
        turn: 2,
        step: 0,
        message: { id: 'a-2', role: 'assistant', content: [{ type: 'text', text: '第二条在处理' }] },
      })
      await settleLiveFold()
      expect(stateAt(0)).not.toBe('深度求索中')
      expect(liveCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('正常的 turn/end → turn/start 切换：旧卡落定，只有新卡在跑', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(T0)
      loadChatPageMock.mockResolvedValue(rowPage([]))
      const mux = new FakeMux()
      render(<ChatView session={{ ...session, running: true }} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
      await flushPageLoad()
      emitTurnStart(mux, 500, T0 - 50_000, 0)
      emitChunk(mux, 501, T0 - 49_000, 0)
      await settleLiveFold()
      expect(stateAt(0)).toBe('深度求索中')

      emitSessionFrame(mux, 'turn/end', 502, T0 - 20_000, { turn: 0 })
      emitTurnStart(mux, 503, T0 - 1_000, 1)
      emitChunk(mux, 504, T0, 1)
      await settleLiveFold()

      expect(stateAt(0)).not.toBe('深度求索中')
      expect(liveCount()).toBe(1)
      expect(procStateOf(lastProcHead())).toBe('深度求索中')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ChatView queued-send affordance', () => {
  it('says 排队 in words while a turn runs, instead of a clock badge on the paper plane', async () => {
    // 用户原话：运行中按发送，消息从输入框消失、答案没来，以为丢了。图标必须能区分。
    // 后来又一条：角上那只小钟又丑又看不懂 —— 直接写字最省解释。
    // 运行中且输入框为空时主键是「停止」；一有草稿才变成「排队发送」（primaryStops）。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const first = render(
      <ChatView session={{ ...session, running: true }} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />,
    )
    const runningInput = await screen.findByPlaceholderText('说点什么...') as HTMLTextAreaElement
    fireEvent.change(runningInput, { target: { value: '先排一条' } })
    const queued = await screen.findByRole('button', { name: '排队发送' })
    // 写字的胶囊，而不是「纸飞机 + 角上一只钟」。
    expect(queued.textContent).toContain('排队')
    expect(queued.querySelector('.chat-send-queued-badge')).toBeNull()
    expect(queued.querySelector('svg')).toBeNull()
    first.unmount()

    loadChatPageMock.mockResolvedValue(rowPage([]))
    render(<ChatView session={{ ...session, running: false }} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    const idleInput = await screen.findByPlaceholderText('说点什么...') as HTMLTextAreaElement
    fireEvent.change(idleInput, { target: { value: '直接发' } })
    const sending = await screen.findByRole('button', { name: '发送' })
    // 空闲时还是那枚纸飞机，不会误显示成「排队」。
    expect(sending.textContent).not.toContain('排队')
    expect(sending.querySelector('svg')).not.toBeNull()
  })
})

describe('ChatView command directory retry', () => {
  it('retries the directory after a failed fetch instead of caching an empty list', async () => {
    // 真机 2026-10-22：斜杠面板有时只剩几条命令，/goal、/plan 不见。首次拉目录撞上
    // 宿主忙/弱网时，旧代码把 [] 缓存下来，整个会话就再也拉不到。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const api = await import('../api.ts')
    const listMock = vi.mocked(api.listCommands)
    listMock.mockRejectedValue(new Error('busy'))
    render(<ChatView session={session} mux={new FakeMux() as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '/' } })
    await waitFor(() => { expect(listMock).toHaveBeenCalledTimes(1) })
    // 失败不缓存：过了防抖窗口再敲一次斜杠，应该再问一次宿主。
    fireEvent.change(input, { target: { value: '' } })
    await new Promise(resolve => setTimeout(resolve, 1100))
    listMock.mockResolvedValue([{ name: 'goal', description: 'set or view the goal' }])
    fireEvent.change(input, { target: { value: '/g' } })
    await waitFor(() => { expect(listMock.mock.calls.length).toBeGreaterThan(1) })
  })
})

describe('ChatView regenerate affordance', () => {
  const base = { isLastMessage: true, isAssistant: true, pending: false }

  it('never offers 重新生成 while the turn still looks alive', () => {
    // 真机 2026-10-22：会话还在跑（过程框「深度求索中 · 用时 3 分 55 秒」），右下角却
    // 摆着一颗 ↻。原来只看本地的 running：宿主重启/断流把 running 打回 false，过程框
    // 却还挂着（turnStartAt 没有配对的 turn/end）。两边必须同源。
    expect(offersRegenerate({ ...base, turnLive: true })).toBe(false)
    expect(offersRegenerate({ ...base, turnLive: false })).toBe(true)
  })

  it('only decorates the last settled assistant reply', () => {
    expect(offersRegenerate({ isLastMessage: false, isAssistant: true, pending: false, turnLive: false })).toBe(false)
    expect(offersRegenerate({ isLastMessage: true, isAssistant: false, pending: false, turnLive: false })).toBe(false)
    expect(offersRegenerate({ isLastMessage: true, isAssistant: true, pending: true, turnLive: false })).toBe(false)
  })
})

describe('ChatView stale turn boundary', () => {
  it('marks the open turn 已中断 when the roster says idle (restart killed it)', async () => {
    // 宿主重启/断流打断的回合不会写 turn/end，打开会话时只能看到一条开着的边界。
    // 旧逻辑把这种「边界开着但名单说不跑」判成收工，卡片落在 ok 分支显示
    // 「已完成 ✅ 用时 X」，正文却是半句 —— 假成功。收尾词必须是「已中断」。
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents(), { turnStartAt: T0 - 50_000, lastEventAt: T0 - 50_000 }))
    render(<ChatView session={{ ...session, running: false }} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await flushPageLoad()
    expect(procStateOf(lastProcHead())).toBe('已中断')
  })


  it('settles the previous turn when a new user message arrives without any boundary frames', async () => {
    // turn/end 与 turn/start 是两帧，弱网/切后台时只漏了 turn/end：runningTurn 与计时锚点
    // 就永远停在上一轮 —— 上一轮卡片一直「正在回答」并继续数秒，新一轮的秒表还从上一轮
    // 起点算（截图里 46 秒那次）。宿主的规矩是「一条用户消息开一轮」，所以出现更新的
    // 用户消息就等于上一轮已经结束。
    vi.useFakeTimers()
    try {
      vi.setSystemTime(T0)
      loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
      const mux = new FakeMux()
      render(<ChatView session={{ ...session, running: true }} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
      await flushPageLoad()
      emitTurnStart(mux, 200, T0 - 40_000)
      emitChunk(mux, 201, T0 - 39_000)
      await settleLiveFold()
      expect(procStateOf(lastProcHead())).toBe('深度求索中')

      // 新一轮开始：用户消息 + 新一轮的行都在，唯独 turn/end 和 turn/start 没到。
      emitSessionFrame(mux, 'user/message', 202, T0 - 1_000, {
        id: 'u-2',
        role: 'user',
        content: [{ type: 'text', text: '继续' }],
      })
      await settleLiveFold()
      emitSessionFrame(mux, 'assistant/message', 203, T0 - 500, {
        turn: 1,
        step: 0,
        message: { id: 'a-2', role: 'assistant', content: [{ type: 'text', text: '好' }] },
      })
      await settleLiveFold()

      // 旧卡必须落定：活跃轮次已经翻到新一轮，不能再挂着「深度求索中」的秒表。
      const first = document.querySelectorAll('.chat-proc-head')[0] as HTMLElement
      expect(procStateOf(first)).not.toBe('深度求索中')
    } finally {
      vi.useRealTimers()
    }
  })
})

it('does not light the indicator from a stale open turn when the host says nothing runs', async () => {
    // A turn that died without writing its turn/end leaves an open boundary in
    // the log. Treating that boundary as proof the turn is still open painted
    // 输出中 over sessions the desktop knew were idle, and the last process
    // block kept reading 深度求索中 forever. The roster's running flag is the
    // verdict; the boundary only anchors the clock.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(T0)
      historyMock.mockResolvedValue({ events: [], hasMore: false } as HistoryPage)
      loadChatPageMock.mockResolvedValue(runningTurnPage(T0 - 42_000))
      const mux = new FakeMux()
      render(<ChatView session={{ ...session, running: false }} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
      await flushPageLoad()
      expect(screen.queryByRole('status', { name: '输出中' })).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('settles the running indicator when the host reports the session stopped', async () => {
    // The correction path for a lost turn/end: the roster event carries what
    // the host believes, independently of whether this page saw the boundary.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(T0)
      historyMock.mockResolvedValue({ events: [], hasMore: false } as HistoryPage)
      loadChatPageMock.mockResolvedValue(rowPage([]))
      const mux = new FakeMux()
      render(<ChatView session={{ ...session, running: true }} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
      await flushPageLoad()
      emitTurnStart(mux, 200, T0 - 5_000)
      emitChunk(mux, 201, T0)
      await settleLiveFold()
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()

      // The host says the session is no longer running.
      mux.emit({ type: 'session/status', sessionId: session.sessionId, running: false })
      await settleLiveFold()

      expect(screen.queryByRole('status', { name: '输出中' })).toBeNull()
      // The process head must settle too — the stale active-turn pointer was
      // what kept it reading 深度求索中 with a stopwatch that never stopped.
      expect(procStateOf(lastProcHead())).not.toBe('深度求索中')
    } finally {
      vi.useRealTimers()
    }
  })

  it('recovers the clock anchor from the reconcile probe when the page lacks it', async () => {
    // A turn started before the loaded window (the tail page carries no
    // boundary): the running-reconcile history probe surfaces it. 行的锚点来自
    // 折叠里的 turn/start —— 探针只保证"回合仍然开着"，绝不把已经走着的秒表清零
    // （见最终报告：页面/探针一级的锚点目前传不到行里，这是产品的已知缺口）。
    vi.useFakeTimers()
    try {
      vi.setSystemTime(T0)
      loadChatPageMock.mockResolvedValue(rowPage([]))
      historyMock.mockResolvedValue(historyPage([
        makeEntry('turn/start', {}, 1_699_999_910),
      ]))
      const mux = new FakeMux()
      render(<ChatView session={{ ...session, running: true }} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
      await flushPageLoad()
      // 回合刚起：行内秒表还没到阈值，所以只有状态词。
      emitTurnStart(mux, 59, T0 - 2_000)
      emitChunk(mux, 60, T0)
      await settleLiveFold()
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()
      expect(procStateOf(lastProcHead())).toBe('深度求索中')
      expect(procTime()).toBe('')
      // The running-reconcile probe (RUNNING_RECONCILE_MS) reads the tail: the
      // turn is still open, so the clock keeps counting and never restarts.
      act(() => { vi.advanceTimersByTime(RUNNING_RECONCILE_MS + 50) })
      await act(async () => { await Promise.resolve() })
      // 10.05s of silence: the wording still stays 输出中 — the turn is still
      // OPEN (the probe found its turn/start) and the link is up, so the
      // indicator must neither vanish nor claim 连接中断.
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()
      expect(screen.queryByRole('status', { name: '连接中断' })).toBeNull()
      // 秒表在过程卡第一行（P4 起不再挂底部状态行），锚点还是 live 帧的
      // turn/start（T0-2s）：2s + 10.05s = 12s，绝不被探针清零重来。
      expect(procStateOf(lastProcHead())).toBe('深度求索中')
      expect(turnStatusEl().textContent).toBe('输出中')
      expect(turnStatusEl().textContent).not.toMatch(/\d/)
      expect(procTime()).toBe('用时12秒')
      // 探针之后秒表继续往前走（没有被清零回 0）。
      act(() => { vi.advanceTimersByTime(RUNNING_RECONCILE_MS + 50) })
      expect(procTime()).toBe('用时22秒')
    } finally {
      vi.useRealTimers()
    }
  })

  it('adopts the page-level anchor the reconcile probe recovered (row carries no own turn/start)', async () => {
    // P0＋P6 回归：行**没有**自己的 turnStartAt（尾页里就没有那个边界），探针从历史
    // 尾巴把日志时间取回来，经页级 clockAnchor → MessageRow.liveTurnStartAt 落到行内
    // 秒表上（锚点优先级：行自己的 turnStartAt > 页级 liveTurnStartAt > firstSeenAt）。
    // 行用 reasoning-delta 造：它带一条过程行 ⇒ 折叠头渲染；而 firstSeenAt 只是本帧
    // 时间，若锚点退化成 firstSeenAt 就只数得出 10 秒 —— 1分40秒 只可能来自被取回的
    // 页级锚点（日志里的 turn/start = T0 − 90s）。
    vi.useFakeTimers()
    try {
      vi.setSystemTime(T0)
      loadChatPageMock.mockResolvedValue(rowPage([]))
      historyMock.mockResolvedValue(historyPage([
        makeEntryAt('turn/start', {}, 1, T0 - 90_000),
      ]))
      const mux = new FakeMux()
      render(<ChatView session={{ ...session, running: true }} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
      await flushPageLoad()
      // 只推这一帧：行落在 firstSeenAt = T0 上，秒表还没到 3 秒阈值。
      emitSessionFrame(mux, 'assistant/chunk', 59, T0, {
        turn: 0,
        step: 0,
        chunk: { type: 'reasoning-delta', index: 0, text: '先看结构' },
      })
      await settleLiveFold()
      expect(procStateOf(lastProcHead())).toBe('深度求索中')
      expect(procTime()).toBe('')
      // 静默满一个 reconcile 周期：探针读历史尾巴，读到窗口外的 turn/start，
      // 页级锚点因此被取回 —— 秒表从 0 秒跳到「日志起点起算」的 1分40秒
      // （90s 日志 + 10s 静默周期），而不是 firstSeenAt 的 10 秒。
      act(() => { vi.advanceTimersByTime(RUNNING_RECONCILE_MS + 50) })
      await flushPageLoad()
      expect(procStateOf(lastProcHead())).toBe('深度求索中')
      expect(procTime()).toBe('用时1分40秒')
    } finally {
      vi.useRealTimers()
    }
  })

  it('anchors on the row first-seen time when turn/start is out of every window', async () => {
    // 真机返工现象：桌面端已经跑了十几分钟，手机中途进会话，秒表却从 0 秒开始。
    // 成因是这一轮的 turn/start 早被挤出折叠窗口和边界回读窗口，兜底锚点退化成
    // "这一行的最后一次事件时间"（活跃行上就等于现在）。首见时间才是这一轮的证据。
    vi.useFakeTimers()
    try {
      vi.setSystemTime(T0)
      loadChatPageMock.mockResolvedValue(rowPage([]))
      historyMock.mockResolvedValue(historyPage([]))
      const mux = new FakeMux()
      render(<ChatView session={{ ...session, running: true }} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
      await flushPageLoad()
      // 这一行十一分钟前就在写了（turn/start 已经不可读）。
      emitSessionFrame(mux, 'assistant/chunk', 59, T0 - 660_000, {
        turn: 0,
        step: 0,
        chunk: { type: 'reasoning-delta', index: 0, text: '先看结构' },
      })
      await settleLiveFold()
      // 再推一条把它"最后一次触碰"推进到现在：time 变成 T0，首见时间不变。
      emitSessionFrame(mux, 'assistant/chunk', 60, T0, {
        turn: 0,
        step: 0,
        chunk: { type: 'reasoning-delta', index: 1, text: '再看数据' },
      })
      await settleLiveFold()
      act(() => { vi.advanceTimersByTime(1_000) })
      // 660 秒 + 1 秒 = 11分1秒。锚点若认 time（=T0）这里只会数出 1 秒，正是那个 bug。
      expect(procTime()).toBe('用时11分1秒')
    } finally {
      vi.useRealTimers()
    }
  })

  it('locates and highlights the focused message on open (search-hit locate)', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '先看这个' }] }, 30),
      makeEntry('assistant/message', { turn: 0, step: 0, message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '收到' }] } }, 31),
    ]))
    const mux = new FakeMux()
    render(<ChatView session={session} initialFocusSeq={30} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    // The located row carries the one-shot highlight class.
    await waitFor(() => {
      const row = document.querySelector('[data-row-seq="30"]')
      expect(row).not.toBeNull()
      expect(row?.classList.contains('chat-msg-focus')).toBe(true)
    })
    // Rows untouched by the locate stay unhighlighted.
    expect(document.querySelector('[data-row-seq="31"]')?.classList.contains('chat-msg-focus')).toBe(false)
  })

  it('locates by stable messageId (search-hit identity path)', async () => {
    // A workspace-search hit forwards messageId, NOT a sequence. Locate must
    // land on the exact row carrying that data-message-id even though its seq
    // is unrelated, and must ignore the earlier/surrounding rows.
    loadChatPageMock.mockResolvedValue(rowPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '先看这个' }] }, 30),
      makeEntry('user/message', { id: 'u-2', role: 'user', content: [{ type: 'text', text: '再看那个' }] }, 40),
      makeEntry('assistant/message', { turn: 0, step: 0, message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '已定位到这句' }] } }, 50),
    ]))
    const mux = new FakeMux()
    render(<ChatView session={session} initialFocusMessageId="a-1" initialFocusQuery="已定位到这句" mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    await waitFor(() => {
      const row = document.querySelector('[data-message-id="a-1"]')
      expect(row).not.toBeNull()
      expect(row?.classList.contains('chat-msg-focus')).toBe(true)
    })
    // The identity locate must not highlight an unrelated row.
    expect(document.querySelector('[data-message-id="u-1"]')?.classList.contains('chat-msg-focus')).toBe(false)
    expect(document.querySelector('[data-message-id="u-2"]')?.classList.contains('chat-msg-focus')).toBe(false)
  })

  it('re-arms and locates a different messageId when ChatView is reused for the same session', async () => {
    // App routes chats keyed by session, so a second locate in the same
    // session reuses this component. The stable-identity target must be
    // re-armed from the NEW prop, not frozen at the first open.
    loadChatPageMock.mockResolvedValue(rowPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '第一' }] }, 30),
      makeEntry('user/message', { id: 'u-2', role: 'user', content: [{ type: 'text', text: '第二' }] }, 40),
    ]))
    const mux = new FakeMux()
    const { rerender } = render(<ChatView session={session} initialFocusMessageId="u-1" mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    await waitFor(() => {
      expect(document.querySelector('[data-message-id="u-1"]')?.classList.contains('chat-msg-focus')).toBe(true)
    })
    rerender(<ChatView session={session} initialFocusMessageId="u-2" mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await waitFor(() => {
      expect(document.querySelector('[data-message-id="u-2"]')?.classList.contains('chat-msg-focus')).toBe(true)
    })
    expect(document.querySelector('[data-message-id="u-1"]')?.classList.contains('chat-msg-focus')).toBe(false)
  })

  it('does not fall back to a duplicate keyword while an authoritative target is in older history', async () => {
    loadChatPageMock
      .mockResolvedValueOnce(rowPage([
        makeEntry('user/message', { id: 'old-match', role: 'user', content: [{ type: 'text', text: '相同关键词' }] }, 90),
      ], { hasMore: true }))
      .mockResolvedValueOnce(rowPage([
        makeEntry('user/message', { id: 'real-target', role: 'user', content: [{ type: 'text', text: '真正的相同关键词' }] }, 40),
      ], { hasMore: false }))
    const mux = new FakeMux()
    render(<ChatView
      session={session}
      initialFocusSeq={40}
      initialFocusMessageId="real-target"
      initialFocusQuery="相同关键词"
      mux={mux as never}
      onBack={() => {}}
      showToolCalls={true}
      showSystemMessages={false}
    />)
    await screen.findByRole('button', { name: '发送' })
    await waitFor(() => {
      const row = document.querySelector('[data-message-id="real-target"]')
      expect(row).not.toBeNull()
      expect(row?.classList.contains('chat-msg-focus')).toBe(true)
    })
    expect(document.querySelector('[data-message-id="old-match"]')?.classList.contains('chat-msg-focus')).toBe(false)
  })

  it('locates a finalized single-step row when the search hit came from an earlier chunk seq', async () => {
    // Real assistant/chunk events have no messageId. The search index can
    // therefore retain the chunk seq while the finalized row gets a later
    // assistant/message seq and a different stable id. The seq fallback must
    // choose that row, rather than the first older row containing the keyword.
    loadChatPageMock.mockResolvedValue(rowPage([
      makeEntry('user/message', { id: 'u-old', role: 'user', content: [{ type: 'text', text: '重复关键词' }] }, 20),
      makeEntry('assistant/message', { turn: 0, step: 0, message: { id: 'a-final', role: 'assistant', content: [{ type: 'text', text: '最新重复关键词' }] } }, 31),
    ]))
    const mux = new FakeMux()
    render(<ChatView
      session={session}
      initialFocusSeq={30}
      initialFocusMessageId="assistant,0.0#30"
      initialFocusQuery="重复关键词"
      mux={mux as never}
      onBack={() => {}}
      showToolCalls={true}
      showSystemMessages={false}
    />)
    await screen.findByRole('button', { name: '发送' })
    await waitFor(() => {
      const row = document.querySelector('[data-message-id="a-final"]')
      expect(row).not.toBeNull()
      expect(row?.classList.contains('chat-msg-focus')).toBe(true)
    })
    expect(document.querySelector('[data-message-id="u-old"]')?.classList.contains('chat-msg-focus')).toBe(false)
    await waitFor(() => { expect(scrollWrites.length).toBeGreaterThan(0) })
  })

  it('falls back to the paired query when the target seq matches no row', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '先看这个' }] }, 30),
      makeEntry('assistant/message', { turn: 0, step: 0, message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '收到' }] } }, 31),
    ]))
    const mux = new FakeMux()
    // A stale/mismatched seq (999) that no row covers: the paired query must
    // still land the chat on the first message containing it, not the tail.
    render(<ChatView session={session} initialFocusSeq={999} initialFocusQuery="先看这个" mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    await waitFor(() => {
      const row = document.querySelector('[data-row-seq="30"]')
      expect(row).not.toBeNull()
      expect(row?.classList.contains('chat-msg-focus')).toBe(true)
    })
    // The locate must SCROLL to the found row even though the target seq (999)
    // matches no anchor: the rendered row (focusMsgId) is the scroll target.
    await waitFor(() => { expect(scrollWrites.length).toBeGreaterThan(0) })
  })

  it('re-arms locating when the same chat receives a new target', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '第一个结果' }] }, 30),
      makeEntry('assistant/message', { turn: 0, step: 0, message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '第二个结果' }] } }, 40),
    ]))
    const mux = new FakeMux()
    const first = { session, initialFocusSeq: 30, initialFocusQuery: '第一个结果', mux: mux as never, onBack: () => {}, showToolCalls: true, showSystemMessages: false }
    const { rerender } = render(<ChatView {...first} />)
    await screen.findByRole('button', { name: '发送' })
    await waitFor(() => expect(document.querySelector('[data-row-seq="30"]')?.classList.contains('chat-msg-focus')).toBe(true))

    rerender(<ChatView {...first} initialFocusSeq={40} initialFocusQuery="第二个结果" />)
    await waitFor(() => expect(document.querySelector('[data-row-seq="40"]')?.classList.contains('chat-msg-focus')).toBe(true))
    expect(document.querySelector('[data-row-seq="30"]')?.classList.contains('chat-msg-focus')).toBe(false)
  })

  it('anchors a folded step, expands long prose, and marks only visible reply text', async () => {
    const hiddenNeedle = 'needle'
    loadChatPageMock.mockResolvedValue(rowPage([
      makeEntry('assistant/message', {
        turn: 0,
        step: 0,
        message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: 'A'.repeat(LONG_TEXT_LIMIT + 10) }] },
      }, 30),
      makeEntry('tool/call', {
        turn: 0,
        step: 0,
        callId: 'c-1',
        name: 'bash',
        arguments: `{"cmd":"echo ${hiddenNeedle}"}`,
      }, 31),
      makeEntry('assistant/message', {
        turn: 0,
        step: 1,
        message: {
          id: 'a-2',
          role: 'assistant',
          content: [{ type: 'text', text: `可见 ${hiddenNeedle}\n\n\`\`\`txt\n${hiddenNeedle}\n\`\`\`\n\n<think>${hiddenNeedle}</think>` }],
        },
      }, 40),
    ]))

    render(<ChatView
      session={session}
      initialFocusSeq={40}
      initialFocusQuery={hiddenNeedle}
      onBack={() => {}}
      showToolCalls={true}
      showSystemMessages={false}
    />)

    await screen.findByRole('button', { name: '发送' })
    await waitFor(() => {
      expect(document.querySelector('[data-step-seq="40"]')).not.toBeNull()
      expect(document.querySelectorAll('.chat-search-mark')).toHaveLength(1)
    })
    expect(document.querySelector('.chat-search-mark')?.textContent).toBe(hiddenNeedle)
    // The answer is the LAST step's text: it carries the locate anchor and is
    // short enough to need no long-prose toggle; the EARLIER step's long prose
    // stays folded inside the process group.
    const answer = document.querySelector('.chat-flow-answer') as HTMLElement
    expect(answer.textContent).toContain(`可见 ${hiddenNeedle}`)
    expect(answer.querySelector('.chat-msg-toggle')).toBeNull()
    expect(document.querySelectorAll('.chat-md-body')).toHaveLength(1)
    const group = document.querySelector('.chat-proc') as HTMLElement
    const groupHead = group.querySelector('.chat-proc-head') as HTMLButtonElement
    expect(groupHead.getAttribute('aria-expanded')).toBe('false')

    // Expanding the group renders the earlier step's long prose force-opened
    // (the locate focus): the whole 6000+ char run plus the 收起 toggle.
    fireEvent.click(groupHead)
    const narration = group.querySelector('.chat-flow-text[data-part-id="text-0"]') as HTMLElement
    expect(narration.textContent!.length).toBeGreaterThan(LONG_TEXT_LIMIT)
    expect(narration.querySelector('.chat-msg-toggle')!.textContent).toBe('收起')
  })

  it('counts elapsed on HOST time so device NTP skew does not drift the clock', async () => {
    // Host clock anchors the turn (60s logged). Over a public link the phone
    // typically runs a few seconds different from the host clock; a live
    // content frame's host timestamp calibrates the skew so the running
    // clock matches the desktop instead of drifting.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(T0)
      loadChatPageMock.mockResolvedValue(runningTurnPage(T0 - 60_000, T0 - 59_000))
      historyMock.mockResolvedValue({ events: [], hasMore: false } as HistoryPage)
      const mux = new FakeMux()
      render(<ChatView session={{ ...session, running: true }} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
      await flushPageLoad()
      // Anchor from the page: 60s elapsed on the (uncalibrated) phone clock.
      expect(procTime()).toBe('用时1分0秒')
      // The host clock is 3s AHEAD of the phone: a live content frame
      // reports host time T0 + 3s (turn/start frames are excluded from the
      // calibration, content frames are not).
      emitSessionFrame(mux, 'assistant/chunk', 80, T0 + 3_000, {
        turn: 0,
        step: 0,
        chunk: { type: 'text-delta', index: 0, text: '继续' },
      })
      await settleLiveFold()
      // 校准后立刻重算：60s 锚点 + 3s 宿主超前 = 1分3秒。
      expect(procTime()).toBe('用时1分3秒')
      // One tick later (fake now advanced 1s): elapsed counts on HOST time,
      // exactly what the desktop would show (1分4秒) - not the phone's
      // fast/slow guess.
      act(() => { vi.advanceTimersByTime(1_000) })
      expect(procTime()).toBe('用时1分4秒')
    } finally {
      vi.useRealTimers()
    }
  })

  it('formats multi-minute turns like the desktop label (Xm Ys)', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('还没有消息，发一句话开始吧')
    vi.useFakeTimers()
    try {
      vi.setSystemTime(T0)
      emitTurnStart(mux, 60, T0 - 95_000)
      emitChunk(mux, 61, T0)
      await settleLiveFold()
      expect(procTime()).toBe('用时1分35秒')
    } finally {
      vi.useRealTimers()
    }
  })

  it('真机形状：回合中途被按步定格的行读到"深度求索中"，turn/end 一到立刻回到"已完成"', async () => {
    // 17:52 那一轮：宿主按步发 assistant/message ⇒ 行落在 DOM 里就已经
    // pending:false，而且它的最后一个工具（运行命令 · Recompile Debug.c）也早就
    // 返回了（tool/result ⇒ state:'ok'）。行内没有任何"还在跑"的痕迹，只有
    // ChatView 的活跃轮次（turn/start 帧给的轮号）能证明这一轮还开着。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('还没有消息，发一句话开始吧')

    vi.useFakeTimers()
    try {
      vi.setSystemTime(T0)
      // 回合 7 在 30 秒前就开了（turn/start 帧带轮号）；此后每一帧的宿主时间都是
      // "现在"（帧时间会校准钟差，只有 turn/start 被排除在校准之外）。
      emitTurnStart(mux, 60, T0 - 30_000, 7)
      emitSessionFrame(mux, 'assistant/message', 61, T0, {
        turn: 7,
        step: 0,
        message: { id: 'a-7', role: 'assistant', content: [{ type: 'text', text: '先看结构' }] },
      })
      emitSessionFrame(mux, 'tool/call', 62, T0, {
        turn: 7, step: 0, callId: 'c7', name: 'bash', arguments: '{"cmd":"Recompile Debug.c"}',
      })
      emitSessionFrame(mux, 'tool/result', 63, T0, {
        turn: 7, step: 0, message: { source: { callId: 'c7' } },
      })
      await settleLiveFold()

      // 底部状态行说这一轮还在跑（它就是 running 渲染出来的）……
      expect(turnStatusEl().textContent).toBe('输出中')
      // ……折叠头就不许写"已完成"：状态词是运行中，秒表也照报（行自己没有
      // turnStartAt，靠页级锚点兜住）。
      const head = lastProcHead()
      expect(head.closest('.chat-proc')!.className).toContain('chat-proc-running')
      expect(procStateOf(head)).toBe('深度求索中')
      expect(procTime(head)).toBe('用时30秒')
      expect(head.querySelector('.chat-proc-current-text')!.textContent).toBe('思考中')

      // turn/end 到了：活跃轮次一变，同一条定格行立刻回到"已完成"，秒表定格。
      emitSessionFrame(mux, 'turn/end', 64, T0, { turn: 7, reason: { kind: 'ok' } })
      await settleLiveFold()
      expect(turnStatusEl()).toBeNull()
      const settled = lastProcHead()
      expect(settled.closest('.chat-proc')!.className).not.toContain('chat-proc-running')
      expect(procStateOf(settled)).toBe('已完成')
      // 旧期望值 '用时30秒 · 1 步' → P11 新口径：卡面不带步数。
      expect(procTime(settled)).toBe('用时30秒')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ChatView blank-session revocation', () => {
  const blankSession: SessionView = { ...session, blank: true }

  it('revokes a blank session on back: confirms empty, archives, drops caches', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    historyMock.mockResolvedValue({ events: [], hasMore: false } as HistoryPage)
    // A previous visit cached the roster row (the just-created session).
    sessionListCache.set('w-1', {
      rows: [{ sessionId: 's-1', title: '新会话', updatedAt: 1, running: false, blank: true }],
      hasMore: false,
      at: Date.now(),
    })
    const onBack = vi.fn()
    render(<ChatView session={blankSession} onBack={onBack} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    // Probe: the back handler itself must have run.
    expect(onBack).toHaveBeenCalled()
    await waitFor(() => {
      // The host tail is probed (1 message, no signal — the back path has
      // no abort source) before archiving…
      expect(historyMock).toHaveBeenCalledWith('s-1', undefined, 1)
      // …and the empty session is archived (revoked).
      expect(archiveSessionApiMock).toHaveBeenCalledWith('s-1')
    })
    // The cached roster row is gone synchronously — the returning list
    // never flashes the revoked session.
    expect(sessionListCache.get('w-1')?.rows).toEqual([])
  })

  it('keeps a session that already rendered messages', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={blankSession} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')

    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(historyMock).not.toHaveBeenCalled()
    expect(archiveSessionApiMock).not.toHaveBeenCalled()
  })

  it('keeps a session whose host tail has content (in-flight echo not yet rendered)', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    historyMock.mockResolvedValue(historyPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '刚发的' }] }, 1),
    ]))
    render(<ChatView session={blankSession} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    await waitFor(() => expect(historyMock).toHaveBeenCalled())
    // The probe found a message: the session survives.
    expect(archiveSessionApiMock).not.toHaveBeenCalled()
  })
})

describe('ChatView composer draft persistence', () => {
  const textarea = (): HTMLTextAreaElement => screen.getByRole('textbox') as HTMLTextAreaElement

  it('restores the draft after leaving and re-entering the session', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const first = render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    fireEvent.change(textarea(), { target: { value: '未写完的草稿' } })
    // Leaving the chat unmounts the view: the draft flushes immediately.
    first.unmount()
    // Re-entering the same session restores it.
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    expect(textarea().value).toBe('未写完的草稿')
  })

  it('clears the persisted draft once the prompt is sent', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    promptMock.mockResolvedValue(undefined)
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    fireEvent.change(textarea(), { target: { value: '要发送的' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(promptMock).toHaveBeenCalled())
    // The emptied input removes the draft (debounce effect runs on commit).
    expect(loadDraft('s-1')).toBe('')
  })

  it('persists the draft after the debounce window while typing', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    vi.useFakeTimers()
    try {
      fireEvent.change(textarea(), { target: { value: '打字中的草稿' } })
      // Before the debounce elapses nothing is written…
      expect(loadDraft('s-1')).toBe('')
      await vi.advanceTimersByTimeAsync(1_500)
      // …after it, the draft is persisted.
      expect(loadDraft('s-1')).toBe('打字中的草稿')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ChatView approval panel', () => {
  it('never re-shows an approval this phone already answered when the session is re-entered', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const ghost = { rpcId: 'rpc-ap-1', approvalId: 'ap-1', toolName: 'bash', reason: '写入文件' }
    // The host's pending tracker still serves the answered approval: this poll
    // result is what put the panel back on screen after the remount.
    fetchPendingMock.mockResolvedValue({ approvals: [ghost], questions: [] })
    const running = { ...session, running: true }
    const first = render(<ChatView session={running} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    fireEvent.click(await screen.findByRole('button', { name: '允许一次' }))
    await waitFor(() => { expect(respondApprovalMock).toHaveBeenCalledTimes(1) })
    await waitFor(() => { expect(screen.queryByRole('button', { name: '允许一次' })).toBeNull() })

    // Leave the session and come back: a fresh ChatView against the same host.
    first.unmount()
    render(<ChatView session={running} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await waitFor(() => { expect(fetchPendingMock.mock.calls.length).toBeGreaterThanOrEqual(2) })
    // Let the poll's resolved value land before asserting the panel is absent.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(screen.queryByRole('button', { name: '允许一次' })).toBeNull()
  })
})

it('shows the command a pending approval would run', async () => {
  // 宿主帧只带工具名：用户点「允许一次」时必须看得见要执行的命令。
  loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
  fetchPendingMock.mockResolvedValue({
    approvals: [{ rpcId: 'rpc-ap-2', approvalId: 'ap-2', toolName: 'bash', callId: 'c1', reason: '执行命令' }],
    questions: [],
  })
  render(<ChatView session={{ ...session, running: true }} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
  await waitFor(() => {
    expect(document.querySelector('.chat-approval-preview')?.textContent).toBe('ls')
  })
})


describe('ChatView question panel', () => {
  it('never re-shows a question batch this phone already answered when the session is re-entered', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const ghost = { rpcId: 'rpc-ask-1', id: 'q1', question: '选哪个？', options: [{ label: 'A' }] }
    // Same ghost shape as the approval panel: the poll still serves the batch.
    fetchPendingMock.mockResolvedValue({ approvals: [], questions: [ghost] })
    const running = { ...session, running: true }
    const first = render(<ChatView session={running} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    fireEvent.click(await screen.findByRole('radio', { name: 'A' }))
    fireEvent.click(screen.getByRole('button', { name: '提交回答' }))
    await waitFor(() => { expect(respondQuestionMock).toHaveBeenCalledTimes(1) })
    await waitFor(() => { expect(screen.queryByRole('button', { name: '提交回答' })).toBeNull() })

    // Leave the session and come back: a fresh ChatView against the same host.
    first.unmount()
    render(<ChatView session={running} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await waitFor(() => { expect(fetchPendingMock.mock.calls.length).toBeGreaterThanOrEqual(2) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(screen.queryByRole('button', { name: '提交回答' })).toBeNull()
  })
})


describe('ChatView queue-while-running (composer primary)', () => {
  // 桌面的规则：草稿为空才把主键让给"停止"；有草稿时主键是"发送"，走排队。手机端
  // 曾经运行中一律变停止，于是回合进行中根本没有把消息排队的入口。
  const typeDraft = (text: string): void => {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
  }

  it('keeps send primary while running and names the queued delivery', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    // toast 文本只有 ToastHost 渲染（模块级 store），单挂 ChatView 看不到回执。
    render(
      <>
        <ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />
        <ToastHost />
      </>,
    )
    await screen.findByRole('button', { name: '发送' })

    emitSessionEvent(mux, 'turn/start', 1)
    // 空草稿：主键仍是停止。
    expect((await screen.findByRole('button', { name: '停止' })) as HTMLButtonElement).toBeTruthy()

    // 有草稿：主键变成"排队发送"，且停止退成旁边的小键，仍然可达。
    typeDraft('再补一句')
    const queued = (await screen.findByRole('button', { name: '排队发送' })) as HTMLButtonElement
    expect(queued.disabled).toBe(false)
    expect(screen.getByRole('button', { name: '停止' })).toBeTruthy()

    fireEvent.click(queued)
    // 整套跑时别的文件在编译，1 秒的默认上限会被挤爆（实测 1.1~1.2 秒才到）；
    // 断言本身与时长无关，这里给足 6 秒。
    await waitFor(() => { expect(promptMock).toHaveBeenCalledWith('s-1', [{ type: 'text', text: '再补一句' }]) }, { timeout: 6000 })
    // 排队要有回执，否则用户以为消息丢了。
    expect(await screen.findByText('已排队，本轮结束后自动发送')).toBeTruthy()

    // 发完草稿被清空：主键自动回到停止。
    await waitFor(() => { expect(screen.queryByRole('button', { name: '排队发送' })).toBeNull() }, { timeout: 6000 })
    expect(screen.getByRole('button', { name: '停止' })).toBeTruthy()
  })

  it('does not pop a receipt for a command that succeeds, and waits before saying 正在执行', async () => {
    // 真机：`/goal 再做一次假测试` 一按下去，先闪一条「正在执行 /goal…」，紧接着一整段
    // 「Goal created Status: active Objective: … Rounds… Commands…」把目标条糊住。
    // 会话里那张命令卡就是回执；这里只留慢网的兜底提示。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    sendCommandMock.mockResolvedValue({ matched: true, text: 'Goal created Status: active Objective: 再做一个假测试' })
    render(
      <>
        <ChatView session={session} mux={new FakeMux() as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />
        <ToastHost />
      </>,
    )
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '/goal 再做一个假测试' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => { expect(sendCommandMock).toHaveBeenCalled() })
    // 快命令：既不弹「正在执行」，也不弹宿主的整段回执。
    expect(screen.queryByText(/正在执行/)).toBeNull()
    expect(screen.queryByText(/Goal created Status/)).toBeNull()
    sendCommandMock.mockResolvedValue({ matched: true })
  })

  it('still surfaces the host text when the command itself failed', async () => {
    // 静默成功回执时别把失败也静默掉：参数错了要看见原因。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    sendCommandMock.mockResolvedValue({ matched: true, kind: 'error', text: '/goal 需要一个目标描述' })
    render(
      <>
        <ChatView session={session} mux={new FakeMux() as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />
        <ToastHost />
      </>,
    )
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '/goal' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(await screen.findByText('/goal 需要一个目标描述')).toBeTruthy()
    sendCommandMock.mockResolvedValue({ matched: true })
  })

  it('still explains a slow command after 1.2s so the tap is never silent', async () => {
    // 慢网兜底：1.2 秒还没回话，才提示"正在执行"，避免用户以为没点上。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    sendCommandMock.mockReturnValue(new Promise(() => {}) as never)
    render(
      <>
        <ChatView session={session} mux={new FakeMux() as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />
        <ToastHost />
      </>,
    )
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '/compact' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => { expect(sendCommandMock).toHaveBeenCalled() })
    expect(screen.queryByText(/正在执行/)).toBeNull()
    expect(await screen.findByText('正在执行 /compact…', undefined, { timeout: 3000 })).toBeTruthy()
    sendCommandMock.mockResolvedValue({ matched: true })
  })

  it('does not claim a queue receipt when the turn only starts after the send', async () => {
    // 宿主接单后立刻开新回合：turn/start 帧常常比 prompt 的 resolve 先到。判据若在回调
    // 里读 running，就永远是"已排队"——用户明明没在跑任何回合，却被通知排队。
    loadChatPageMock.mockResolvedValue(rowPage([]))
    let resolvePrompt: (() => void) | undefined
    promptMock.mockReturnValue(new Promise<void>((resolve) => { resolvePrompt = () => { resolve() } }))
    const mux = new FakeMux()
    render(
      <>
        <ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />
        <ToastHost />
      </>,
    )
    await screen.findByRole('button', { name: '发送' })
    // toast 是模块级 store（2.2 秒才消退），上一条用例的回执可能还活着：先等它过期，
    // 否则这条断言测的是别人的吐司，而不是本次发送。
    await waitFor(() => { expect(screen.queryByText('已排队，本轮结束后自动发送')).toBeNull() }, { timeout: 8000 })

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '正常发一条' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    emitSessionEvent(mux, 'turn/start', 1)
    await act(async () => { resolvePrompt?.() })

    await waitFor(() => { expect(promptMock).toHaveBeenCalled() }, { timeout: 6000 })
    expect(screen.queryByText('已排队，本轮结束后自动发送')).toBeNull()
    promptMock.mockResolvedValue(undefined)
  })

  it('lets the mini stop button cancel the turn while a draft is queued', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    emitSessionEvent(mux, 'turn/start', 1)
    typeDraft('排队中')
    // 停止是两拍：第一拍只把按钮变成「确认停止」（2.5 秒不动自动收回）。
    fireEvent.click(await screen.findByRole('button', { name: '停止' }))
    expect(cancelSessionMock).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: '确认停止' }))
    await waitFor(() => { expect(cancelSessionMock).toHaveBeenCalledWith('s-1') })
    // 停止之后主键立刻回来，草稿还在（用户没发送，只是叫停）。
    expect(promptMock).not.toHaveBeenCalled()
  })
})

describe('ChatView 上一轮卡片保持', () => {
  it('keeps the previous card after the user sends the next message', async () => {
    // 真机：「发送完当前消息之后，上一条消息的交付物卡片会消失」。发送后新回合的
    // turn/start 还没到，活跃轮次的兜底用「最后出现的一轮」—— 那正好是刚刚收工的
    // 上一轮，它的卡被当成"这轮还在跑"藏了起来。收工的轮不能再算活跃。
    const withTurn = {
      rows: [
        { id: 'u-1', kind: 'user', text: '改一个文件', seq: 0, time: 0 },
        {
          id: 'a-1',
          kind: 'assistant',
          text: '好了',
          seq: 2,
          time: 2_000,
          turn: 4,
          tools: [{ callId: 'c1', name: 'edit', state: 'ok' }],
        },
      ],
      maxSeq: 5,
      hasMore: false,
    } as unknown as ChatPageResult
    loadChatPageMock.mockResolvedValue(withTurn)
    historyMock.mockResolvedValue(historyPage([
      makeEntry('turn/start', { turn: 4 }, 1),
      makeEntry('tool/call', { turn: 4, step: 0, callId: 'c1', name: 'edit', arguments: '{"file_path":"one.ts"}' }, 2),
      makeEntry('tool/result', {
        turn: 4,
        step: 0,
        message: { source: { callId: 'c1' } },
        meta: { path: 'one.ts', diffs: [{ path: 'one.ts', oldText: 'a', newText: 'b' }] },
      }, 3),
      makeEntry('turn/end', { turn: 4 }, 9),
    ]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await waitFor(() => {
      expect(document.querySelector('.chat-turn-tail')?.textContent ?? '').toContain('one.ts')
    })
    // 上一轮亲眼收工（turn/end 帧），随后用户发下一条：此时还没有新一轮的边界帧。
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('turn/end', { turn: 4 }, 10).event })
    })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '再改一个' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => { expect(promptMock).toHaveBeenCalled() })
    await act(async () => { await Promise.resolve() })
    expect(document.querySelector('.chat-turn-tail')?.textContent ?? '').toContain('one.ts')
  })
})
describe('ChatView 进会话只画一次', () => {
  it('commits the whole opened history in one go instead of page by page', async () => {
    // 真机：「一进会话就闪烁几下」。铺开是 5 次分页读取，以前每页落地都整份换列表 +
    // 滚动校正一次；现在拉完再提交一次。这条盯的就是"行数只跳一次"。
    // 每页给一点延迟、内容各不相同：真机上这 5 页本来就是分开回来的，也只有让
    // 行数真的随页增长，才看得出中间到底提交了几次。
    let pageNo = 0
    loadChatPageMock.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
      pageNo += 1
      return {
        rows: [
          { id: `u-${pageNo}`, kind: 'user', text: `更早的第 ${pageNo} 问`, seq: pageNo * 100, time: 0 },
          {
            id: `a-${pageNo}`,
            kind: 'assistant',
            text: `更早的第 ${pageNo} 答`,
            seq: pageNo * 100 + 1,
            time: 1,
            turn: pageNo,
            tools: [{ callId: `c${pageNo}`, name: 'read', state: 'ok' }],
          },
        ],
        maxSeq: pageNo * 100 + 1,
        hasMore: true,
      } as unknown as ChatPageResult
    })
    const seen: number[] = []
    const timer = setInterval(() => {
      const count = document.querySelectorAll('.chat-msg').length
      if (seen.at(-1) !== count) seen.push(count)
    }, 10)
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('更早的第 5 问', undefined, { timeout: 3000 })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)) })
    clearInterval(timer)
    expect(loadChatPageMock.mock.calls.length).toBe(5)
    // 骨架 → 首屏 → 铺开完：只允许两三次高度变化，不能再"一页一跳"。
    expect(seen.length).toBeLessThanOrEqual(3)
  })
})
describe('ChatView 再进会话第一帧就有内容', () => {
  it('paints the previous rows synchronously instead of an empty frame', async () => {
    // 真机：「一进会话就会刷新闪烁一下」。那一帧是空的：缓存页要读 IndexedDB，网络页
    // 还要一个往返，屏幕先空、再内容。本次运行里打开过的会话走内存快照，第一帧就有
    // 内容 —— 用例把网络页压住不返回，只允许快照顶上。
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    const first = render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    first.unmount()
    // 再进来：网络页一直不返回。
    scrollHeightMock = 900
    clientHeightMock = 600
    loadChatPageMock.mockReturnValue(new Promise<ChatPageResult>(() => {}))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    // 同步断言：不给 await，第一帧就必须已经有内容。
    expect(document.querySelectorAll('.chat-msg').length).toBeGreaterThan(0)
    expect(screen.queryByText('加载中…')).toBeNull()
    // 而且第一帧就贴在最新一条上，不是停在顶部。
    expect(scrollWrites.at(-1)).toBe(900)
  })

  it('still shows the loading line for a session that was never opened', async () => {
    loadChatPageMock.mockReturnValue(new Promise<ChatPageResult>(() => {}))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    expect(document.querySelectorAll('.chat-msg')).toHaveLength(0)
    expect(screen.getByText('加载中…')).toBeTruthy()
  })
})

describe('ChatView 拉历史不塌列表', () => {
  it('keeps the painted rows, cards and tool arguments when the page is leaner', async () => {
    // 白盒实测（同一套 jsdom 环境）：再进会话时宿主只回一段**窗口**（页比屏幕短）、
    // 工具参数被投影剥掉、报告行不带 —— 旧代码整份替换，列表从 6 行塌成 3 行、文字
    // 改动 6 处，屏幕上就是「拉历史的时候闪一下」。合并之后行数不变、零 DOM 改动。
    const mk = (n: number): Record<string, unknown> => ({
      id: `a-${n}`, kind: 'assistant', text: `第 ${n} 条`, seq: n * 2, time: n * 2_000, turn: n, step: 0,
      tools: [{ callId: `c${n}`, name: 'read', state: 'ok', arguments: `{"file_path":"f${n}.ts"}` }],
    })
    loadChatPageMock.mockResolvedValue({ rows: [0, 1, 2, 3, 4, 5].map(mk), maxSeq: 20, hasMore: false } as unknown as ChatPageResult)
    historyMock.mockResolvedValue(historyPage([]))
    const first = render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('第 5 条')
    expect(document.querySelectorAll('.chat-msg')).toHaveLength(6)
    first.unmount()
    // 再进来：页只回最后三条，且参数被剥掉。
    const leanRows = [3, 4, 5].map((n) => ({
      id: `a-${n}`, kind: 'assistant', text: `第 ${n} 条`, seq: n * 2, time: n * 2_000, turn: n, step: 0,
      tools: [{ callId: `c${n}`, name: 'read', state: 'ok' }],
    }))
    let land!: (value: ChatPageResult) => void
    loadChatPageMock.mockReturnValue(new Promise<ChatPageResult>(resolve => { land = resolve }))
    scrollHeightMock = 1_200
    clientHeightMock = 600
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    const list = document.querySelector('.chat-scroll') as HTMLElement
    let mutations = 0
    const observer = new MutationObserver(records => { mutations += records.length })
    observer.observe(list, { childList: true, subtree: true, characterData: true, attributes: true })
    await act(async () => { land({ rows: leanRows, maxSeq: 20, hasMore: false } as unknown as ChatPageResult); await Promise.resolve() })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)) })
    observer.disconnect()
    // 行数不塌、最早那条还在、一个字都没改。
    expect(document.querySelectorAll('.chat-msg')).toHaveLength(6)
    expect(document.body.textContent ?? '').toContain('第 0 条')
    expect(mutations).toBe(0)
  })
})

describe('ChatView 轮次条滑到早期的轮次', () => {
  it('pages back to a turn the outline does not cover instead of refusing', async () => {
    // 真机：「没法滑动历史轮次条到前面的轮次」。滑条轴按宿主最高轮次画（57 格），
    // 但手机上真正有行的只有最近两轮，宿主大纲也只覆盖最近一段 —— 松手时以前只弹
    // 一句「还没载入，往上滑加载历史」，一个请求都不发，滑条在早期轮次上是死的。
    // 现在按轮次号往回翻，翻到就定位。
    scrollHeightMock = 20_000
    clientHeightMock = 600
    loadChatPageMock.mockResolvedValueOnce(rowPage([
      makeEntry('assistant/message', {
        turn: 56,
        step: 0,
        message: { id: 'a-56', role: 'assistant', content: [{ type: 'text', text: '第 56 轮' }] },
      }, 100),
      makeEntry('assistant/message', {
        turn: 57,
        step: 0,
        message: { id: 'a-57', role: 'assistant', content: [{ type: 'text', text: '第 57 轮' }] },
      }, 110),
    ], { hasMore: true }))
    // 进会话的铺开链紧跟一页"没有更早的"就收尾，把手势之后的请求留给下面那条断言。
    loadChatPageMock.mockResolvedValueOnce(rowPage([], { hasMore: false }))
    historyMock.mockResolvedValue(historyPage([]))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('第 57 轮')
    await waitFor(() => { expect(loadChatPageMock.mock.calls.length).toBe(2) })
    // 滚离底部：轮次条出现。
    const scroller = document.querySelector('.chat-scroll')!
    userScroll(scroller, 5_000)
    const handle = await screen.findByRole('button', { name: '轮次导航：轻点开清单，按住拖动刮擦' })
    // jsdom 没有 pointer capture：补上，手势才会走完按下→拖动→松手。
    Object.defineProperty(handle, 'setPointerCapture', { value: () => {}, configurable: true })
    Object.defineProperty(handle, 'hasPointerCapture', { value: () => true, configurable: true })
    Object.defineProperty(handle, 'releasePointerCapture', { value: () => {}, configurable: true })
    let land!: (page: ChatPageResult) => void
    loadChatPageMock.mockReturnValueOnce(new Promise<ChatPageResult>(resolve => { land = resolve }))
    await act(async () => { fireEvent.pointerDown(handle, { pointerId: 1, clientX: 900 }) })
    await act(async () => { fireEvent.pointerMove(handle, { pointerId: 1, clientX: 2 }) })
    // 松手最左边 = 第 1 轮：必须发一次翻页，而不是弹「还没载入」了事。
    await act(async () => { fireEvent.pointerUp(handle, { pointerId: 1, clientX: 2 }) })
    await waitFor(() => { expect(loadChatPageMock.mock.calls.length).toBe(3) })
    expect(screen.queryByText(/还没载入/)).toBeNull()
    // 那一页回来：第 1 轮的行必须真的被定位（焦点高亮）。
    await act(async () => {
      land(rowPage([makeEntry('assistant/message', {
        turn: 1,
        step: 0,
        message: { id: 'a-t1', role: 'assistant', content: [{ type: 'text', text: '第 1 轮的开头' }] },
      }, 10)], { hasMore: false }))
    })
    await waitFor(() => {
      const row = document.querySelector('[data-message-id="a-t1"]')
      expect(row).not.toBeNull()
      expect(row?.classList.contains('chat-msg-focus')).toBe(true)
    })
  })
})

describe('ChatView 跳轮次落在提问那一行', () => {
  it('lands on the prompt, not the answer, when jumping to a turn', async () => {
    // 真机：「历史会话定位好像并不是很准」。带 turn 的行是 assistant 的回答行，问题在
    // 它上面一格 —— 只滚到回答行，等于把提问切在视口外，看着像跳晚了一轮。
    scrollHeightMock = 20_000
    clientHeightMock = 600
    loadChatPageMock.mockResolvedValueOnce(rowPage([
      makeEntry('user/message', { id: 'u-56', role: 'user', content: [{ type: 'text', text: '第 56 轮的问题' }] }, 99),
      makeEntry('assistant/message', {
        turn: 56,
        step: 0,
        message: { id: 'a-56', role: 'assistant', content: [{ type: 'text', text: '第 56 轮的回答' }] },
      }, 100),
      makeEntry('user/message', { id: 'u-57', role: 'user', content: [{ type: 'text', text: '第 57 轮的问题' }] }, 109),
      makeEntry('assistant/message', {
        turn: 57,
        step: 0,
        message: { id: 'a-57', role: 'assistant', content: [{ type: 'text', text: '第 57 轮的回答' }] },
      }, 110),
    ], { hasMore: false }))
    historyMock.mockResolvedValue(historyPage([]))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('第 57 轮的回答')
    const scroller = document.querySelector('.chat-scroll')!
    userScroll(scroller, 5_000)
    const handle = await screen.findByRole('button', { name: '轮次导航：轻点开清单，按住拖动刮擦' })
    Object.defineProperty(handle, 'setPointerCapture', { value: () => {}, configurable: true })
    Object.defineProperty(handle, 'hasPointerCapture', { value: () => true, configurable: true })
    Object.defineProperty(handle, 'releasePointerCapture', { value: () => {}, configurable: true })
    // 轻点打开轮次清单（不移动 = 点击）。
    await act(async () => { fireEvent.pointerDown(handle, { pointerId: 1, clientX: 900 }) })
    await act(async () => { fireEvent.pointerUp(handle, { pointerId: 1, clientX: 900 }) })
    // 轮次清单里点最上面那条 = 第 56 轮。jsdom 里 `role=listitem` 的可及名不稳，
    // 直接按行元素点。
    await waitFor(() => { expect(document.querySelectorAll('.turn-row').length).toBe(2) })
    const item = document.querySelectorAll('.turn-row')[0] as HTMLElement
    await act(async () => { fireEvent.click(item) })
    await waitFor(() => {
      expect(document.querySelector('[data-message-id="u-56"]')?.classList.contains('chat-msg-focus')).toBe(true)
    })
    expect(document.querySelector('[data-message-id="a-56"]')?.classList.contains('chat-msg-focus')).toBe(false)
    // 滑条读数跟着走：退到提问行之后别把"当前轮次"留在上一轮。
    expect(document.querySelector('.chat-jump-turns-label')?.textContent ?? '').toContain('56/')
  })
  it('跳轮次的落点 = 提问行的真实几何，连跳两次不累积偏差', async () => {
    // 以前窗口化时落点要用"前缀和估算"换算，跳一次偏几十像素、连跳越偏越多。
    // 行全渲染之后落点只由那一行的 rect 决定：1234 − 8 = 1226，再跳一轮
    // 2100 − 8 = 2092 —— 与上一次跳到哪儿无关。
    scrollHeightMock = 20_000
    clientHeightMock = 600
    loadChatPageMock.mockResolvedValueOnce(rowPage([
      makeEntry('user/message', { id: 'u-56', role: 'user', content: [{ type: 'text', text: '第 56 轮的问题' }] }, 99),
      makeEntry('assistant/message', {
        turn: 56,
        step: 0,
        message: { id: 'a-56', role: 'assistant', content: [{ type: 'text', text: '第 56 轮的回答' }] },
      }, 100),
      makeEntry('user/message', { id: 'u-57', role: 'user', content: [{ type: 'text', text: '第 57 轮的问题' }] }, 109),
      makeEntry('assistant/message', {
        turn: 57,
        step: 0,
        message: { id: 'a-57', role: 'assistant', content: [{ type: 'text', text: '第 57 轮的回答' }] },
      }, 110),
    ], { hasMore: false }))
    historyMock.mockResolvedValue(historyPage([]))
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')
    const rect = (top: number, height: number): DOMRect => ({
      top, bottom: top + height, left: 0, right: 390, width: 390, height,
      x: 0, y: top, toJSON: () => ({}),
    } as DOMRect)
    // 每行在"内容坐标"里的真实位置；读 rect 时减去当前 scrollTop。
    const at: Array<[string, number]> = [['u-56', 1_234], ['a-56', 1_400], ['u-57', 2_100], ['a-57', 2_200]]
    Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: Element) {
        const scroller = document.querySelector('.chat-scroll') as HTMLElement | null
        const shift = scroller?.scrollTop ?? 0
        if (scroller !== null && this === scroller) return rect(0, 600)
        for (const [id, top] of at) {
          if (this.closest !== undefined && this.closest(`[data-message-id="${id}"]`) !== null) return rect(top - shift, 100)
        }
        return rect(0, 0)
      },
    })
    try {
      render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
      await screen.findByText('第 57 轮的回答')
      // 轮次把手只在"读者离开了底部"之后出现（滑条不是给贴着底的人用的）。
      fireEvent.scroll(document.querySelector('.chat-scroll')!, { target: { scrollTop: 5_000 } })
      const handle = await screen.findByRole('button', { name: '轮次导航：轻点开清单，按住拖动刮擦' })
      Object.defineProperty(handle, 'setPointerCapture', { value: () => {}, configurable: true })
      Object.defineProperty(handle, 'hasPointerCapture', { value: () => true, configurable: true })
      Object.defineProperty(handle, 'releasePointerCapture', { value: () => {}, configurable: true })
      const jumpTo = async (row: number): Promise<void> => {
        await act(async () => { fireEvent.pointerDown(handle, { pointerId: 1, clientX: 900 }) })
        await act(async () => { fireEvent.pointerUp(handle, { pointerId: 1, clientX: 900 }) })
        await waitFor(() => { expect(document.querySelectorAll('.turn-row').length).toBeGreaterThan(row) })
        await act(async () => { fireEvent.click(document.querySelectorAll('.turn-row')[row] as HTMLElement) })
      }
      await jumpTo(0)
      await waitFor(() => { expect(scrollWrites).toContain(1_226) })
      await jumpTo(1)
      await waitFor(() => { expect(scrollWrites).toContain(2_092) })
      // 连跳之后落点仍在留白上：偏差不累积。
      const top = (document.querySelector('[data-message-id="u-57"]') as HTMLElement).getBoundingClientRect().top
      expect(Math.abs(top - 8)).toBeLessThanOrEqual(2)
    } finally {
      if (original !== undefined) Object.defineProperty(Element.prototype, 'getBoundingClientRect', original)
      else delete (Element.prototype as unknown as Record<string, unknown>)['getBoundingClientRect']
    }
  })
})
describe('ChatView 会话内搜索（期 3）', () => {
  it('按词查询后计数按 seq 升序走，下一个/上一个循环', async () => {
    loadChatPageMock.mockResolvedValueOnce(rowPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '你好，这里是支付专项' }] }, 1),
    ], { hasMore: false }))
    historyMock.mockResolvedValue(historyPage([]))
    // 命中在窗口外时按目标 seq 取那一页；计数只在真正落地后才前进，所以这些页必须
    // 带回目标行 —— 空页等于没落地（计数不动是对的），但那样就测不到「按 seq 升序走」。
    loadChatPageMock.mockResolvedValue(rowPage([
      makeEntry('assistant/message', { id: 'a-10', role: 'assistant', content: [{ type: 'text', text: '前面这条支付' }] }, 10),
      makeEntry('assistant/message', { id: 'a-40', role: 'assistant', content: [{ type: 'text', text: '后面这条支付' }] }, 40),
    ], { hasMore: false }))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText(/你好/)
    fireEvent.click(screen.getByRole('button', { name: '搜索本会话' }))
    const input = screen.getByPlaceholderText('搜索本会话…')
    searchSessionsMock.mockResolvedValue({
      items: [
        { kind: 'message', sessionId: 's-1', seq: 40, snippet: '…后面这条支付…' },
        { kind: 'message', sessionId: 's-1', seq: 10, snippet: '…前面这条支付…' },
      ],
      total: 2,
      hasMore: false,
      tookMs: 1,
    })
    fireEvent.change(input, { target: { value: '支付' } })
    await waitFor(() => { expect(screen.getByText('1/2')).toBeTruthy() })
    expect(searchSessionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: '支付', sessionId: 's-1' }),
      expect.anything(),
    )
    fireEvent.click(screen.getByRole('button', { name: '下一个' }))
    await waitFor(() => { expect(screen.getByText('2/2')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: '下一个' }))
    await waitFor(() => { expect(screen.getByText('1/2')).toBeTruthy() })
  })

  it('跳到的命中行要能看出来：整行脉冲 + 词级高亮', async () => {
    loadChatPageMock.mockResolvedValueOnce(rowPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '你好' }] }, 1),
      makeEntry('assistant/message', { id: 'a-10', role: 'assistant', content: [{ type: 'text', text: '这里有一条支付专项记录' }] }, 10),
    ], { hasMore: false }))
    historyMock.mockResolvedValue(historyPage([]))
    loadChatPageMock.mockResolvedValue(rowPage([], { hasMore: false }))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText(/这里有一条支付专项记录/)
    fireEvent.click(screen.getByRole('button', { name: '搜索本会话' }))
    searchSessionsMock.mockResolvedValue({
      items: [{ kind: 'message', sessionId: 's-1', seq: 10, snippet: '…支付专项…' }],
      total: 1,
      hasMore: false,
      tookMs: 1,
    })
    fireEvent.change(screen.getByPlaceholderText('搜索本会话…'), { target: { value: '支付' } })
    // 词级高亮：跳到的那一行里「支付」被 <mark> 出来（真机反馈「没有高亮显示」）。
    await waitFor(() => {
      expect(document.querySelector('.chat-search-mark')?.textContent).toBe('支付')
    })
    // 整行脉冲：定位到的行挂 chat-msg-focus。
    expect(document.querySelector('[data-message-id="a-10"]')?.classList.contains('chat-msg-focus')).toBe(true)
  })
  it('命中只认正文：推理链里写着同样的词也不高亮、不展开', async () => {
    loadChatPageMock.mockResolvedValueOnce(rowPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '改一下代码' }] }, 1),
      makeEntry('assistant/message', {
        id: 'a-20',
        role: 'assistant',
        content: [
          { type: 'reasoning', text: '先看结构，再决定改支付这段' },
          { type: 'text', text: '已完成修改' },
        ],
      }, 20),
    ], { hasMore: false }))
    historyMock.mockResolvedValue(historyPage([]))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText(/已完成修改/)
    fireEvent.click(screen.getByRole('button', { name: '搜索本会话' }))
    searchSessionsMock.mockResolvedValue({
      items: [{ kind: 'message', sessionId: 's-1', seq: 20, snippet: '…支付…' }],
      total: 1,
      hasMore: false,
      tookMs: 1,
    })
    fireEvent.change(screen.getByPlaceholderText('搜索本会话…'), { target: { value: '支付' } })
    // 索引只收正文答案，推理链不该成为命中：不画标记、也不替用户展开。
    await waitFor(() => { expect(screen.getByText('1/1')).toBeTruthy() })
    expect(document.querySelectorAll('.chat-search-mark')).toHaveLength(0)
    expect(document.querySelector('.chat-think-body')).toBeNull()
    expect(document.querySelector('.chat-think')?.textContent ?? '').not.toContain('支付')
  })
  it('命中在窗口外时，点「下一个」会真的换成下一条的目标页', async () => {
    loadChatPageMock.mockResolvedValueOnce(rowPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '你好' }] }, 1),
    ], { hasMore: true }))
    historyMock.mockResolvedValue(historyPage([]))
    // 每页都回空页收尾：本用例只关心"请求了哪一页"，不关心落地。
    loadChatPageMock.mockResolvedValue(rowPage([], { hasMore: false }))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText(/你好/)
    fireEvent.click(screen.getByRole('button', { name: '搜索本会话' }))
    searchSessionsMock.mockResolvedValue({
      items: [
        { kind: 'message', sessionId: 's-1', seq: 90, snippet: '…远处的另一处…' },
        { kind: 'message', sessionId: 's-1', seq: 40, snippet: '…远处的一处…' },
      ],
      total: 2,
      hasMore: false,
      tookMs: 1,
    })
    fireEvent.change(screen.getByPlaceholderText('搜索本会话…'), { target: { value: '支付' } })
    // 第一条（seq 40，升序排第一）：直接要「到 40 为止」那一页。
    await waitFor(() => { expect(loadChatPageMock).toHaveBeenCalledWith('s-1', 41, expect.anything(), undefined, undefined, 80) })
    fireEvent.click(screen.getByRole('button', { name: '下一个' }))
    // 第二条（seq 90）：必须换成 91，而不是继续停在同一页。
    await waitFor(() => { expect(loadChatPageMock).toHaveBeenCalledWith('s-1', 91, expect.anything(), undefined, undefined, 80) })
    // 这一页是空页（目标行没送到）：落点没变，计数器就不许前进 —— 数字先走、画面
    // 不动正是用户最早报的那条。
    await waitFor(() => { expect(screen.getByText('1/2')).toBeTruthy() })
  })
  it('宿主说索引还没建好时如实提示，不假装搜过', async () => {
    loadChatPageMock.mockResolvedValueOnce(rowPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '你好' }] }, 1),
    ], { hasMore: false }))
    historyMock.mockResolvedValue(historyPage([]))
    loadChatPageMock.mockResolvedValue(rowPage([], { hasMore: false }))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText(/你好/)
    fireEvent.click(screen.getByRole('button', { name: '搜索本会话' }))
    searchSessionsMock.mockResolvedValue({ items: [], total: 0, hasMore: false, tookMs: 0, fallback: true } as never)
    fireEvent.change(screen.getByPlaceholderText('搜索本会话…'), { target: { value: '支付' } })
    await waitFor(() => { expect(screen.getByText('索引建立中')).toBeTruthy() })
  })
  it('命中在窗口外时按目标 seq 直接要那一页（不按首页游标一页页往回翻）', async () => {
    loadChatPageMock.mockResolvedValueOnce(rowPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '你好' }] }, 1),
    ], { hasMore: true }))
    historyMock.mockResolvedValue(historyPage([]))
    loadChatPageMock.mockResolvedValue(rowPage([], { hasMore: false }))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText(/你好/)
    fireEvent.click(screen.getByRole('button', { name: '搜索本会话' }))
    searchSessionsMock.mockResolvedValue({
      items: [{ kind: 'message', sessionId: 's-1', seq: 40, snippet: '…远处的支付…' }],
      total: 1,
      hasMore: false,
      tookMs: 1,
    })
    fireEvent.change(screen.getByPlaceholderText('搜索本会话…'), { target: { value: '支付' } })
    // 命中 seq=40 不在窗口里：必须直接按 41 要那一页（page ENDS at beforeSeq）。
    await waitFor(() => {
      expect(loadChatPageMock).toHaveBeenCalledWith('s-1', 41, expect.anything(), undefined, undefined, 80)
    })
  })

  it('首页点进来：搜索框自动填词、计数对齐到点的那一处，可以直接按「下一个」', async () => {
    rememberLocateIntent({ sessionId: 's-1', seq: 20, messageId: 'a-20', query: '支付' })
    loadChatPageMock.mockResolvedValueOnce(rowPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '你好' }] }, 1),
      makeEntry('assistant/message', { id: 'a-10', role: 'assistant', content: [{ type: 'text', text: '第一处支付' }] }, 10),
      makeEntry('assistant/message', { id: 'a-20', role: 'assistant', content: [{ type: 'text', text: '第二处支付' }] }, 20),
    ], { hasMore: false }))
    historyMock.mockResolvedValue(historyPage([]))
    searchSessionsMock.mockResolvedValue({
      items: [
        { kind: 'message', sessionId: 's-1', seq: 20, messageId: 'a-20', snippet: '…第二处支付…' },
        { kind: 'message', sessionId: 's-1', seq: 10, messageId: 'a-10', snippet: '…第一处支付…' },
      ],
      total: 2,
      hasMore: false,
      tookMs: 1,
    })
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    // 不用点「搜索本会话」：意图里有词就自动打开并把词填进去。
    const input = await screen.findByPlaceholderText('搜索本会话…')
    await waitFor(() => { expect((input as HTMLInputElement).value).toBe('支付') })
    // 对齐到 messageId=a-20 那一处（升序第 2 条），而不是归 0 跳回第一处。
    await waitFor(() => { expect(screen.getByText('2/2')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: '下一个' }))
    await waitFor(() => { expect(screen.getByText('1/2')).toBeTruthy() })
    clearLocateIntent('s-1')
  })

  it('命中数被宿主截断时计数带「+」，不假装只有这么多', async () => {
    loadChatPageMock.mockResolvedValueOnce(rowPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '你好' }] }, 1),
      makeEntry('assistant/message', { id: 'a-10', role: 'assistant', content: [{ type: 'text', text: '这里有一条支付记录' }] }, 10),
    ], { hasMore: false }))
    historyMock.mockResolvedValue(historyPage([]))
    searchSessionsMock.mockResolvedValue({
      items: [
        { kind: 'message', sessionId: 's-1', seq: 10, messageId: 'a-10', snippet: '…支付…' },
        { kind: 'message', sessionId: 's-1', seq: 20, messageId: 'a-20', snippet: '…支付…' },
      ],
      total: 2,
      hasMore: true,
      tookMs: 1,
    })
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText(/你好/)
    fireEvent.click(screen.getByRole('button', { name: '搜索本会话' }))
    fireEvent.change(screen.getByPlaceholderText('搜索本会话…'), { target: { value: '支付' } })
    await waitFor(() => { expect(screen.getByText('1/2+')).toBeTruthy() })
  })
})

describe('loadTurnReportRows：按轮号读交付卡', () => {
  it('把日志里这些轮的 turn 行折出来（翻页时和页一起提交）', async () => {
    // history 里给两轮：第 5 轮带交付单、第 6 轮没有。只请求第 5 轮。
    historyMock.mockResolvedValueOnce(historyPage([
      makeEntry('turn/start', { turn: 5 }, 100),
      makeEntry('deliverables/presented', { turn: 5, files: [{ path: 'a.ts', description: '改了个文件' }] }, 101),
      makeEntry('assistant/message', { id: 'a5', role: 'assistant', content: [{ type: 'text', text: '做完了' }] }, 102),
      makeEntry('turn/end', { turn: 5 }, 103),
    ]))
    const rows = await loadTurnReportRows('s-1', [5])
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(row => row.kind === 'turn' && row.turn === 5)).toBe(true)
    expect(rows[0]?.deliverables?.[0]?.path).toBe('a.ts')
  })

  it('不请求任何轮号时一次网络都不发', async () => {
    historyMock.mockClear()
    expect(await loadTurnReportRows('s-1', [])).toEqual([])
    expect(historyMock).not.toHaveBeenCalled()
  })
})
