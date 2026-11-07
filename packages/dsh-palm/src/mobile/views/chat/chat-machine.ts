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
    return built as unknown as ChatUiSetters
  }, [])

  return [state, setters] as const
}


/* ── 会话内搜索（S1-B） ─────────────────────────────────────────────────
 *
 * 搜索和"浮层开关"不一样：它有**异步阶段**。原来这些字段散成 7 个 useState，
 * 谁能同时为真完全靠读代码推。收进一个接口后，"搜索现在处于什么阶段"变成一眼可见：
 *
 *   idle      → term 空、busy 假、warming 假
 *   warming   → 索引还在后台建（宿主回 fallback），如实提示，别假装搜过
 *   busy      → 查询在飞
 *   jumping   → 命中在已加载窗口之外，正在翻那一页（1~3 秒），计数旁要说一声
 *   done      → busy 假、hasMore 表示"宿主上限以上还有"
 */

/** 会话内搜索的界面字段。 */
export interface ChatSearchState {
  /** 搜索条是否展开。 */
  open: boolean
  /** 当前搜索词（输入框的实时值）。 */
  term: string
  /** 命中总数/当前下标的基准时间戳（用于"结果没变就别重算"）。 */
  at: number
  /** 查询在飞。 */
  busy: boolean
  /** 命中在已加载窗口外、正在翻页。 */
  jumping: boolean
  /** 宿主上限以上还有命中（显示成 "3/200+"）。 */
  hasMore: boolean
  /** 索引还在后台建（宿主回 fallback）。 */
  warming: boolean
  /** "正在输入"计数：输入法组字期间不触发查询。 */
  composeTick: number
}

/** 搜索切片的初始值。 */
export const INITIAL_CHAT_SEARCH: ChatSearchState = {
  open: false,
  term: '',
  at: 0,
  busy: false,
  jumping: false,
  hasMore: false,
  warming: false,
  composeTick: 0,
}

/** 搜索切片的状态键。 */
export const CHAT_SEARCH_KEYS = [
  'open', 'term', 'at', 'busy', 'jumping', 'hasMore', 'warming', 'composeTick',
] as const satisfies ReadonlyArray<keyof ChatSearchState>

/** 动作：给某个字段赋值（值在外面算好，reducer 保持纯）。 */
export type ChatSearchAction = {
  [K in keyof ChatSearchState]: { type: 'set'; key: K; value: ChatSearchState[K] }
}[keyof ChatSearchState]

/** 纯 reducer。 */
export function chatSearchReducer(state: ChatSearchState, action: ChatSearchAction): ChatSearchState {
  if (state[action.key] === action.value) return state
  return { ...state, [action.key]: action.value } as ChatSearchState
}

/** 每个字段一个 setter，签名与 useReducer 的 dispatch 用法一致。 */
export type ChatSearchSetters = {
  [K in keyof ChatSearchState]: (value: ChatSearchState[K] | ((previous: ChatSearchState[K]) => ChatSearchState[K])) => void
}

/** @returns 搜索界面状态 + 各字段 setter。 */
export function useChatSearch(): readonly [ChatSearchState, ChatSearchSetters] {
  const [state, dispatch] = useReducer(chatSearchReducer, INITIAL_CHAT_SEARCH)
  const latest = useRef(state)
  latest.current = state

  const setters = useMemo(() => {
    // 逐键赋值用宽类型累加，最后一次性断言：联合键索引写入会让 TS 生成交叉函数类型。
    const built: Record<string, unknown> = {}
    for (const key of CHAT_SEARCH_KEYS) {
      // 每个键的 setter 都接受"值"或"prev => next"，语义与 useState 一致。
      built[key] = ((value: unknown) => {
        const next = typeof value === 'function'
          ? (value as (previous: unknown) => unknown)(latest.current[key])
          : value
        dispatch({ type: 'set', key, value: next } as ChatSearchAction)
      }) as ChatSearchSetters[typeof key]
    }
    return built as unknown as ChatSearchSetters
  }, [])

  return [state, setters] as const
}


/* ── 滚动与阅读位置（S1-C） ─────────────────────────────────────────────
 *
 * 这四个值由滚动驱动（`handleScroll` 与定位流程），是**读者在哪**的投影：
 *
 *   currentTurn       视口顶部那一行的轮次（滑条读数、轮次高亮）
 *   showJumpToLatest  离底超过阈值才出现的「回到最新」按钮
 *   unreadCount       没读到的轮次数（滚回底就清零）
 *   locateTick        定位 effect 的触发键（每次定位 +1）
 *
 * 它们不能只当"几个数字"看：**必须同时是同一个状态机的一部分**，否则会出现
 * 「按钮出现了但未读数没清」「定位触发了但轮次没跟」这类只在真机复现的错位。
 */

/** 阅读位置状态。 */
export interface ChatReadingState {
  /** 视口顶部那一行的轮次；0 表示还没有位置（渲染侧回退到最新轮）。 */
  currentTurn: number
  /** 是否显示「回到最新消息」按钮。 */
  showJumpToLatest: boolean
  /** 未读轮次计数。 */
  unreadCount: number
  /** 定位触发键：每次定位递增，驱动定位 effect 重跑。 */
  locateTick: number
}

/** 阅读位置初值。 */
export const INITIAL_CHAT_READING: ChatReadingState = {
  currentTurn: 0,
  showJumpToLatest: false,
  unreadCount: 0,
  locateTick: 0,
}

/** 阅读位置的状态键。 */
export const CHAT_READING_KEYS = [
  'currentTurn', 'showJumpToLatest', 'unreadCount', 'locateTick',
] as const satisfies ReadonlyArray<keyof ChatReadingState>

/** 动作。 */
export type ChatReadingAction = {
  [K in keyof ChatReadingState]: { type: 'set'; key: K; value: ChatReadingState[K] }
}[keyof ChatReadingState]

/** 纯 reducer。 */
export function chatReadingReducer(state: ChatReadingState, action: ChatReadingAction): ChatReadingState {
  if (state[action.key] === action.value) return state
  return { ...state, [action.key]: action.value } as ChatReadingState
}

/** 各字段 setter（与 useState 的 setter 同签名）。 */
export type ChatReadingSetters = {
  [K in keyof ChatReadingState]: (value: ChatReadingState[K] | ((previous: ChatReadingState[K]) => ChatReadingState[K])) => void
}

/** @returns 阅读位置状态 + setter。 */
export function useChatReading(): readonly [ChatReadingState, ChatReadingSetters] {
  const [state, dispatch] = useReducer(chatReadingReducer, INITIAL_CHAT_READING)
  const latest = useRef(state)
  latest.current = state
  const setters = useMemo(() => {
    const built: Record<string, unknown> = {}
    for (const key of CHAT_READING_KEYS) {
      built[key] = (value: unknown) => {
        const next = typeof value === 'function'
          ? (value as (previous: unknown) => unknown)(latest.current[key])
          : value
        dispatch({ type: 'set', key, value: next } as ChatReadingAction)
      }
    }
    return built as unknown as ChatReadingSetters
  }, [])
  return [state, setters] as const
}
