// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useChatSession } from './use-chat-session.ts'
import type { RenderMessage } from '../../messages.ts'

function row(id: string, seq = 1, overrides: Partial<RenderMessage> = {}): RenderMessage {
  return { id, role: 'assistant', text: id, seq, ...overrides } as RenderMessage
}

describe('useChatSession', () => {
  it('starts from the given rows and commits a functional update', () => {
    const { result } = renderHook(() => useChatSession({
      sessionId: 's-1',
      initialRows: [row('a', 1)],
      getOpenTurn: () => undefined,
    }))
    expect(result.current.rows.map(entry => entry.id)).toEqual(['a'])

    act(() => {
      result.current.commitRows(previous => [...previous, row('b', 2)])
    })
    expect(result.current.rows.map(entry => entry.id)).toEqual(['a', 'b'])
  })

  it('dedupes by id on a union commit', () => {
    const { result } = renderHook(() => useChatSession({
      sessionId: 's-1',
      initialRows: [row('a', 1)],
      getOpenTurn: () => undefined,
    }))
    act(() => {
      result.current.commitRows([row('a', 1), row('b', 2)])
    })
    expect(result.current.rows.map(entry => entry.id)).toEqual(['a', 'b'])
  })

  it('replaces the list when merge is false', () => {
    const { result } = renderHook(() => useChatSession({
      sessionId: 's-1',
      initialRows: [row('a', 1), row('b', 2)],
      getOpenTurn: () => undefined,
    }))
    act(() => {
      result.current.commitRows([row('c', 3)], { merge: false })
    })
    expect(result.current.rows.map(entry => entry.id)).toEqual(['c'])
  })

  it('passes the open turn to the fold (rows without a turn stay attributed)', () => {
    const { result } = renderHook(() => useChatSession({
      sessionId: 's-1',
      initialRows: [],
      getOpenTurn: () => 7,
    }))
    act(() => {
      result.current.commitRows([row('stream', 1)])
    })
    expect(result.current.rows).toHaveLength(1)
  })
})
