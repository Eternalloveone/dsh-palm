// @vitest-environment jsdom
/** ChatView: collapsible message folds, toolbar chips, and the bottom sheets. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionModels } from '@deepseek-ai/dsh-host-apiproxy/api/sessions'
import { ChatView, estimateMessageHeight, MAX_TAIL_BUFFER_EVENTS, RUNNING_RECONCILE_MS } from './ChatView.tsx'
import { LONG_TEXT_LIMIT } from '../markdown-text.tsx'
import { type SessionView, type ChatPageResult } from './App.tsx'
import type { HistoryPage, SessionPage } from '../api.ts'
import { EventFolder, foldEvents, latestTodoSnapshot } from '../messages.ts'
import type { RenderMessage, WireEvent } from '../messages.ts'
import { loadDraft, sessionListCache } from '../list-persist.ts'
import { RpcCallError } from '../rpc.ts'

// The api module is fully mocked; App.tsx's chat-page loader is overridden to
// feed fixed folded pages, its pure helpers (errorText / formatTime) stay real.
vi.mock('../api.ts', () => ({
  fetchMobilePreferences: vi.fn(),
  models: vi.fn(),
  selectModel: vi.fn(),
  sendCommand: vi.fn(),
  cancelSession: vi.fn(),
  fetchPending: vi.fn(),
  renameSession: vi.fn(),
  archiveSession: vi.fn(async () => ({ archivedSessionIds: [] })),
  listSessions: vi.fn(),
  history: vi.fn(),
  subagentsList: vi.fn(),
  updateQueue: vi.fn(async () => {}),
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
import { archiveSession as archiveSessionApiMock, fetchMobilePreferences, models, selectModel, sendCommand, cancelSession, fetchPending, listSessions, history, subagentsList, updateQueue as updateQueueMock } from '../api.ts'
import { loadChatPage, prompt } from './App.tsx'
import { startVoiceRecording, voiceSupported, type VoiceRecording } from '../voice-input.ts'
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

const fetchMobilePreferencesMock = vi.mocked(fetchMobilePreferences)
const modelsMock = vi.mocked(models)
const selectModelMock = vi.mocked(selectModel)
const sendCommandMock = vi.mocked(sendCommand)
const cancelSessionMock = vi.mocked(cancelSession)
const fetchPendingMock = vi.mocked(fetchPending)
const listSessionsMock = vi.mocked(listSessions)
const historyMock = vi.mocked(history)
const loadChatPageMock = vi.mocked(loadChatPage)
const subagentsListMock = vi.mocked(subagentsList)
const promptMock = vi.mocked(prompt)
const startVoiceRecordingMock = vi.mocked(startVoiceRecording)
const voiceSupportedMock = vi.mocked(voiceSupported)
const removeOutboxForSessionMock = vi.mocked(removeOutboxForSession)
const listOutboxMock = vi.mocked(listOutbox)
const removeFromOutboxMock = vi.mocked(removeFromOutbox)

beforeEach(() => {
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
  cancelSessionMock.mockResolvedValue({ accepted: true })
  fetchPendingMock.mockResolvedValue({ approvals: [], questions: [] })
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
  localStorage.clear()
})

describe('ChatView message folds', () => {
  it('hides reasoning behind a collapsed disclosure and expands on tap', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    // The folded turn renders: user bubble, assistant text, disclosures.
    expect(await screen.findByText('改一下代码')).toBeTruthy()
    expect(await screen.findByText('已完成修改')).toBeTruthy()
    const head = await screen.findByRole('button', { name: /深度思考/ })
    expect(head.getAttribute('aria-expanded')).toBe('false')
    // Only the one-line summary shows while collapsed; the body stays hidden.
    expect(await screen.findByText('先看结构')).toBeTruthy()
    expect(screen.queryByText(/再看细节/)).toBeNull()

    fireEvent.click(head)
    expect(head.getAttribute('aria-expanded')).toBe('true')
    expect(await screen.findByText(/再看细节/)).toBeTruthy()
  })

  it('keeps the tool disclosure collapsed with a summary, then reveals arguments', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    const head = await screen.findByRole('button', { name: /工具/ })
    expect(head.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('{"cmd":"ls"}')).toBeNull()

    fireEvent.click(head)
    expect(head.getAttribute('aria-expanded')).toBe('true')
    expect(await screen.findByText('{"cmd":"ls"}')).toBeTruthy()
    expect(screen.getByText('bash')).toBeTruthy()
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

    // The chip shows the derived label for the unmatched current value.
    fireEvent.click(await screen.findByRole('button', { name: /Workspace Write/ }))
    // The strip's full-access card routes into the sheet (never a direct submit).
    fireEvent.click(await screen.findByRole('button', { name: /完全权限/ }))
    // Picking full access in the sheet opens the confirmation instead of submitting.
    fireEvent.click(await screen.findByRole('button', { name: /完全权限/ }))
    expect(await screen.findByText(/确认完全权限/)).toBeTruthy()
    expect(sendCommandMock).not.toHaveBeenCalled()
    // Cancelling dispatches nothing; opening again and confirming submits.
    fireEvent.click(screen.getByRole('button', { name: /取消/ }))
    fireEvent.click(screen.getByRole('button', { name: /完全权限/ }))
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
    })
    // The snapshot predates those events; resolving it must not drop them.
    await act(async () => { resolveHistory(rowPage(turnEvents())) })

    expect(await screen.findByText('实时新消息')).toBeTruthy()
    // The history turn's tool disclosure plus the live one both render.
    expect((await screen.findAllByRole('button', { name: /工具/ })).length).toBe(2)
  })

  it('carries the host view on live mux frames into the tool diff card', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
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
    })

    // The live diff artifact head renders in the message body without
    // expanding the tool disclosure; the body is folded by default.
    const head = await screen.findByRole('button', { name: /Write b\.txt/ })
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
    expect(chip.textContent).toContain('fx-1')

    fireEvent.click(chip)
    const deep = await screen.findByRole('button', { name: /FX 深度/ })
    fireEvent.click(deep)
    await waitFor(() => {
      expect(selectModelMock).toHaveBeenCalledWith('s-1', { provider: 'fx', model: 'fx-2', reasoningEffort: 'high' })
    })
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
    // The strip only lists models; effort lives in the full sheet.
    fireEvent.click(await screen.findByRole('button', { name: /全部…/ }))
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

  it('keeps the current scroll position when older messages are loaded', async () => {
    scrollHeightMock = 400
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents(), { hasMore: true }))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    // The auto-extend consumed one older page; the button stays (hasMore).
    await waitFor(() => { expect(loadChatPageMock).toHaveBeenCalledTimes(2) })
    // Move to the bottom (streaming), as a stable baseline to preserve.
    scrollHeightMock = 800
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: liveFinalEvent(6).event })
    })
    await screen.findByText('实时新消息')
    const writesBefore = scrollWrites.length
    expect(scrollWrites.at(-1)).toBe(800)
    // Prepend an older page: the visual anchor is preserved by one scroll
    // write advancing the position by the inserted rows' estimated height —
    // the view is NOT re-pinned to the new bottom (scrollHeightMock is 900
    // and no write may hit 900).
    scrollHeightMock = 900
    loadChatPageMock.mockResolvedValueOnce(rowPage(turnEvents(), { hasMore: false }))
    fireEvent.click(screen.getByRole('button', { name: /加载更早的消息/ }))
    await waitFor(() => { expect(scrollWrites.length).toBe(writesBefore + 1) })
    const anchored = scrollWrites.at(-1) ?? 0
    expect(anchored).toBeGreaterThan(800)
    expect(anchored).not.toBe(900)
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
    fireEvent.scroll(scroller, { target: { scrollTop: 5_000 } })
    expect(screen.getByRole('button', { name: '回到最新消息' })).toBeTruthy()
  })

  it('jumps to the bottom and hides the button on click', async () => {
    scrollHeightMock = 20_000
    clientHeightMock = 600
    loadChatPageMock.mockResolvedValue(rowPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    const scroller = document.querySelector('.chat-scroll')!
    fireEvent.scroll(scroller, { target: { scrollTop: 5_000 } })
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
    fireEvent.scroll(scroller, { target: { scrollTop: 5_000 } })
    // Two new turns arrive while the reader is away from the bottom.
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: liveFinalEvent(6, 1).event })
    })
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
    fireEvent.scroll(scroller, { target: { scrollTop: 5_000 } })
    // Two new turns arrive while the reader is away from the bottom.
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: liveFinalEvent(6, 1).event })
    })
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
    fireEvent.scroll(scroller, { target: { scrollTop: 5_000 } })
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

  it('windowed: re-pins to the tail when content settles while at the bottom, and leaves a scrolled-away reader alone', async () => {
    // 130 messages: above WINDOW_THRESHOLD, so the opening scrollToBottom
    // lands on an ESTIMATED height and the measurement convergence must
    // re-pin the view to the true tail.
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
    // The opening pin lands on the estimated height, then the height
    // correction (measured on the full frame) re-pins to the real tail.
    await waitFor(() => { expect(scrollWrites.at(-1)).toBe(20_000) })
    // Content grows (async load / measurement convergence) while the reader
    // is at the bottom: the view re-pins to the new tail (the windowed
    // target is prefix[count] + correction, which grows with the new row).
    scrollHeightMock = 25_000
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: liveFinalEvent(6).event })
    })
    await waitFor(() => { expect(scrollWrites.at(-1) ?? 0).toBeGreaterThan(20_000) })
    // A reader who scrolled away is left alone even when content settles.
    scrollHeightMock = 30_000
    const scroller = document.querySelector('.chat-scroll')!
    fireEvent.scroll(scroller, { target: { scrollTop: 5_000 } })
    const writesBefore = scrollWrites.length
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: liveFinalEvent(7).event })
    })
    expect(scrollWrites.length).toBe(writesBefore)
  })

  it('windowed: past the threshold only the rows around the scroll position render, and the window follows scrolls', async () => {
    // 130 short user messages: above WINDOW_THRESHOLD, so the list renders
    // as an estimated-height spacer + a slice instead of the full list.
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
    // The tail window replaced the first full frame: rows far above the
    // scroll position are no longer in the DOM (spacers stand in for them).
    await waitFor(() => { expect(screen.queryByText('消息0')).toBeNull() })
    const renderedRows = screen.queryAllByText(/^消息\d+$/).length
    expect(renderedRows).toBeGreaterThan(20)
    expect(renderedRows).toBeLessThan(130)
    // Scroll toward the middle: the window relocates around the new position.
    // After the height correction the windowed scrollTop lives in REAL content
    // space (the top spacer carries the estimate→real correction), while the
    // row index is estimated — scroll to the real position of row ~65
    // (estimated prefix of 65 rows + the correction measured on the full
    // frame: scrollHeightMock − estimated total).
    const scroller = container.querySelector('.chat-scroll') as HTMLElement
    const estimatedTotal = Array.from({ length: 130 }, (_, index) => estimateMessageHeight({
      kind: 'user', id: `u-${index}`, text: `消息${index}`, seq: index, time: index * 1_000,
    })).reduce((acc, height) => acc + height, 0)
    const estimated65 = Array.from({ length: 65 }, (_, index) => estimateMessageHeight({
      kind: 'user', id: `u-${index}`, text: `消息${index}`, seq: index, time: index * 1_000,
    })).reduce((acc, height) => acc + height, 0)
    const correction = scrollHeightMock - estimatedTotal
    fireEvent.scroll(scroller, { target: { scrollTop: estimated65 + correction } })
    await waitFor(() => { expect(screen.getByText('消息65')).toBeTruthy() })
    expect(screen.queryByText('消息129')).toBeNull()
    expect(screen.queryByText('消息0')).toBeNull()
  })

  it('windowed: measured row heights replace the estimate in the prefix sum', async () => {
    // jsdom reports no layout (offsetHeight 0), so the measurement effect
    // normally stays silent. Give every element a fixed height: the effect
    // then records real heights and the prefix rebuild blends them in.
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 100 })
    try {
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
      await waitFor(() => { expect(screen.queryByText('消息0')).toBeNull() })
      // Let the measurement effect run and the prefix rebuild + locate land.
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
      // The window lands at the tail after the open-time re-pin, so the
      // bottom spacer is 0 and the TOP spacer carries the measured prefix
      // (100px/row) plus the height correction (scrollHeightMock 20000 −
      // measured prefix) — the pure estimate (50px/row) would be far
      // smaller, proving the real heights entered the prefix sum. The
      // opening tail window spans WINDOW_VISIBLE + WINDOW_OVERSCAN = 44 rows
      // (matches locateWindow), so its measured height is 4400px and the
      // top spacer is 20000 − 4400 = 15600. The correction re-render
      // (correctionTick) must have landed for the spacer to reflect the
      // final correction, not the opening estimate.
      const spacers = container.querySelectorAll('.chat-scroll > div[aria-hidden="true"]')
      const top = spacers[0] as HTMLElement | undefined
      expect(top?.style.height).toBe('15600px')
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original!)
    }
  })

  it('windowed: a search-hit locate deep in history relocates the window to that row and marks it', async () => {
    // 130 user messages (past WINDOW_THRESHOLD). Locating one deep row must
    // move the render window to it and give it the focus class — not be
    // overridden by the opening pin-to-tail window, which would window the
    // target OUT of the DOM (the classic "search shows it but I can't see it").
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
    // call 1 = opening tail (hasMore true, no target). call 2 = the silent
    // auto-extend page (still no target). call 3 = the locate's direct jump
    // to the target's page (beforeSeq = target+1 = 6), which contains it.
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
    expect(loadChatPageMock.mock.calls[2]?.[1]).toBe(6)
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

  it('hides the tool disclosure when the showToolCalls prop is off', async () => {
    loadChatPageMock.mockResolvedValue(rowPage(toolEvents()))
    const view = render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    // Tool disclosure visible by default.
    expect(await screen.findByRole('button', { name: /工具/ })).toBeTruthy()

    view.rerender(<ChatView session={session} onBack={() => {}} showToolCalls={false} showSystemMessages={false} />)

    // The disclosure is gone while reasoning/text remain.
    expect(screen.queryByRole('button', { name: /工具/ })).toBeNull()
    expect(screen.getByText('完成')).toBeTruthy()
  })

  it('renders the host diff-card view as a collapsible artifact in the message body', async () => {
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
    ]))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    // The artifact head (title + tally) renders in the message body WITHOUT
    // expanding the tool disclosure; the diff body is folded by default.
    const head = await screen.findByRole('button', { name: /Write a\.txt/ })
    expect(head.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('+1 −1')).toBeTruthy()
    expect(screen.queryByText('old line')).toBeNull()
    expect(screen.queryByText('new line')).toBeNull()

    // Tapping the head expands the red/green diff body.
    fireEvent.click(head)
    expect(await screen.findByText('old line')).toBeTruthy()
    expect(screen.getByText('new line')).toBeTruthy()
    const delRow = screen.getByText('old line').closest('.chat-tool-diff-row')
    const addRow = screen.getByText('new line').closest('.chat-tool-diff-row')
    expect(delRow?.className).toContain('chat-tool-diff-del')
    expect(addRow?.className).toContain('chat-tool-diff-add')

    // The tool disclosure keeps the call name only — no duplicated diff,
    // no raw arguments JSON.
    fireEvent.click(screen.getByRole('button', { name: /工具/ }))
    expect(screen.getByText('write')).toBeTruthy()
    expect(screen.queryByText('{"file_path":"a.txt"}')).toBeNull()
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

    // The artifact head sits BETWEEN the two text runs in DOM order.
    await screen.findByText('先看这个')
    const order = [...container.querySelectorAll('.chat-msg-assistant .chat-md-body, .chat-msg-assistant .chat-artifact')]
      .map(el => el.className)
    const firstText = order.findIndex(cls => cls.includes('chat-md-body'))
    const artifact = order.findIndex(cls => cls.includes('chat-artifact'))
    let lastText = -1
    for (let i = order.length - 1; i >= 0; i -= 1) {
      if (order[i]?.includes('chat-md-body') === true) { lastText = i; break }
    }
    expect(firstText).toBeGreaterThanOrEqual(0)
    expect(artifact).toBeGreaterThan(firstText)
    expect(lastText).toBeGreaterThan(artifact)
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
    // The panel lists every model directly (no search box); the full sheet
    // stays reachable from the panel.
    expect(screen.queryByRole('searchbox', { name: '搜索模型' })).toBeNull()
    expect(screen.getByRole('button', { name: '全部…' })).toBeTruthy()
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
    expect(await screen.findByText('工作区写入')).toBeTruthy()
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
    // The strip routes full access into the sheet, which owns the explicit
    // confirm — the strip itself never applies it directly.
    await waitFor(() => expect(screen.queryByRole('menu', { name: '选择权限' })).toBeNull())
    fireEvent.click(screen.getByText('完全权限'))
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
      // Ten silent seconds in, the wording is 后台处理中; reconciliation
      // with a still-running host must NOT clear the row.
      expect(screen.getByRole('status', { name: '后台处理中' })).toBeTruthy()

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
      expect(screen.getByRole('status', { name: '后台处理中' })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the indicator when the host is unreachable (sustained listSessions failure)', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    vi.useFakeTimers()
    try {
      emitSessionEvent(mux, 'turn/start', 1)
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()

      // The host process is dead: every reconciliation probe fails. A single
      // blip must not clear the row, but sustained failure (the host can
      // never answer) must drop the indicator instead of showing 输出中 forever.
      listSessionsMock.mockRejectedValue(new Error('host unreachable'))
      await vi.advanceTimersByTimeAsync(10_000)
      expect(screen.getByRole('status', { name: '后台处理中' })).toBeTruthy()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(screen.getByRole('status', { name: '后台处理中' })).toBeTruthy()
      // Third consecutive failure (30 s of unreachability): the indicator clears.
      await vi.advanceTimersByTimeAsync(10_000)
      expect(screen.queryByRole('status', { name: '输出中' })).toBeNull()
      expect(screen.queryByRole('status', { name: '后台处理中' })).toBeNull()
      expect(screen.getByRole('button', { name: '发送' })).toBeTruthy()
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
      expect(screen.getByRole('status', { name: '后台处理中' })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('flips the indicator wording to 后台处理中 while frames go silent', async () => {
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
      expect(screen.getByRole('status', { name: '后台处理中' })).toBeTruthy()

      // Any frame at all - even another session's (the memory-upkeep
      // subagent streams on the same mux) - restores the typing wording.
      act(() => { mux.emit({ type: 'session/event', sessionId: 's-sub', event: makeEntry('assistant/message', {}, 5).event }) })
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()

      emitSessionEvent(mux, 'turn/end', 9)
      // The status row is gone (the context ring keeps its own role=status,
      // so assert on the wording, not the bare role).
      expect(screen.queryByText('后台处理中')).toBeNull()
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

    act(() => { mux.emit({ type: 'session/jobs', sessionId: 's-1', jobs: [job('subagent-1', 'running')] }) })
    expect(screen.getByRole('button', { name: /后台任务/ })).toBeTruthy()

    // The host sends [] when the last task settles: the strip disappears.
    act(() => { mux.emit({ type: 'session/jobs', sessionId: 's-1', jobs: [] }) })
    expect(screen.queryByRole('button', { name: /后台任务/ })).toBeNull()
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

  it('shows a count badge for running subagents and opens the tree sheet', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    subagentsListMock.mockResolvedValue({ entries: [runningChild()], parentAvailable: true })
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    // No running turn yet: no badge.
    expect(screen.queryByRole('button', { name: /个子代理运行中/ })).toBeNull()

    // Turn starts; the tree fetch reports one running subagent → badge appears.
    act(() => { mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('turn/start', {}, 1).event }) })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '1 个子代理运行中' })).toBeTruthy()
    })

    // Tapping the badge opens the tree sheet with the subagent label.
    fireEvent.click(screen.getByRole('button', { name: '1 个子代理运行中' }))
    expect(screen.getByRole('dialog', { name: '子代理' })).toBeTruthy()
    expect(screen.getByText('整理记忆')).toBeTruthy()
    expect(screen.getByText('运行中')).toBeTruthy()
  })

  it('hides the badge when no subagent is running', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    subagentsListMock.mockResolvedValue({
      entries: [{ kind: 'child', id: 's-sub', mode: 'one-shot', activity: 'inactive', hasChildren: false, label: '整理记忆' } as never],
      parentAvailable: true,
    })
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    act(() => { mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('turn/start', {}, 1).event }) })
    await waitFor(() => { expect(subagentsListMock).toHaveBeenCalled() })
    expect(screen.queryByRole('button', { name: /个子代理运行中/ })).toBeNull()
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
    // message bubble is not rendered (no air bubble)
    expect(screen.queryByRole('button', { name: /工具/ })).toBeNull()
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

  it('starts no long-press menu on selectable message text, but keeps it on the bubble chrome', async () => {
    const { textEl, bubble } = await renderOneTurn()
    // Clear any pending state from previous events.
    fireEvent.touchMove(bubble, { touches: [{ clientX: 10, clientY: 10 }] })

    // Long-press on the rendered markdown text: no 500ms menu timer.
    const spy = vi.spyOn(window, 'setTimeout')
    try {
      fireEvent.touchStart(textEl, { touches: [{ clientX: 50, clientY: 50 }] })
      const timerCalls = spy.mock.calls.filter(([, ms]) => ms === 500)
      expect(timerCalls).toHaveLength(0)
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
    const bolds = screen.getAllByText('加粗')
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
    await act(async () => { resolveRecorder!({ stop: vi.fn(), cancel }) })
    expect(cancel).toHaveBeenCalled()
    expect(trackStop).toHaveBeenCalled()
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
    // Remove calls updateQueue.
    fireEvent.click(screen.getByRole('button', { name: '删除排队消息' }))
    await waitFor(() => { expect(updateQueueMock).toHaveBeenCalledWith('s-1', 'q1', { kind: 'remove' }) })
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
    fireEvent.click(screen.getByRole('button', { name: '插话发送' }))
    await waitFor(() => { expect(updateQueueMock).toHaveBeenCalledWith('s-1', 'q1', { kind: 'steer' }) })
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
    fireEvent.click(screen.getByRole('button', { name: '插话发送' }))
    await waitFor(() => { expect(updateQueueMock).toHaveBeenCalledWith('s-1', 'q1', { kind: 'steer' }) })
    // The running indicator flips off (steer is only offered while running),
    // but the queue row itself stays: the view is authoritative host data and
    // converges via the next session/queue frame or the session/subscribed
    // re-baseline, never by a local clear on failure.
    await waitFor(() => {
      expect((screen.getByRole('button', { name: '插话发送' }) as HTMLButtonElement).disabled).toBe(true)
    })
    expect(screen.queryByText('插话消息')).not.toBeNull()
  })

  it('keeps the queue dock when a mutation is rejected (convergence arrives by frame)', async () => {
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
    // The queue row remains visible: the dock mirrors authoritative host
    // snapshots, so a rejected mutation never clears it locally — the next
    // session/queue frame (or the session/subscribed re-baseline after a
    // reconnect) brings the true state.
    expect(screen.queryByText('排队消息')).not.toBeNull()
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

    // A new turn starts: the host clears the projection; the strip leaves.
    emitSessionEvent(mux, 'turn/start', 20)
    expect(screen.queryByRole('button', { name: /任务 / })).toBeNull()

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
    await screen.findByRole('button', { name: '发送' })

    act(() => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('todo/write', { todos: TODOS }, 40).event })
    })
    expect(screen.getByRole('button', { name: /任务 1\/2/ })).toBeTruthy()

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
})

describe('ChatView turn clock (#outputting timer)', () => {
  /** Emit a turn/start whose logged time is `msBefore` in the past. */
  const startTurnAgo = (mux: FakeMux, msBefore: number, seq = 60): void => {
    act(() => {
      mux.emit({
        type: 'session/event',
        sessionId: 's-1',
        event: { type: 'turn/start', seq, time: Date.now() - msBefore, data: {} },
      })
    })
  }

  it('shows the elapsed clock only once the turn has run past the 15s threshold', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    // Initial render under REAL timers (findBy waits on real timers), then
    // the clock math runs on a frozen clock with synchronous assertions.
    await screen.findByRole('button', { name: '发送' })
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_700_000_000_000)
      // A young turn (5s in): the plain label only, no clock.
      startTurnAgo(mux, 5_000)
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()
      expect(screen.queryByText('5秒')).toBeNull()

      // A turn started 20s ago (anchor from the logged turn/start, desktop
      // parity): the clock appears with the true elapsed duration.
      startTurnAgo(mux, 20_000)
      expect(screen.getByText('20秒')).toBeTruthy()

      // turn/end clears the whole indicator (clock included).
      act(() => {
        mux.emit({ type: 'session/event', sessionId: 's-1', event: { type: 'turn/end', seq: 61, time: Date.now(), data: {} } })
      })
      expect(screen.queryByRole('status', { name: '输出中' })).toBeNull()
      expect(screen.queryByText('20秒')).toBeNull()
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
      vi.setSystemTime(1_700_000_000_000)
      historyMock.mockResolvedValue({ events: [], hasMore: false } as HistoryPage)
      loadChatPageMock.mockResolvedValue(rowPage([], { turnStartAt: 1_700_000_000_000 - 90_000 }))
      const mux = new FakeMux()
      render(<ChatView session={{ ...session, running: true }} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
      // Flush the page promise (microtask): the anchor lands, the effect
      // ticks once on the frozen clock — 90s of real elapsed, not mount time.
      await act(async () => { await Promise.resolve() })
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()
      expect(screen.getByText('1分30秒')).toBeTruthy()

      // A live turn/end clears the indicator; a fresh turn/start re-anchors.
      act(() => {
        mux.emit({ type: 'session/event', sessionId: 's-1', event: { type: 'turn/end', seq: 60, time: Date.now(), data: {} } })
      })
      expect(screen.queryByRole('status', { name: '输出中' })).toBeNull()
      act(() => {
        mux.emit({ type: 'session/event', sessionId: 's-1', event: { type: 'turn/start', seq: 61, time: Date.now() - 5_000, data: {} } })
      })
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()
      expect(screen.queryByText('1分30秒')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('recovers the clock anchor from the reconcile probe when the page lacks it', async () => {
    // A turn started before the loaded window (the tail page carries no
    // boundary): the running-reconcile history probe surfaces it and anchors
    // the clock at the logged start — the desktop timeline equivalent.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_700_000_000_000)
      loadChatPageMock.mockResolvedValue(rowPage([]))
      historyMock.mockResolvedValue(historyPage([
        makeEntry('turn/start', {}, 1_699_999_910),
      ]))
      const mux = new FakeMux()
      render(<ChatView session={{ ...session, running: true }} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
      await act(async () => { await Promise.resolve() })
      // No anchor yet: the clock counts from mount (elapsed 0, below the
      // 15s threshold) and shows no clock.
      expect(screen.getByRole('status', { name: '输出中' })).toBeTruthy()
      expect(screen.queryByText('1分30秒')).toBeNull()
      // The running-reconcile probe (RUNNING_RECONCILE_MS) reads the tail
      // and re-anchors at the logged turn/start.
      act(() => { vi.advanceTimersByTime(RUNNING_RECONCILE_MS + 50) })
      // advanceTimersByTime also advanced the fake clock; reset it so the
      // anchor's elapsed recomputes to exactly 90s of logged runtime.
      vi.setSystemTime(1_700_000_000_000)
      await act(async () => { await Promise.resolve() })
      expect(screen.getByText('1分30秒')).toBeTruthy()
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
    expect(screen.getByRole('button', { name: '收起' })).toBeTruthy()
  })

  it('counts elapsed on HOST time so device NTP skew does not drift the clock', async () => {
    // Host clock anchors the turn (60s logged). Over a public link the phone
    // typically runs a few seconds different from the host clock; a live
    // content frame's host timestamp calibrates the skew so the running
    // clock matches the desktop instead of drifting.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_700_000_000_000)
      loadChatPageMock.mockResolvedValue(rowPage([], { turnStartAt: 1_700_000_000_000 - 60_000 }))
      historyMock.mockResolvedValue({ events: [], hasMore: false } as HistoryPage)
      const mux = new FakeMux()
      render(<ChatView session={{ ...session, running: true }} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
      await act(async () => { await Promise.resolve() })
      // Anchor from the page: 60s elapsed on the (uncalibrated) phone clock.
      expect(screen.getByText('1分00秒')).toBeTruthy()
      // The host clock is 3s AHEAD of the phone: a live content frame
      // reports host time 1_700_000_000_003.
      act(() => {
        mux.emit({
          type: 'session/event',
          sessionId: 's-1',
          event: { type: 'assistant/chunk', seq: 80, time: 1_700_000_000_000 + 3_000, data: {} },
        })
      })
      // One tick later (fake now advanced 1s): elapsed counts on HOST time,
      // exactly what the desktop would show (1分04秒) - not the phone's
      // fast/slow guess.
      act(() => { vi.advanceTimersByTime(1_000) })
      expect(screen.getByText('1分04秒')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('formats multi-minute turns like the desktop label (Xm Ys)', async () => {
    loadChatPageMock.mockResolvedValue(rowPage([]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_700_000_000_000)
      startTurnAgo(mux, 95_000)
      expect(screen.getByText('1分35秒')).toBeTruthy()
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








