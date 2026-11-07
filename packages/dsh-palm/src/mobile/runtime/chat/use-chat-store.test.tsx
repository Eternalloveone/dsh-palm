// @vitest-environment jsdom
/**
 * Store 的 React 绑定（W3-2）：dispatch 必须引起重渲染，退订后不再响应。
 */
import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createChatStore } from './store.ts'
import { useChatSessionStore, useChatState } from './use-chat-store.ts'

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

describe('useChatSessionStore', () => {
  it('setter 直接改 store：setLoading / setError / setTitle', () => {
    const seen: string[] = []
    let api: ReturnType<typeof useChatSessionStore> | undefined

    function Probe(): null {
      const chat = useChatSessionStore('初始标题')
      api = chat
      seen.push(`${chat.state.phase}:${chat.state.title ?? '-'}:${chat.state.notice ?? '-'}`)
      return null
    }

    render(<Probe />)
    expect(seen[0]).toBe('loading:初始标题:-')

    act(() => { api?.setLoading(false) })
    act(() => { api?.setError('发送失败') })
    act(() => { api?.setTitle('新标题') })
    act(() => { api?.setError(undefined) })

    expect(seen.at(-1)).toBe('ready:新标题:-')
    expect(api?.store.getState().notice).toBeUndefined()
  })

  it('没有初始标题时 title 为 undefined（由调用方退回 props）', () => {
    let title: string | undefined = 'sentinel'
    function Probe(): null {
      title = useChatSessionStore().state.title
      return null
    }
    render(<Probe />)
    expect(title).toBeUndefined()
  })
})
