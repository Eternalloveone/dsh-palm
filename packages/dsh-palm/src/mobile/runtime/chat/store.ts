/**
 * Chat Store（W3-2 的第一步）：把"会话运行态"从 63 个 useState 里搬出来。
 *
 * 为什么要有它（病灶）：ChatView 现在有 25 个**机器状态**（见
 * `ui-refactor/w3-1-state-inventory.md`），它们描述的是"这条会话现在是什么状态"，
 * 却住在组件里。于是：
 * - 组件卸载就丢（切走再回来要重新猜）；
 * - 三个地方各存一份，谁先到谁赢（重复投递、计时回跳都出在这）；
 * - 想从别的屏读一眼（会话列表的"运行中"标记），只能再发一次请求。
 *
 * 这里的约定：
 * - **纯 reducer + 极简订阅**，本文件不 import React（架构断言钉住）；
 * - 状态不可变更新，订阅者拿到新对象；
 * - 只接管"跨组件、跨时间仍然成立"的事实；展开/选中这类 UI 局部状态**不进来**。
 *
 * @module dsh-palm/mobile/runtime/chat/store
 */

/** 会话装载阶段。 */
export type SessionPhase = 'idle' | 'loading' | 'ready' | 'error'

/** 一次「重新生成」的在途状态。 */
export type RegeneratePhase = 'idle' | 'busy' | 'failed'

export interface ChatState {
  /** 会话装载阶段：决定骨架屏/错误页/正文。 */
  readonly phase: SessionPhase
  /**
   * **瞬时**提示文案（发送失败、权限没注册……）。
   *
   * 与 `error` 分开是刻意的：`phase='error'` 表示"整页加载失败，只该看到错误页"，
   * 而这类提示出现在正文旁边，页面本身是好的。混成一个字段，一次发送失败就会
   * 把整屏切成错误页。
   */
  readonly notice?: string
  /** 装载失败原因（用户可见文案）。 */
  readonly error?: string
  /** 会话标题；重命名后由 `session/titled` 覆盖。 */
  readonly title?: string
  /** 有一条消息正在发（含乐观项）。 */
  readonly sending: boolean
  /** 停止请求在途：按钮据此禁用，防重复点。 */
  readonly stopping: boolean
  /** 重新生成的在途状态。 */
  readonly regenerate: RegeneratePhase
  /** 最近一次成功发送的时间（单调时钟，用于"刚刚发送"这类判断）。 */
  readonly lastSentAt?: number
  /**
   * 这份状态属于哪个会话（`session/reset` 打上的标记）。
   *
   * 会话页实例是**跨会话活着**的，所以 store 里随时可能装着上一场的装载阶段与标题。
   * 读的一方按这个标记判：标记与会话不一致就当"还在装载"，免得新会话第一帧画的是
   * 上一场的标题/空正文。
   */
  readonly scope?: string
}

export const INITIAL_CHAT_STATE: ChatState = {
  phase: 'idle',
  sending: false,
  stopping: false,
  regenerate: 'idle',
}

export type ChatAction =
  | { type: 'session/loading' }
  | { type: 'session/ready' }
  | { type: 'session/failed'; error: string }
  | { type: 'session/titled'; title: string }
  | { type: 'notice/set'; notice: string }
  | { type: 'notice/clear' }
  | { type: 'intent/send-start'; at: number }
  | { type: 'intent/send-settled' }
  | { type: 'intent/stop-start' }
  | { type: 'intent/stop-settled' }
  | { type: 'intent/regenerate'; phase: RegeneratePhase }
  | { type: 'session/reset'; scope: string }

/**
 * 纯 reducer：同输入必同输出，便于回放与测试。
 *
 * 幂等的地方要幂等：重复 `session/loading` 不再产生新对象（订阅者不该被噪音唤醒）。
 */
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'session/loading':
      return state.phase === 'loading' ? state : { ...state, phase: 'loading', error: undefined }
    case 'session/ready':
      return state.phase === 'ready' ? state : { ...state, phase: 'ready', error: undefined }
    case 'session/failed':
      return { ...state, phase: 'error', error: action.error }
    case 'session/titled':
      return state.title === action.title ? state : { ...state, title: action.title }
    case 'notice/set':
      return state.notice === action.notice ? state : { ...state, notice: action.notice }
    case 'notice/clear':
      return state.notice === undefined ? state : { ...state, notice: undefined }
    case 'intent/send-start':
      return state.sending ? state : { ...state, sending: true, lastSentAt: action.at }
    case 'intent/send-settled':
      return state.sending ? { ...state, sending: false } : state
    case 'intent/stop-start':
      return state.stopping ? state : { ...state, stopping: true }
    case 'intent/stop-settled':
      return state.stopping ? { ...state, stopping: false } : state
    case 'intent/regenerate':
      return state.regenerate === action.phase ? state : { ...state, regenerate: action.phase }
    case 'session/reset':
      // 换会话：**在途意图属于上一场**，必须归零。`sending=true` 会让新会话的主键
      // 一直灰着（用户口径：「换过去发不出消息」）；`stopping`/`regenerate` 同理。
      // `scope` 打上这一场的标记，读的一方据此判"装载阶段/标题是不是这一场的"。
      // 装载阶段/标题/提示不在这里清 —— 切换处紧接着就按新会话写它们。
      return !state.sending && !state.stopping && state.regenerate === 'idle' && state.scope === action.scope
        ? state
        : { ...state, sending: false, stopping: false, regenerate: 'idle', scope: action.scope }
    default:
      return state
  }
}

/** 订阅者签名；返回退订函数。 */
export type ChatStoreListener = (state: ChatState) => void

export interface ChatStore {
  getState: () => ChatState
  dispatch: (action: ChatAction) => void
  subscribe: (listener: ChatStoreListener) => () => void
}

/**
 * 造一个 store。
 *
 * 刻意不引第三方状态库：这里只需要"一个对象 + 一组监听者"，
 * 引库会把 5,000 行的迁移变成"换框架"，风险与收益不成比例。
 */
export function createChatStore(initial: ChatState = INITIAL_CHAT_STATE): ChatStore {
  let state = initial
  const listeners = new Set<ChatStoreListener>()

  const getState = (): ChatState => state

  const dispatch = (action: ChatAction): void => {
    const next = chatReducer(state, action)
    // 引用没变＝这次 action 不改变任何事实，不唤醒订阅者。
    if (next === state) return
    state = next
    // 逐个通知，并且**隔离**：一个订阅者抛错不该让其他订阅者收不到状态，
    // 也不该让发送流程整条崩掉；错误收集起来在最后重新抛给调用方（不静默吞）。
    let failure: unknown
    for (const listener of [...listeners]) {
      try {
        listener(state)
      } catch (error) {
        failure ??= error
      }
    }
    if (failure !== undefined) throw failure
  }

  const subscribe = (listener: ChatStoreListener): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  return { getState, dispatch, subscribe }
}
