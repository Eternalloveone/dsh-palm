// @vitest-environment jsdom
/** ChatView: collapsible message folds, toolbar chips, and the bottom sheets. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionModels } from '@deepseek-ai/dsh-host-apiproxy/api/sessions'
import { ChatView, estimateMessageHeight, MAX_TAIL_BUFFER_EVENTS } from './ChatView.tsx'
import { LONG_TEXT_LIMIT } from '../markdown-text.tsx'
import { type SessionView } from './App.tsx'
import type { HistoryPage } from '../api.ts'
import type { RenderMessage, WireEvent } from '../messages.ts'

// The api module is fully mocked; App.tsx's history wrapper is overridden to
// feed fixed history pages, its pure helpers (errorText / formatTime) stay real.
vi.mock('../api.ts', () => ({
  fetchMobilePreferences: vi.fn(),
  models: vi.fn(),
  selectModel: vi.fn(),
  sendCommand: vi.fn(),
  cancelSession: vi.fn(),
  fetchPending: vi.fn(),
}))
vi.mock('./App.tsx', async importOriginal => {
  const actual = await importOriginal<typeof import('./App.tsx')>()
  return {
    ...actual,
    loadHistory: vi.fn(),
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
import { fetchMobilePreferences, models, selectModel, sendCommand, cancelSession, fetchPending } from '../api.ts'
import { loadHistory, prompt } from './App.tsx'
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

/** Build a history page from loose wire events (the host union is strict). */
function historyPage(events: Array<{ event: WireEvent }>, extra: Record<string, unknown> = {}): HistoryPage {
  return { events: events as never, hasMore: false, ...extra } as HistoryPage
}

/** Minimal mux stand-in: captures the ChatView's frame listener for hand-off. */
class FakeMux {
  listeners = new Set<(frame: unknown) => void>()
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
const loadHistoryMock = vi.mocked(loadHistory)
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
})

