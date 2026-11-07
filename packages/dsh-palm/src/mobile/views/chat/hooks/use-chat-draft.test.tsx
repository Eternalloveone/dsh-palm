// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DRAFT_SAVE_DEBOUNCE_MS, useChatDraft } from './use-chat-draft.ts'

vi.mock('../../../session/list-persist.ts', () => ({
  loadDraft: vi.fn(() => ''),
  saveDraft: vi.fn(),
  removeDraft: vi.fn(),
}))

import { loadDraft, removeDraft, saveDraft } from '../../../session/list-persist.ts'

const loadMock = vi.mocked(loadDraft)
const saveMock = vi.mocked(saveDraft)
const removeMock = vi.mocked(removeDraft)

let setDraft: ((next: string) => void) | undefined

function Harness({ sessionId }: { sessionId: string }) {
  const draft = useChatDraft(sessionId)
  setDraft = draft.setInput
  return <div data-testid="draft">{draft.input}</div>
}

beforeEach(() => {
  setDraft = undefined
  vi.clearAllMocks()
  loadMock.mockReturnValue('')
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useChatDraft', () => {
  it('restores the stored draft on mount', () => {
    loadMock.mockReturnValue('上次没发完的一句')
    const view = render(<Harness sessionId="s-1" />)
    expect(view.getByTestId('draft').textContent).toBe('上次没发完的一句')
    expect(loadMock).toHaveBeenCalledWith('s-1')
  })

  it('restores once the real session id arrives (first mount had none)', async () => {
    // 聊天页先以空 sessionId 挂上：真机表现是草稿永远空。
    loadMock.mockImplementation((id: string) => (id === 's-1' ? '晚到的草稿' : ''))
    const view = render(<Harness sessionId="" />)
    expect(view.getByTestId('draft').textContent).toBe('')
    view.rerender(<Harness sessionId="s-1" />)
    await waitFor(() => { expect(view.getByTestId('draft').textContent).toBe('晚到的草稿') })
  })

  it('debounces writes while typing', () => {
    vi.useFakeTimers()
    render(<Harness sessionId="s-1" />)
    act(() => { setDraft?.('一') })
    act(() => { setDraft?.('一二') })
    expect(saveMock).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(DRAFT_SAVE_DEBOUNCE_MS + 10) })
    expect(saveMock).toHaveBeenCalledWith('s-1', '一二')
  })

  it('drops the stored draft only on the non-empty → empty transition', () => {
    vi.useFakeTimers()
    render(<Harness sessionId="s-1" />)
    act(() => { vi.advanceTimersByTime(DRAFT_SAVE_DEBOUNCE_MS + 10) })
    // 一进来就是空：不能当成"用户删光了"，否则切会话会把别人的草稿删掉。
    expect(removeMock).not.toHaveBeenCalled()
    act(() => { setDraft?.('删我之前') })
    act(() => { setDraft?.('') })
    expect(removeMock).toHaveBeenCalledWith('s-1')
  })

  it('flushes the current text on unmount even if the debounce never fired', () => {
    vi.useFakeTimers()
    const view = render(<Harness sessionId="s-1" />)
    act(() => { setDraft?.('还没落盘') })
    view.unmount()
    expect(saveMock).toHaveBeenCalledWith('s-1', '还没落盘')
  })
})
