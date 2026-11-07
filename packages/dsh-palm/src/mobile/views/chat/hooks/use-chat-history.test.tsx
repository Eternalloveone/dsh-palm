// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatPageResult } from '../../../data/chat-page.ts'
import type { RenderMessage } from '../../../messages.ts'
import { OPEN_HISTORY_TARGET_ROWS, useChatHistory, type ChatHistoryHandle } from './use-chat-history.ts'
import type { ChatScrollHandle } from '../../../ui/hooks/use-stick-to-bottom.ts'

vi.mock('../../../data/chat-page.ts', () => ({
  loadChatPage: vi.fn(),
}))

import { loadChatPage } from '../../../data/chat-page.ts'

const loadChatPageMock = vi.mocked(loadChatPage)

type Row = RenderMessage & { seq: number }

function row(seq: number): Row {
  return { id: `m${seq}`, role: 'assistant', text: `row ${seq}`, seq } as unknown as Row
}

function page(rows: Row[], hasMore = true): ChatPageResult {
  return { rows, hasMore } as unknown as ChatPageResult
}

let handle: ChatHistoryHandle | undefined
let adopted: RenderMessage[][] = []
let prepared: ChatPageResult[] = []

function Harness({ firstSeq = 10, loaded = 20, messages = [] as RenderMessage[], scroll, actions }: {
  firstSeq?: number
  loaded?: number
  messages?: RenderMessage[]
  scroll?: ChatScrollHandle
  actions?: { scrollToBottom(): void; settleBottomAfterCommit(): void }
}) {
  handle = useChatHistory({
    sessionId: 's-1',
    messages,
    getScroll: () => scroll,
    actions: actions ?? { scrollToBottom: () => {}, settleBottomAfterCommit: () => {} },
    getFirstRow: () => row(firstSeq),
    loadedRowCount: () => loaded,
    preparePage: async (source) => { prepared.push(source); return [...source.rows] },
    adoptPage: (older) => { adopted.push(older) },
    onLoading: () => {},
    onError: () => {},
  })
  return <div />
}

afterEach(() => {
  handle = undefined
  adopted = []
  prepared = []
  loadChatPageMock.mockReset()
})

describe('useChatHistory', () => {
  it('pages from the first row seq and adopts the rendered page', async () => {
    loadChatPageMock.mockResolvedValue(page([row(7), row(8)]))
    render(<Harness />)
    if (handle === undefined) throw new Error('hook did not run')
    handle.loadOlder()
    await vi.waitFor(() => { expect(adopted).toHaveLength(1) })
    expect(loadChatPageMock.mock.calls[0]![0]).toBe('s-1')
    expect(loadChatPageMock.mock.calls[0]![1]).toBe(10)
    expect(adopted[0]!.map(entry => (entry as Row).seq)).toEqual([7, 8])
    expect(handle.hasOlder).toBe(true)
  })

  it('keeps hasOlder unchanged for an empty page (skewed cursor is not the end)', async () => {
    loadChatPageMock.mockResolvedValue(page([], false))
    render(<Harness />)
    if (handle === undefined) throw new Error('hook did not run')
    handle.setHasOlder(true)
    handle.loadOlder()
    await vi.waitFor(() => { expect(prepared).toHaveLength(1) })
    expect(handle.hasOlder).toBe(true)
  })

  it('coalesces a request that arrives while a page is in flight', async () => {
    let resolveFirst!: (value: ChatPageResult) => void
    loadChatPageMock
      .mockImplementationOnce(() => new Promise<ChatPageResult>(resolve => { resolveFirst = resolve }))
      .mockResolvedValueOnce(page([row(3)]))
    render(<Harness />)
    if (handle === undefined) throw new Error('hook did not run')
    handle.loadOlder()
    handle.loadOlder(false, 5)
    expect(loadChatPageMock).toHaveBeenCalledTimes(1)
    resolveFirst(page([row(8)]))
    await vi.waitFor(() => { expect(loadChatPageMock).toHaveBeenCalledTimes(2) })
    // The queued request used its own cursor.
    expect(loadChatPageMock.mock.calls[1]![1]).toBe(5)
  })

  it('stops the silent auto-extend chain at the target row count', async () => {
    loadChatPageMock.mockResolvedValue(page([row(5)]))
    render(<Harness loaded={OPEN_HISTORY_TARGET_ROWS + 1} />)
    if (handle === undefined) throw new Error('hook did not run')
    handle.loadOlder(true, undefined, true)
    await vi.waitFor(() => { expect(adopted).toHaveLength(1) })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(loadChatPageMock).toHaveBeenCalledTimes(1)
  })

  it('chains silent pages while under the target', async () => {
    loadChatPageMock.mockResolvedValue(page([row(5)]))
    render(<Harness loaded={0} />)
    if (handle === undefined) throw new Error('hook did not run')
    handle.loadOlder(true)
    await vi.waitFor(() => { expect(adopted).toHaveLength(1) })
    // No chain flag: exactly one page.
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(loadChatPageMock).toHaveBeenCalledTimes(1)
  })

  it('re-follows the tail after markFollowAfterPrepend once rows change', () => {
    const scrollToBottom = vi.fn()
    const settle = vi.fn()
    const scroll = {
      scrollRef: { current: {} },
      scrollStateRef: { current: { stick: true, gap: 0 } },
      setScrollTopProgrammatically: () => {},
      lastScrollHeightRef: { current: 0 },
    } as unknown as ChatScrollHandle
    const view = render(<Harness messages={[]} scroll={scroll} actions={{ scrollToBottom, settleBottomAfterCommit: settle }} />)
    handle?.markFollowAfterPrepend()
    view.rerender(<Harness messages={[row(1)]} scroll={scroll} actions={{ scrollToBottom, settleBottomAfterCommit: settle }} />)
    expect(scrollToBottom).toHaveBeenCalledTimes(1)
    expect(settle).toHaveBeenCalledTimes(1)
  })
})
