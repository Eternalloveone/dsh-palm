/**
 * **聊天页的界面状态机**（S1：把 `ChatView.tsx` 里的 `useState` 收进一个 reducer）。
 *
 * ## 为什么要有这个文件
 *
 * `ChatView.tsx` 原本散着 30 个 `useState`、37 个 `useEffect`、39 个 `useRef`。行数只是症状，
 * 真正的病是**状态的先后顺序靠 effect 的执行顺序维持**——改一处不知道会推倒哪一处。
 *
 * 这里先把「纯界面开关」这一类收进 reducer：它们**没有异步、没有派生**，只有开和关。
 * 收益不是省行数，而是**状态集合变成可枚举的**：想知道这个页面同时可能处于哪些界面
 * 状态，看 `ChatUiState` 一个接口就够了。
 *
 * ## 为什么还留一层 setter
 *
 * 调用点目前形如 `setMoreOpen(false)` / `setRenaming(prev => !prev)`。直接全改成 `dispatch`
 * 会同时触碰上百个调用点，门禁红了也定位不到是谁坏的。所以给每个键生成一个**与 `useState`
 * 的 setter 同签名**的函数（支持函数式更新），调用点一行都不用改；后续切片再逐个换成 dispatch。
 *
 * @module dsh-palm/mobile/views/chat/chat-machine
 */
import { useMemo, useReducer, useRef } from 'react'

/** 纯界面开关。加字段前先想：它会不会被异步改变？会的话它不属于这一组。 */
export interface ChatUiState {
  /** 长按/右键消息弹出的上下文菜单。 */
  contextOpen: boolean
  /** 输入区「+」面板。 */
  plusOpen: boolean
  /** 宿主文件选择面板。 */
  hostFileOpen: boolean
  /** 斜杠命令面板。 */
  commandOpen: boolean
  /** 右上角「更多」面板。 */
  moreOpen: boolean
  /** 「更多」里的导出面板。 */
  exportOpen: boolean
  /** 「更多」里的 git 面板。 */
  gitOpen: boolean
  /** 轮次列表面板。 */
  turnListOpen: boolean
  /** 会话重命名对话框。 */
  renaming: boolean
  /** 会话删除确认。 */
  deleting: boolean
  /** 运行状态面板。 */
  runStatusOpen: boolean
}

/** 状态键集合（运行时也用得上：setter 按它生成）。 */
export const CHAT_UI_KEYS = [
  'contextOpen', 'plusOpen', 'hostFileOpen', 'commandOpen', 'moreOpen',
  'exportOpen', 'gitOpen', 'turnListOpen', 'renaming', 'deleting', 'runStatusOpen',
] as const satisfies ReadonlyArray<keyof ChatUiState>

/** 初始状态：全部关闭。 */
export const INITIAL_CHAT_UI: ChatUiState = {
  contextOpen: false,
  plusOpen: false,
  hostFileOpen: false,
  commandOpen: false,
  moreOpen: false,
  exportOpen: false,
  gitOpen: false,
  turnListOpen: false,
  renaming: false,
  deleting: false,
  runStatusOpen: false,
}

/** 动作：给某个开关赋值（值在外面算好，reducer 保持纯）。 */
export type ChatUiAction = { type: 'set'; key: keyof ChatUiState; value: boolean }

/** 纯 reducer：除了赋值什么都不做，因此不可能出现"顺序依赖"。 */
export function chatUiReducer(state: ChatUiState, action: ChatUiAction): ChatUiState {
  if (state[action.key] === action.value) return state
  return { ...state, [action.key]: action.value }
}

/** 与 `useState` 的 setter 同签名：既接受值，也接受 `prev => next`。 */
export type UiSetter = (value: boolean | ((previous: boolean) => boolean)) => void

/** 每个键一个 setter，调用点无需改动。 */
export type ChatUiSetters = Record<keyof ChatUiState, UiSetter>

/** @returns 当前开关状态 + 每个键的 setter（setter 在整个生命周期内稳定）。 */
export function useChatUi(): readonly [ChatUiState, ChatUiSetters] {
  const [state, dispatch] = useReducer(chatUiReducer, INITIAL_CHAT_UI)
  // 函数式更新要看到**当前**值，闭包里的 state 会过期，所以用 ref 兜住。
  const latest = useRef(state)
  latest.current = state

  const setters = useMemo(() => {
    const built = {} as ChatUiSetters
    for (const key of CHAT_UI_KEYS) {
      built[key] = (value) => {
        const next = typeof value === 'boolean' ? value : value(latest.current[key])
        dispatch({ type: 'set', key, value: next })
      }
    }
    return built
  }, [])

  return [state, setters] as const
}
