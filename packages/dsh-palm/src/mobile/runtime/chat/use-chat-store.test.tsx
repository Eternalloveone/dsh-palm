// @vitest-environment jsdom
/**
 * Store 的 React 绑定（W3-2）：dispatch 必须引起重渲染，退订后不再响应。
 */
import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createChatStore } from './store.ts'
import { useChatState } from './use-chat-store.ts'

describe('useChatState', () => {
  it('dispatch 后组件读到新状态', () => {
    const store = createChatStore()
    const seen: string[] = []
    function Probe(): null {
      const state = useChatState(store)
      seen.push(`${state.phase}:${state.title ?? '-'}`)
      return null
    }

    render(<Probe />)
    act(() => { store.dispatch({ type: 'session/titled', title: '甲' }) })
    act(() => { store.dispatch({ type: 'session/ready' }) })

    expect(seen).toEqual(['idle:-', 'idle:甲', 'ready:甲'])
  })

  it('无变化的 action 不触发重渲染', () => {
    const store = createChatStore()
    let renders = 0
    function Probe(): null {
      useChatState(store)
      renders += 1
      return null
    }

    render(<Probe />)
    const before = renders
    act(() => { store.dispatch({ type: 'intent/send-settled' }) })
    expect(renders).toBe(before)
  })
})
