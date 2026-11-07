/**
 * Chat Store 的 React 绑定（W3-2）。
 *
 * store 本身是纯 reducer（`store.ts`，不 import React）；这个文件是**唯一**允许
 * 把 store 接进 React 的地方，用 `useSyncExternalStore` 订阅 —— 它天然处理
 * 并发渲染下的"快照撕裂"，比"useEffect + setState"少一类难查的闪烁。
 *
 * @module dsh-palm/mobile/runtime/chat/use-chat-store
 */
import { useCallback, useRef, useSyncExternalStore } from 'react'
import { createChatStore, INITIAL_CHAT_STATE, type ChatState, type ChatStore } from './store.ts'

/** 订阅整个状态：任何字段变化都重渲染（当前 store 很小，先求正确）。 */
export function useChatState(store: ChatStore): ChatState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}

export interface ChatSessionStore {
  store: ChatStore
  state: ChatState
  /** 装载中/装载完成（原 `setLoading`）。 */
  setLoading: (loading: boolean) => void
  /** 瞬时提示，`undefined` 表示清除（原 `setError`）。 */
  setError: (message: string | undefined) => void
  /** 标题（重命名立刻生效）。 */
  setTitle: (title: string) => void
}

/**
 * 一条会话一个 store：首次渲染时创建，之后靠 ref 复用（重渲染不会丢状态）。
 *
 * 初始标题取自会话列表（它可能比历史页先到），之后由 `session/titled` 覆盖。
 * 三个 setter 一起返回，是为了让调用点保持原来的写法（`setError('...')`），
 * 迁移只换"值存在哪"，不换"怎么调"。
 */
export function useChatSessionStore(initialTitle?: string): ChatSessionStore {
  const ref = useRef<ChatStore | undefined>(undefined)
  if (ref.current === undefined) {
    ref.current = createChatStore({
      ...INITIAL_CHAT_STATE,
      phase: 'loading',
      ...(initialTitle === undefined ? {} : { title: initialTitle }),
    })
  }
  const store = ref.current
  const state = useChatState(store)

  const setLoading = useCallback((loading: boolean): void => {
    store.dispatch(loading ? { type: 'session/loading' } : { type: 'session/ready' })
  }, [store])
  const setError = useCallback((message: string | undefined): void => {
    store.dispatch(message === undefined ? { type: 'notice/clear' } : { type: 'notice/set', notice: message })
  }, [store])
  const setTitle = useCallback((title: string): void => {
    store.dispatch({ type: 'session/titled', title })
  }, [store])

  return { store, state, setLoading, setError, setTitle }
}
