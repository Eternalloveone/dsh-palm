// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatPageResult } from '../../../data/chat-page.ts'
import type { RenderMessage } from '../../../render/messages.ts'
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

function Harness({ sessionId = 's-1', firstSeq = 10, loaded = 20, messages = [] as RenderMessage[], scroll, actions, preparePage, onError, onLoading }: {
  sessionId?: string
  firstSeq?: number
  loaded?: number
  messages?: RenderMessage[]
  scroll?: ChatScrollHandle
  actions?: { scrollToBottom(): void; settleBottomAfterCommit(): void }
  preparePage?: (source: ChatPageResult) => Promise<RenderMessage[]>
  onError?: (reason: unknown) => void
  onLoading?: (loading: boolean) => void
}) {
  handle = useChatHistory({
    sessionId,
    messages,
    getScroll: () => scroll,
    actions: actions ?? { scrollToBottom: () => {}, settleBottomAfterCommit: () => {} },
    getFirstRow: () => row(firstSeq),
    loadedRowCount: () => loaded,
    preparePage: preparePage ?? (async (source) => { prepared.push(source); return [...source.rows] }),
    adoptPage: (older) => { adopted.push(older) },
    onLoading: onLoading ?? (() => {}),
    onError: onError ?? (() => {}),
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
  it('ignores a history page started for the prior session after switching', async () => {
    let resolvePage!: (value: ChatPageResult) => void
    let signal: AbortSignal | undefined
    loadChatPageMock.mockImplementation((_sessionId, _beforeSeq, requestSignal) => {
      signal = requestSignal
      return new Promise<ChatPageResult>(resolve => { resolvePage = resolve })
    })
    const view = render(<Harness sessionId="s-1" />)
    if (handle === undefined) throw new Error('hook did not run')
    handle.loadOlder()
    handle.pageCacheRef.current.set(9, page([row(6)]))

    view.rerender(<Harness sessionId="s-2" />)
    resolvePage(page([row(8)]))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(adopted).toEqual([])
    expect(signal?.aborted).toBe(true)
    expect(handle?.pendingRef.current).toBe(false)
    expect(handle?.pageCacheRef.current.get(9)).toBeUndefined()
  })

  it('invalidates a captured session guard after switching', () => {
    const view = render(<Harness sessionId='s-1' />)
    if (handle === undefined) throw new Error('hook did not run')
    const isCurrentSession = handle.captureSessionGuard()
    handle.pageCacheRef.current.set(9, page([row(6)]))

    view.rerender(<Harness sessionId='s-2' />)

    expect(isCurrentSession()).toBe(false)
    expect(handle?.pageCacheRef.current.get(9)).toBeUndefined()
  })

  it('does not let old page preparation clear or adopt into the new session', async () => {
    let resolveNextPage!: (value: ChatPageResult) => void
    loadChatPageMock
      .mockResolvedValueOnce(page([row(8)]))
      .mockImplementationOnce(() => new Promise<ChatPageResult>(resolve => { resolveNextPage = resolve }))

    const preparedResolvers: Array<(rows: RenderMessage[]) => void> = []
    const preparePage = vi.fn((source: ChatPageResult) => {
      prepared.push(source)
      return new Promise<RenderMessage[]>(resolve => { preparedResolvers.push(resolve) })
    })
    const view = render(<Harness preparePage={preparePage} />)
    if (handle === undefined) throw new Error('hook did not run')
    handle.loadOlder()
    await vi.waitFor(() => { expect(preparePage).toHaveBeenCalledTimes(1) })

    handle.setHasOlder(true)
    view.rerender(<Harness sessionId='s-2' preparePage={preparePage} />)
    expect(handle?.hasOlder).toBe(false)
    expect(handle?.pendingRef.current).toBe(false)
    handle?.loadOlder()
    await vi.waitFor(() => { expect(loadChatPageMock).toHaveBeenCalledTimes(2) })

    preparedResolvers[0]!([row(8)])
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(adopted).toEqual([])
    expect(handle?.pendingRef.current).toBe(true)

    resolveNextPage(page([row(3)]))
    await vi.waitFor(() => { expect(preparePage).toHaveBeenCalledTimes(2) })
    preparedResolvers[1]!([row(3)])
    await vi.waitFor(() => { expect(adopted.map(rows => rows.map(entry => (entry as Row).seq))).toEqual([[3]]) })
  })

  it('does not surface an old session request failure after switching', async () => {
    let rejectPage!: (reason: unknown) => void
    const errors: unknown[] = []
    const loadingStates: boolean[] = []
    loadChatPageMock.mockImplementation(() => new Promise<ChatPageResult>((_resolve, reject) => { rejectPage = reject }))
    const view = render(<Harness onError={reason => errors.push(reason)} onLoading={loading => loadingStates.push(loading)} />)
    if (handle === undefined) throw new Error('hook did not run')
    handle.loadOlder()

    view.rerender(<Harness sessionId='s-2' onError={reason => errors.push(reason)} onLoading={loading => loadingStates.push(loading)} />)
    rejectPage(new Error('stale session failure'))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(errors).toEqual([])
    expect(loadingStates).toEqual([true])
    expect(handle?.pendingRef.current).toBe(false)
  })

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

  it('keeps hasOlder for an empty page when the host still has more (skewed cursor is not the end)', async () => {
    loadChatPageMock.mockResolvedValue(page([], true))
    render(<Harness />)
    if (handle === undefined) throw new Error('hook did not run')
    handle.setHasOlder(true)
    handle.loadOlder()
    await vi.waitFor(() => { expect(prepared).toHaveLength(1) })
    expect(handle.hasOlder).toBe(true)
  })

  it('clears hasOlder when the empty page is also the end of history', async () => {
    // 真机：到头之后按钮还挂着，用户一直点「加载更早的消息」屏幕上什么都不发生
    // （看起来就是"加载不出来"）。空页 + 宿主明确说没更多 = 真的到头，收起按钮。
    loadChatPageMock.mockResolvedValue(page([], false))
    render(<Harness />)
    if (handle === undefined) throw new Error('hook did not run')
    handle.setHasOlder(true)
    handle.loadOlder()
    await vi.waitFor(() => { expect(prepared).toHaveLength(1) })
    expect(handle.hasOlder).toBe(false)
  })

  it('coalesces a request that arrives while a page is in flight', async () => {
    let resolveFirst!: (value: ChatPageResult) => void
    loadChatPageMock
      .mockImplementationOnce(() => new Promise<ChatPageResult>(resolve => { resolveFirst = resolve }))
      .mockResolvedValueOnce(page([row(3)]))
    render(<Harness />)
    if (handle === undefined) throw new Error('hook did not run')
    handle.loadOlder()
    handle.loadOlder(false, 5, false, 40)
    expect(loadChatPageMock).toHaveBeenCalledTimes(1)
    resolveFirst(page([row(8)]))
    await vi.waitFor(() => { expect(loadChatPageMock).toHaveBeenCalledTimes(2) })
    // The queued request used its own cursor.
    expect(loadChatPageMock.mock.calls[1]![1]).toBe(5)
    expect(loadChatPageMock.mock.calls[1]![5]).toBe(40)
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
