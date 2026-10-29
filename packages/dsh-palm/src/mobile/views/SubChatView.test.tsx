// @vitest-environment jsdom
/**
 * SubChatView：子代理只读会话页的轮询闸门。
 *
 * 这一页以前是无条件每 5 秒读一次尾页：切到后台还在打宿主，子会话早跑完了也照打。
 * 现在两道闸——页面不可见不打；这一轮收口（`turnOpen === false`）就彻底停。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { SubChatView, SUBCHAT_POLL_MS } from './SubChatView.tsx'

const api = vi.hoisted(() => ({ logTail: vi.fn() }))
vi.mock('../api.ts', () => api)

const page = (turnOpen: boolean, text: string) => ({
  rows: [{ id: 'a1', kind: 'assistant', text, seq: 5, time: 1_700_000_000_000 }],
  maxSeq: 5,
  hasMore: false,
  turnOpen,
  lastEventAt: Date.now(),
})

beforeEach(() => {
  api.logTail.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('SubChatView 轮询闸门', () => {
  it('这一轮收口后不再轮询（只读页看的是记录）', async () => {
    api.logTail.mockResolvedValue(page(false, '干完了'))
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<SubChatView sessionId="child-1" label="子代理" onBack={() => {}} />)
    expect(await screen.findByText('干完了')).toBeTruthy()
    const before = api.logTail.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(SUBCHAT_POLL_MS * 6) })
    expect(api.logTail.mock.calls.length).toBe(before)
  })

  it('这一轮还开着时继续轮询', async () => {
    api.logTail.mockResolvedValue(page(true, '还在跑'))
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<SubChatView sessionId="child-2" label="子代理" onBack={() => {}} />)
    expect(await screen.findByText('还在跑')).toBeTruthy()
    const before = api.logTail.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(SUBCHAT_POLL_MS * 2) })
    expect(api.logTail.mock.calls.length).toBeGreaterThan(before)
  })
})
