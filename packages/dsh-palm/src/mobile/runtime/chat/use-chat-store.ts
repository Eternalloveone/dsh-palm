/**
 * Chat Store 的 React 绑定（W3-2）：本文件是**唯一**允许把 store 接进 React 的地方，
 * 用 `useSyncExternalStore` 订阅（它天然处理并发渲染下的"快照撕裂"）。
 *
 * @module dsh-palm/mobile/runtime/chat/use-chat-store
 */
import { useCallback, useRef, useSyncExternalStore } from 'react'
import { createChatStore, INITIAL_CHAT_STATE, type ChatState, type ChatStore, type RegeneratePhase } from './store.ts'

/** 订阅整个状态：任何字段变化都重渲染（当前 store 很小，先求正确）。 */
export function useChatState(store: ChatStore): ChatState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}

/** 只订阅选中的字段：`Object.is` 去重 —— 选中的值没变就**不重渲染**。
 *  一次发送里 `sending` 翻转两次，整表订阅会让整个 ChatView 重建两次；selector 必须
 *  返回标量或稳定引用（返回新对象等于每次"都变了"，会无限重渲染）。 */
export function useChatSelector<T>(store: ChatStore, selector: (state: ChatState) => T): T {
  const seen = useRef<T | undefined>(undefined)
  const read = (): T => {
    const next = selector(store.getState())
    if (!Object.is(seen.current, next)) seen.current = next
    return seen.current as T
  }
  return useSyncExternalStore(store.subscribe, read, read)
}

export interface ChatSessionStore {
  store: ChatStore
  /** 会话页只订阅这三个字段：sending/stopping/regenerate 由消费方自己订阅。 */
  state: { phase: ChatState['phase']; notice: string | undefined; title: string | undefined }
  /** 装载中/装载完成（原 `setLoading`）。 */
  setLoading: (loading: boolean) => void
  /** 瞬时提示，`undefined` 表示清除（原 `setError`）。 */
  setError: (message: string | undefined) => void
  /** 标题（重命名立刻生效）。 */
  setTitle: (title: string) => void
  /** 发送在途（原 `setSending`）。 */
  setSending: (sending: boolean) => void
  /** 停止请求在途（原 `setStopping`）。 */
  setStopping: (stopping: boolean) => void
  /** 重新生成的在途状态。 */
  setRegenerate: (phase: RegeneratePhase) => void
  /** 换会话：清掉上一场的在途意图（发送/停止/重新生成）并打上本场标记。 */
  resetSession: (scope: string) => void
}

/** 一条会话一个 store：首次渲染时创建，之后靠 ref 复用（重渲染不会丢状态）。
 *  初始标题取自会话列表（可能比历史页先到），之后由 `session/titled` 覆盖。
 *
 *  @param initialTitle 首帧标题
 *  @param scope 会话 id：store 是**实例级**的，换了会话它里面还是上一场的装载阶段/
 *  标题/提示。这里按会话把它们在**读取时**判掉（返回 `loading` / 无标题 / 无提示），
 *  否则复用实例的新会话第一帧画的是"空会话"而不是骨架屏；紧接着那条装载 effect 会
 *  按新会话写回真值。 */
export function useChatSessionStore(initialTitle?: string, scope?: string): ChatSessionStore {
  const ref = useRef<ChatStore | undefined>(undefined)
  if (ref.current === undefined) {
    ref.current = createChatStore({
      ...INITIAL_CHAT_STATE,
      phase: 'loading',
      ...(scope === undefined ? {} : { scope }),
      ...(initialTitle === undefined ? {} : { title: initialTitle }),
    })
  }
  const store = ref.current
  const phase = useChatSelector(store, (state) => state.phase)
  const notice = useChatSelector(store, (state) => state.notice)
  const title = useChatSelector(store, (state) => state.title)
  const marked = useChatSelector(store, (state) => state.scope)
  // store 里装的是**哪一场**：标记与会话不符说明这一帧还是上一场的装载阶段/标题。
  // 判据放在 store 的标记上（而不是渲染期改写 ref），重渲染几次结果都一样。
  const switched = scope !== undefined && marked !== scope
  const state = switched
    ? { phase: 'loading' as const, notice: undefined, title: undefined }
    : { phase, notice, title }

  const setLoading = useCallback((loading: boolean): void => {
    store.dispatch(loading ? { type: 'session/loading' } : { type: 'session/ready' })
  }, [store])
  const setError = useCallback((message: string | undefined): void => {
    store.dispatch(message === undefined ? { type: 'notice/clear' } : { type: 'notice/set', notice: message })
  }, [store])
  const setTitle = useCallback((title: string): void => {
    store.dispatch({ type: 'session/titled', title })
  }, [store])
  const setSending = useCallback((sending: boolean): void => {
    store.dispatch(sending ? { type: 'intent/send-start', at: Date.now() } : { type: 'intent/send-settled' })
  }, [store])
  const setStopping = useCallback((stopping: boolean): void => {
    store.dispatch(stopping ? { type: 'intent/stop-start' } : { type: 'intent/stop-settled' })
  }, [store])
  const setRegenerate = useCallback((phase: RegeneratePhase): void => {
    store.dispatch({ type: 'intent/regenerate', phase })
  }, [store])
  const resetSession = useCallback((scope: string): void => {
    store.dispatch({ type: 'session/reset', scope })
  }, [store])

  return { store, state, setLoading, setError, setTitle, setSending, setStopping, setRegenerate, resetSession }
}
