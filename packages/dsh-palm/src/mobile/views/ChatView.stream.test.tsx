// @vitest-environment jsdom
/**
 * ChatView streaming markdown behavior: a pending assistant message must not
 * re-parse its whole accumulated text on every chunk. Streaming shows an
 * escaped plain-text preview (one cheap string build per chunk, newlines as
 * `<br />`), and the single full markdown parse (parseSegments) happens
 * exactly once when the turn closes, rendering byte-identical HTML to a
 * plain renderMarkdown of the final text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChatView } from './ChatView.tsx'
import { LONG_TEXT_LIMIT } from '../markdown-text.tsx'
import { type SessionView, type ChatPageResult } from './App.tsx'
import { escapeHtml, parseSegments, renderMarkdown, safeUrl } from '../markdown.ts'
import type { SessionModels } from '@deepseek-ai/dsh-host-apiproxy/api/sessions'
import type { WireEvent } from '../messages.ts'

// The api module is fully mocked; App.tsx's history wrapper is overridden to
// feed a fixed empty history page, its pure helpers stay real.
vi.mock('../api.ts', () => ({
  fetchMobilePreferences: vi.fn(),
  models: vi.fn(),
  selectModel: vi.fn(),
  sendCommand: vi.fn(),
  cancelSession: vi.fn(),
  fetchPending: vi.fn(),
  respondQuestion: vi.fn(),
  respondApproval: vi.fn(),
}))
vi.mock('./App.tsx', async importOriginal => {
  const actual = await importOriginal<typeof import('./App.tsx')>()
  return {
    ...actual,
    loadChatPage: vi.fn(),
    prompt: vi.fn(async () => {}),
  }
})
// Wrap the real parser with a call counter: pending streams must perform
// zero full-text parses, and the closed turn exactly one.
vi.mock('../markdown.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../markdown.ts')>()
  return { ...actual, parseSegments: vi.fn(actual.parseSegments) }
})
import { fetchMobilePreferences, models, respondQuestion } from '../api.ts'
import { loadChatPage } from './App.tsx'

const loadChatPageMock = vi.mocked(loadChatPage)
const fetchMobilePreferencesMock = vi.mocked(fetchMobilePreferences)
const modelsMock = vi.mocked(models)
const respondQuestionMock = vi.mocked(respondQuestion)
const parseSegmentsMock = vi.mocked(parseSegments)

const session: SessionView = {
  sessionId: 's-1',
  title: '测试会话',
  updatedAt: 1_700_000_000_000,
  running: false,
  blank: false,
}

/** Minimal mux stand-in: captures the ChatView's frame listener for hand-off. */
class FakeMux {
  listeners = new Set<(frame: unknown, rpcId?: string) => void>()
  cachedJobsFor(): unknown[] | undefined {
    return undefined
  }
  cachedQueueFor(): unknown[] | undefined {
    return undefined
  }
  onFrame(listener: (frame: unknown, rpcId?: string) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  emit(frame: unknown, rpcId?: string): void {
    for (const listener of this.listeners) listener(frame, rpcId)
  }
}

/** One history entry wrapping a WireEvent (host history-page shape). */
function makeEntry(type: string, data: unknown, seq: number): { event: WireEvent } {
  return { event: { type, seq, time: seq * 1_000, data } }
}

/** Build an empty folded chat page (the live stream supplies all content). */
function rowPage(): ChatPageResult {
  return { rows: [], maxSeq: -1, hasMore: false }
}

/**
 * Emit one live text-delta chunk bound to the stable message id 'a-1' (the
 * mobile wire shape). A stable id keeps the message row mounted across the
 * fold, so the tests observe the streaming render path only.
 */
function chunk(mux: FakeMux, text: string, seq: number): void {
  mux.emit({
    type: 'session/event',
    sessionId: 's-1',
    event: makeEntry('assistant/chunk', { messageId: 'a-1', turn: 0, step: 0, text }, seq).event,
  })
}

/** Emit the final assistant message (authoritative text, closes the turn). */
function finalMessage(mux: FakeMux, text: string, seq: number): void {
  mux.emit({
    type: 'session/event',
    sessionId: 's-1',
    event: makeEntry('assistant/message', {
      turn: 0,
      step: 0,
      message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text }] },
    }, seq).event,
  })
}

/** The exact preview HTML the component must render for live text (escaped,
 * paired single backticks promoted to inline-code chips, **bold**, *italic*,
 * ~~strikethrough~~ and [links](url) promoted to real tags, blank-line blocks
 * as <p> with newlines as <br /> — mirroring the settled parse's rhythm). */