afterEach(() => {
  cleanup()
  // resetAllMocks (not clearAllMocks): a leftover mockResolvedValueOnce
  // queue from a failed test would otherwise leak into the next test's
  // history page (the auto-extend consumes one-shot mocks).
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

describe('ChatView message folds', () => {
  it('hides reasoning behind a collapsed disclosure and expands on tap', async () => {
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
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
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
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
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents(), {
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
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents(), {
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
    onFrame(listener: (frame: unknown) => void): () => void {
      this.listeners.add(listener)
      return () => { this.listeners.delete(listener) }
    }
    emit(frame: unknown): void {
      for (const listener of this.listeners) listener(frame)
    }
  }

  it('keeps live events that arrive while the tail page is still loading', async () => {
    let resolveHistory: (page: HistoryPage) => void = () => {}
    loadHistoryMock.mockReturnValue(new Promise<HistoryPage>((resolve) => { resolveHistory = resolve }))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    // A live turn starts before the snapshot resolves: chunk, tool call, final.
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('assistant/chunk', { turn: 1, step: 0, chunk: { type: 'text-delta', text: '正在' } }, 6).event })
      mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('tool/call', { turn: 1, step: 0, callId: 'c9', name: 'bash', arguments: '{"cmd":"ls"}' }, 7).event })
      mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('assistant/message', { turn: 1, step: 0, message: { id: 'a-9', role: 'assistant', content: [{ type: 'text', text: '实时新消息' }] } }, 8).event })
    })
    // The snapshot predates those events; resolving it must not drop them.
    await act(async () => { resolveHistory(historyPage(turnEvents())) })

    expect(await screen.findByText('实时新消息')).toBeTruthy()
    // The history turn's tool disclosure plus the live one both render.
    expect((await screen.findAllByRole('button', { name: /工具/ })).length).toBe(2)
  })

  it('carries the host view on live mux frames into the tool diff card', async () => {
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
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
    loadHistoryMock.mockResolvedValue(historyPage([]))
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
    let resolveHistory: (page: HistoryPage) => void = () => {}
    loadHistoryMock
      .mockReturnValueOnce(new Promise<HistoryPage>((resolve) => { resolveHistory = resolve }))
      // The overflow refill page folds into the list; the mock's row sits
      // past the buffered burst so the windowed list renders it at the bottom.
      .mockResolvedValueOnce(historyPage([
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

    await act(async () => { resolveHistory(historyPage(turnEvents())) })

    // The capped buffer keeps the render bounded: the dropped oldest burst
    // message is gone from the buffered fold (it comes back via the refill).
    expect(await screen.findByText('突发消息 500')).toBeTruthy()
    expect(screen.queryByText('突发消息 0')).toBeNull()

    // The overflow triggered exactly one follow-up load, paging by the DROPPED
    // seq window's newest edge (the dropped event has seq 100 → beforeSeq 101),
    // still carrying the same abort signal as the initial load. The old flat
    // tail re-pull (beforeSeq undefined) could never return the dropped event.
    await waitFor(() => { expect(loadHistoryMock).toHaveBeenCalledTimes(2) })
    expect(loadHistoryMock.mock.calls[1]?.[0]).toBe('s-1')
    expect(loadHistoryMock.mock.calls[1]?.[1]).toBe(101)
    expect(loadHistoryMock.mock.calls[1]?.[2]).toBeInstanceOf(AbortSignal)
    expect(loadHistoryMock.mock.calls[1]?.[2]).toBe(loadHistoryMock.mock.calls[0]?.[2])

    // The refilled page (the dropped seq 100 event) folds back in.
    expect(await screen.findByText('补拉恢复')).toBeTruthy()
  })

  it('passes an AbortSignal to loadHistory and aborts it on unmount', async () => {
    let capturedSignal: AbortSignal | undefined
    loadHistoryMock.mockImplementation((_sessionId, _beforeSeq, signal) => {
      capturedSignal = signal
      return Promise.resolve(historyPage(turnEvents()))
    })
    const view = render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    expect(await screen.findByText('已完成修改')).toBeTruthy()
    expect(loadHistoryMock).toHaveBeenCalledTimes(1)
    expect(loadHistoryMock.mock.calls[0]?.[0]).toBe('s-1')
    expect(loadHistoryMock.mock.calls[0]?.[1]).toBeUndefined()
    expect(loadHistoryMock.mock.calls[0]?.[2]).toBeInstanceOf(AbortSignal)
    expect(capturedSignal).toBeInstanceOf(AbortSignal)
    expect(capturedSignal?.aborted).toBe(false)

    view.unmount()
    expect(capturedSignal?.aborted).toBe(true)
  })
})

describe('ChatView model sheet', () => {
  it('labels the toolbar chip with the current model and selects a new one', async () => {
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
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
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
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
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
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
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
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
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
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
  const liveFinalEvent = (seq: number) => makeEntry('assistant/message', {
    turn: 1,
    step: 0,
    message: { id: 'a-2', role: 'assistant', content: [{ type: 'text', text: '实时新消息' }] },
  }, seq)

  it('positions to the latest message when a session is opened', async () => {
    scrollHeightMock = 400
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    // The tail page renders, then the commit-time effect pins scrollTop to the tail.
    expect(await screen.findByText('已完成修改')).toBeTruthy()
    expect(scrollWrites.at(-1)).toBe(400)
  })

  it('auto-scrolls to the bottom when a new live message arrives', async () => {
    scrollHeightMock = 400
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
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
    loadHistoryMock.mockResolvedValueOnce(historyPage(turnEvents(), { hasMore: true }))
    loadHistoryMock.mockResolvedValueOnce(historyPage(turnEvents(), { hasMore: false }))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    // The auto-extend pulled a second page (beforeSeq) without a tap.
    await waitFor(() => { expect(loadHistoryMock).toHaveBeenCalledTimes(2) })
    const secondCall = loadHistoryMock.mock.calls[1]
    expect(secondCall?.[0]).toBe('s-1')
    expect(secondCall?.[1]).toBeDefined()
    // The second page has no more history, so the manual button stays hidden.
    expect(screen.queryByRole('button', { name: /加载更早的消息/ })).toBeNull()
  })

  it('keeps the current scroll position when older messages are loaded', async () => {
    scrollHeightMock = 400
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents(), { hasMore: true }))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    // The auto-extend consumed one older page; the button stays (hasMore).
    await waitFor(() => { expect(loadHistoryMock).toHaveBeenCalledTimes(2) })
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
    loadHistoryMock.mockResolvedValueOnce(historyPage(turnEvents(), { hasMore: false }))
    fireEvent.click(screen.getByRole('button', { name: /加载更早的消息/ }))
    await waitFor(() => { expect(scrollWrites.length).toBe(writesBefore + 1) })
    const anchored = scrollWrites.at(-1) ?? 0
    expect(anchored).toBeGreaterThan(800)
    expect(anchored).not.toBe(900)
  })

  it('shows the jump-to-latest button once the reader scrolls away from the bottom', async () => {
    scrollHeightMock = 20_000
    clientHeightMock = 600
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
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
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    const scroller = document.querySelector('.chat-scroll')!
    fireEvent.scroll(scroller, { target: { scrollTop: 5_000 } })
    fireEvent.click(screen.getByRole('button', { name: '回到最新消息' }))
    // The view pins to the new bottom and the button disappears.
    expect(scrollWrites.at(-1)).toBe(20_000)
    expect(screen.queryByRole('button', { name: '回到最新消息' })).toBeNull()
  })

  it('counts messages that arrive while away and clears the badge on jump', async () => {
    scrollHeightMock = 20_000
    clientHeightMock = 600
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    const scroller = document.querySelector('.chat-scroll')!
    fireEvent.scroll(scroller, { target: { scrollTop: 5_000 } })
    // Two live messages arrive while the reader is away from the bottom.
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: liveFinalEvent(6).event })
    })
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: liveFinalEvent(7).event })
    })
    const badge = await screen.findByText('2', { selector: '.chat-jump-badge' })
    expect(badge).toBeTruthy()
    // Jumping clears the tally.
    fireEvent.click(screen.getByRole('button', { name: '回到最新消息' }))
    expect(screen.queryByText('2', { selector: '.chat-jump-badge' })).toBeNull()
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
    loadHistoryMock.mockResolvedValue(historyPage(many))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('消息129')
    expect(scrollWrites.at(-1)).toBe(20_000)
    // Content grows (async load / measurement convergence) while the reader
    // is at the bottom: the view re-pins to the new tail.
    scrollHeightMock = 25_000
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: liveFinalEvent(6).event })
    })
    expect(scrollWrites.at(-1)).toBe(25_000)
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
    loadHistoryMock.mockResolvedValue(historyPage(many))
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
      loadHistoryMock.mockResolvedValue(historyPage(many))
      const mux = new FakeMux()
      const { container } = render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
      await screen.findByText('消息129')
      await waitFor(() => { expect(screen.queryByText('消息0')).toBeNull() })
      // Let the measurement effect run and the prefix rebuild + locate land.
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
      // The bottom spacer now uses MEASURED heights (100px/row): the window
      // lands at [45,109] after the open-time scrollToBottom, so the spacer
      // is prefix[130] − prefix[109] = 13000 − 10900 = 2100px. The pure
      // estimate (50px/row) would be 6500 − 5450 = 1050px — the measured
      // value is exactly double, proving the real heights entered the sum.
      const spacers = container.querySelectorAll('.chat-scroll > div[aria-hidden="true"]')
      const bottom = spacers[spacers.length - 1] as HTMLElement | undefined
      expect(bottom?.style.height).toBe('2100px')
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original!)
    }
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
    loadHistoryMock.mockResolvedValue(historyPage(systemEvents()))
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
    loadHistoryMock.mockResolvedValue(historyPage(toolEvents()))
    const view = render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)

    // Tool disclosure visible by default.
    expect(await screen.findByRole('button', { name: /工具/ })).toBeTruthy()

    view.rerender(<ChatView session={session} onBack={() => {}} showToolCalls={false} showSystemMessages={false} />)

    // The disclosure is gone while reasoning/text remain.
    expect(screen.queryByRole('button', { name: /工具/ })).toBeNull()
    expect(screen.getByText('完成')).toBeTruthy()
  })

  it('renders the host diff-card view as a collapsible artifact in the message body', async () => {
    loadHistoryMock.mockResolvedValue(historyPage([
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
    loadHistoryMock.mockResolvedValue(historyPage([
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
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents(), {
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
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents(), {
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
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents(), {
      projections: {
        values: { contextPressure: { contextWindow: 100_000, pressureTokens: 80_000, projectedTokens: 80_000 } },
      },
    }))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    const meter = await screen.findByText('80%')
    expect(meter.closest('.chat-context')?.className).toContain('chat-context-warn')
  })

  it('renders a persistent context chip with a dash placeholder when there is no usage/context data', async () => {
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    const chip = await screen.findByText('上下文 --')
    expect(chip.className).not.toContain('chat-context-warn')
  })
})

describe('ChatView in-place quick picker strips', () => {
  /** History with the permissions projection (readonly / workspace-write / full). */
  function permissionHistory(): HistoryPage {
    return historyPage(turnEvents(), {
      projections: {
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
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    fireEvent.click(screen.getByRole('button', { name: /切换模型/ }))
    expect(await screen.findByText('FX 标准')).toBeTruthy()
    expect(screen.getByText('FX 深度')).toBeTruthy()
    const selected = screen.getByText('FX 标准').closest('.chat-picker-row')
    expect(selected?.className).toContain('chat-picker-row-selected')
    // The search field is the primary discovery path; the full sheet
    // stays reachable from the panel.
    expect(screen.getByRole('searchbox', { name: '搜索模型' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '全部…' })).toBeTruthy()
  })

  it('filters the model list as the search query narrows it', async () => {
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    fireEvent.click(screen.getByRole('button', { name: /切换模型/ }))
    const search = await screen.findByRole('searchbox', { name: '搜索模型' })
    fireEvent.change(search, { target: { value: '深度' } })
    expect(screen.getByText('FX 深度')).toBeTruthy()
    expect(screen.queryByText('FX 标准')).toBeNull()
    fireEvent.change(search, { target: { value: '不存在的模型' } })
    expect(await screen.findByText('没有匹配的模型')).toBeTruthy()
  })

  it('switches the model directly from the strip and closes it', async () => {
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
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
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByText('已完成修改')
    fireEvent.click(screen.getByRole('button', { name: /切换模型/ }))
    expect(await screen.findByText('重试')).toBeTruthy()
    fireEvent.click(screen.getByText('重试'))
    expect(await screen.findByText('FX 标准')).toBeTruthy()
  })

  it('dismisses the strip when the scrim is tapped', async () => {
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
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
    loadHistoryMock.mockResolvedValue(permissionHistory())
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
    loadHistoryMock.mockResolvedValue(permissionHistory())
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

describe('ChatView stop button (#1041)', () => {
  /** Emit one session lifecycle frame for the chat's session. */
  function emitSessionEvent(mux: FakeMux, type: string, seq: number): void {
    act(() => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry(type, {}, seq).event })
    })
  }

  it('switches the composer primary to a stop button while running and cancels the turn', async () => {
    loadHistoryMock.mockResolvedValue(historyPage([]))
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
    loadHistoryMock.mockResolvedValue(historyPage([]))
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
    loadHistoryMock.mockResolvedValue(historyPage([]))
    cancelSessionMock.mockRejectedValue(new Error('cancel exploded'))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await screen.findByRole('button', { name: '发送' })

    emitSessionEvent(mux, 'turn/start', 1)
    fireEvent.click(await screen.findByRole('button', { name: '停止' }))
    expect(await screen.findByText(/cancel exploded/)).toBeTruthy()
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
    loadHistoryMock.mockResolvedValue(historyPage(toolOnlyEvents()))
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
    loadHistoryMock.mockResolvedValue(historyPage([
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
    loadHistoryMock.mockResolvedValue(historyPage([
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
    loadHistoryMock.mockResolvedValue(historyPage([
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
    loadHistoryMock.mockResolvedValue(historyPage(events))
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
    loadHistoryMock.mockResolvedValue(historyPage(events))
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
    loadHistoryMock.mockResolvedValue(historyPage(events))
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
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
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
    loadHistoryMock.mockResolvedValue(historyPage(events))
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
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
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
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
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
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
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
  it('clears the outbox and returns to the list after confirming delete', async () => {
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
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
      expect(onBack).toHaveBeenCalled()
    })
  })
})

describe('ChatView composer IME guard', () => {
  it('does not send on Enter while a Chinese IME is composing', async () => {
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
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

describe('ChatView offline banner', () => {
  it('removes an individual queued entry from the banner', async () => {
    listOutboxMock.mockResolvedValue([{ id: 'o1', sessionId: 's-1', text: '离线消息', queuedAt: 1 }])
    removeFromOutboxMock.mockResolvedValue(undefined)
    loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    // The banner lists the queued entry.
    expect(await screen.findByText('离线消息')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '移除待发送消息' }))
    await waitFor(() => { expect(removeFromOutboxMock).toHaveBeenCalledWith('o1') })
  })
})