function previewHtml(text: string): string {
  const escaped = escapeHtml(text)
    .replace(/(^|[^`])`([^`\n]+)`(?=$|[^`])/g, '$1<code>$2</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?=$|[^*])/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
      const safe = safeUrl(url)
      return safe === null ? match : `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>`
    })
  return escaped.split(/\n{2,}/).map(block => `<p>${block.replace(/\n/g, '<br />')}</p>`).join('')
}

/** Round-trip HTML through the DOM so a byte comparison is symmetric. */
function normalize(html: string): string {
  const element = document.createElement('div')
  element.innerHTML = html
  return element.innerHTML
}

/** The assistant message's markdown body (the escaped HTML run inside .chat-md-body). */
function body(): HTMLElement {
  const element = document.querySelector('.chat-msg.chat-msg-assistant .chat-md-body .md-html')
  if (element === null) throw new Error('assistant markdown body not found')
  return element as HTMLElement
}

beforeEach(() => {
  fetchMobilePreferencesMock.mockResolvedValue({ mobileEnterToSend: true })
  modelsMock.mockResolvedValue({
    current: { provider: 'fx', model: 'fx-1' },
    routable: true,
    groups: [],
    failures: [],
  } satisfies SessionModels)
  loadChatPageMock.mockResolvedValue(rowPage())
  respondQuestionMock.mockResolvedValue(undefined)
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('ChatView streaming markdown render', () => {
  it('streams structured stable parts with a plain-text tail, then parses once on close', async () => {
    const mux = new FakeMux()
    await act(async () => {
      render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    })

    const parts = [
      '第一段 **加粗** 文本与 \`行内代码\`。\n\n',
      '第二段 *斜体* 与 <标签> 内容。\n\n',
      '第三段 ~~删除线~~ 和 [链接](https://example.com/a)。',
    ]
    const full = parts.join('')

    // The first chunk mounts the pending message (mount render may parse).
    await act(async () => { chunk(mux, parts[0] ?? '', 6) })
    const afterMount = parseSegmentsMock.mock.calls.length

    // Further chunks: ZERO terminal parses — the stream path uses the
    // incremental prefix parser, never parseSegments.
    await act(async () => {
      chunk(mux, parts[1] ?? '', 7)
      chunk(mux, parts[2] ?? '', 8)
    })
    expect(parseSegmentsMock.mock.calls.length - afterMount).toBe(0)

    // Stable paragraphs render structured WHILE streaming: each closed
    // paragraph becomes a real <p> with inline markdown applied.
    const runs = document.querySelectorAll('.chat-msg-assistant .chat-md-body .md-html')
    expect(runs.length).toBe(2)
    const stable = runs[0]?.innerHTML ?? ''
    expect(stable).toContain('<p>第一段 <strong>加粗</strong> 文本与 <code>行内代码</code>。</p>')
    expect(stable).toContain('<p>第二段 <em>斜体</em> 与 &lt;标签&gt; 内容。</p>')

    // The still-open paragraph stays a preview: inline markdown (**bold**,
    // `code`, *italic*, ~~strike~~, links) renders as real tags, but block
    // structure (fences, lists) stays inert until the text closes.
    const tail = runs[1]?.innerHTML ?? ''
    expect(tail).toBe(normalize(previewHtml(parts[2] ?? '')))
    expect(tail).toContain('<del>删除线</del>')
    expect(tail).toContain('<a href="https://example.com/a"')
    expect(tail).not.toContain('<pre')

    // Closing the turn parses exactly once and renders byte-identical HTML.
    await act(async () => { finalMessage(mux, full, 9) })
    expect(parseSegmentsMock.mock.calls.length - afterMount).toBe(1)
    expect(normalize(body().innerHTML)).toBe(normalize(renderMarkdown(full)))
  })

  it('renders a closed code fence as a real code block while still streaming', async () => {
    const mux = new FakeMux()
    let container: HTMLElement
    await act(async () => {
      const rendered = render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
      container = rendered.container
    })

    // One chunk carries a closed paragraph, a COMPLETE fence, and an open
    // trailing paragraph.
    const text = '先看代码\n\n```ts\nconst a = 1\n```\n\n后面还有'
    await act(async () => { chunk(mux, text, 6) })

    const block = container!.querySelector('.code-block')
    expect(block).not.toBeNull()
    expect(block?.querySelector('.code-lang')?.textContent).toBe('TypeScript')
    expect(block?.textContent).toContain('const a = 1')
    // The unstable tail stays a plain preview with no code chrome.
    const runs = container!.querySelectorAll('.chat-msg-assistant .chat-md-body .md-html')
    const tail = runs[runs.length - 1]?.innerHTML ?? ''
    expect(tail).toContain('后面还有')
    expect(tail).not.toContain('<pre')
  })

  it('keeps an open fence as plain text until the closing fence arrives', async () => {
    const mux = new FakeMux()
    let container: HTMLElement
    await act(async () => {
      const rendered = render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
      container = rendered.container
    })

    const openFence = '```ts\nconst a = 1'
    await act(async () => { chunk(mux, openFence, 6) })
    expect(container!.querySelector('.code-block')).toBeNull()
    expect(body().innerHTML).toBe(normalize(previewHtml(openFence)))

    // The closing fence lands: the whole fence becomes a code block and the
    // remaining text is the preview tail.
    await act(async () => { chunk(mux, '\nconst b = 2\n```\n\n收尾', 7) })
    const block = container!.querySelector('.code-block')
    expect(block).not.toBeNull()
    expect(block?.textContent).toContain('const a = 1')
    expect(block?.textContent).toContain('const b = 2')
    const runs = container!.querySelectorAll('.chat-msg-assistant .chat-md-body .md-html')
    const tail = runs[runs.length - 1]?.innerHTML ?? ''
    expect(tail).toContain('收尾')
  })

  it('promotes paired backticks to inline-code chips in the streaming tail but keeps unmatched ticks literal', async () => {
    const mux = new FakeMux()
    let container: HTMLElement
    await act(async () => {
      const rendered = render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
      container = rendered.container
    })

    // Paired ticks render as <code> chips while the paragraph is still open;
    // the unmatched tick and a fence opener stay literal.
    const text = '执行 `npm run build` 或 ``plain`` 与未闭合的 `反引号，再开一个 ```ts 围栏'
    await act(async () => { chunk(mux, text, 6) })

    const runs = container!.querySelectorAll('.chat-msg-assistant .chat-md-body .md-html')
    const preview = runs[runs.length - 1]?.innerHTML ?? ''
    expect(preview).toContain('<code>npm run build</code>')
    // Double backticks are NOT a code pair; unmatched and fence ticks stay as-is.
    expect(preview).not.toContain('<code>plain</code>')
    expect(preview).toContain('``plain``')
    expect(preview).toContain('`反引号，再开一个 ```ts 围栏')
  })

  it('renders the exact final HTML immediately when the turn closes', async () => {
    const mux = new FakeMux()
    await act(async () => {
      render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    })

    // The final event carries the authoritative text and closes the turn
    // (pending -> false) in the same synchronous burst as the chunks.
    const finalText = '最终 **整篇** `渲染` 与 [链接](https://example.com/x) 文本。'
    await act(async () => {
      chunk(mux, '流式前缀', 6)
      chunk(mux, '中间过程', 7)
      finalMessage(mux, finalText, 8)
    })

    // No timer advance needed: the closed turn already renders the exact
    // final HTML (terminal messages parse immediately).
    expect(normalize(body().innerHTML)).toBe(normalize(renderMarkdown(finalText)))
  })

  it('updates the preview on every chunk and re-parses once for the final text', async () => {
    const mux = new FakeMux()
    await act(async () => {
      render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    })

    const first = '第一期内容。'
    const second = '第二期内容，包含 `code`。'
    const full = first + second

    // Every chunk lands immediately (no throttle window, no trailing render).
    await act(async () => { chunk(mux, first, 6) })
    expect(normalize(body().innerHTML)).toBe(normalize(previewHtml(first)))

    await act(async () => { chunk(mux, second, 7) })
    expect(normalize(body().innerHTML)).toBe(normalize(previewHtml(full)))
    expect(body().innerHTML).toContain('第二期内容')

    // Closing the turn re-parses exactly once, byte-identical to a full
    // renderMarkdown of the accumulated text.
    const beforeFinal = parseSegmentsMock.mock.calls.length
    await act(async () => { finalMessage(mux, full, 9) })
    expect(parseSegmentsMock.mock.calls.length - beforeFinal).toBe(1)
    expect(normalize(body().innerHTML)).toBe(normalize(renderMarkdown(full)))
  })

  it('does not collapse long text while streaming (pending) and collapses once turn finishes', async () => {
    const mux = new FakeMux()
    let container: HTMLElement
    await act(async () => {
      const rendered = render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
      container = rendered.container
    })

    const hugeChunk = 'C'.repeat(LONG_TEXT_LIMIT + 200)

    // Stream a chunk exceeding LONG_TEXT_LIMIT
    await act(async () => {
      chunk(mux, hugeChunk, 6)
    })

    // During streaming (pending), message is not collapsed
    expect(container!.querySelector('.chat-md-collapsed')).toBeNull()
    expect(screen.queryByRole('button', { name: /展开全文/ })).toBeNull()

    // Turn closes
    await act(async () => {
      finalMessage(mux, hugeChunk, 7)
    })

    // Once turn ends (not pending), message is collapsed and has expand button
    expect(container!.querySelector('.chat-md-collapsed')).not.toBeNull()
    expect(screen.getByRole('button', { name: new RegExp(`展开全文（${LONG_TEXT_LIMIT + 200} 字）`) })).toBeTruthy()
  })

  it('shows the question panel from a live frame and answers with the frame rpcId', async () => {
    const mux = new FakeMux()
    await act(async () => {
      render(<ChatView session={session} mux={mux as never} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    })

    await act(async () => {
      mux.emit({
        type: 'question/requested',
        sessionId: 's-1',
        questions: [
          { id: 'q-1', question: '继续执行吗？', options: [{ label: '继续' }, { label: '停止' }] },
        ],
      }, 'q-1')
    })

    // The panel renders with the question and its options.
    expect(screen.getByText('继续执行吗？')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: '继续' }))
      fireEvent.click(screen.getByRole('button', { name: '提交回答' }))
    })

    // The answer echoes the frame's rpcId and carries the batch shape.
    expect(respondQuestionMock).toHaveBeenCalledWith(
      'q-1',
      's-1',
      { answers: [{ id: 'q-1', selected: ['继续'] }] },
    )
  })
})
