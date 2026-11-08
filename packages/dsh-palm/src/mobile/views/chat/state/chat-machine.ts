/**
 * **聊天页的界面状态机**（S1：把 `ChatView.tsx` 里的 30 个 `useState` 收进四个切片）。
 *
 * ## 为什么要有这个文件
 *
 * `ChatView.tsx` 原本散着 30 个 `useState`、37 个 `useEffect`、39 个 `useRef`。行数只是症状，
 * 真正的病是**状态的先后顺序靠 effect 的执行顺序维持**——改一处不知道会推倒哪一处。
 *
 * 收进切片之后，「这个页面同时可能处于哪些界面状态」变成四个可枚举的接口：
 *
 * | 切片 | 管什么 | 特点 |
 * |---|---|---|
 * | `ChatUiState` | 浮层开关 | 纯布尔，无异步 |
 * | `ChatSearchState` | 会话内搜索 | **有异步阶段**（warming / busy / jumping） |
 * | `ChatReadingState` | 滚动与阅读位置 | 由滚动驱动，**必须同属一个状态机** |
 * | `ChatComposerState` | 输入区与连接 | 两个值的外部真相源要写清楚 |
 *
 * ## 四个切片共用一套机器
 *
 * 四个切片的行为一模一样（都是"给某个字段赋值，值相等就不换引用"），所以只写一份
 * `useSlice`，每个切片只是「接口 + 初值 + 键表」。**重复四遍的代码本身就是新的债务**。
 *
 * ## 为什么还留一层 setter
 *
 * 调用点目前形如 `setMoreOpen(false)` / `setRenaming(prev => !prev)`。直接全改成 `dispatch`
 * 会同时触碰上百个调用点，门禁红了也定位不到是谁坏的。所以 setter 与 `useState` 的
 * setter 同签名（支持函数式更新），调用点一行都不用改；后续切片再逐个换成 dispatch。
 *
 * @module dsh-palm/mobile/views/chat/chat-machine
 */
import { useMemo, useReducer, useRef } from 'react'

/* ── 共用机器 ─────────────────────────────────────────────────────────── */

/** 一个切片上的"给某字段赋值"动作。 */
type SetAction<S> = { [K in keyof S]: { type: 'set'; key: K; value: S[K] } }[keyof S]

/**
 * 纯 reducer：只做赋值，值相等时**返回原引用**（React 会跳过重渲染）。
 *
 * 因为除了赋值什么都不做，所以**不可能出现顺序依赖**——这正是它比 30 个
 * `useState` + 37 个 `useEffect` 好推理的地方。
 */
export function sliceReducer<S extends object>(state: S, action: SetAction<S>): S {
  if (state[action.key] === action.value) return state
  return { ...state, [action.key]: action.value } as S
}

/** 每个字段一个 setter，签名与 `useState` 的 setter 一致。 */
export type SliceSetters<S> = {
  [K in keyof S]: (value: S[K] | ((previous: S[K]) => S[K])) => void
}

/**
 * 一个切片的 React 适配层。
 *
 * @param initial 初值（同时定义这个切片有哪些键）
 * @param keys 键表（用于生成 setter；键必须与 `initial` 一致）
 */
function useSlice<S extends object>(
  initial: S,
  keys: readonly (keyof S)[],
): readonly [S, SliceSetters<S>] {
  const [state, dispatch] = useReducer(
    (current: S, action: SetAction<S>) => sliceReducer(current, action),
    initial,
  )
  // 函数式更新要看到**当前**值，闭包里的 state 会过期，所以用 ref 兜住。
  const latest = useRef(state)
  latest.current = state

  const setters = useMemo(() => {
    const built: Record<string, unknown> = {}
    for (const key of keys) {
      built[String(key)] = (value: unknown) => {
        const next = typeof value === 'function'
          ? (value as (previous: unknown) => unknown)(latest.current[key])
          : value
        dispatch({ type: 'set', key, value: next } as SetAction<S>)
      }
    }
    return built as unknown as SliceSetters<S>
  }, [keys])

  return [state, setters] as const
}

/* ── 切片一：浮层开关（S1-A） ─────────────────────────────────────────── */

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
  /** 会话重命名对话框。 */
  renaming: boolean
  /** 会话删除确认。 */
  deleting: boolean
  /** 运行状态面板。 */
  runStatusOpen: boolean
}

/** 状态键。 */
export const CHAT_UI_KEYS = [
  'contextOpen', 'plusOpen', 'hostFileOpen', 'commandOpen', 'moreOpen',
  'exportOpen', 'gitOpen', 'renaming', 'deleting', 'runStatusOpen',
] as const satisfies ReadonlyArray<keyof ChatUiState>

/** 初值：全部关闭。 */
export const INITIAL_CHAT_UI: ChatUiState = {
  contextOpen: false,
  plusOpen: false,
  hostFileOpen: false,
  commandOpen: false,
  moreOpen: false,
  exportOpen: false,
  gitOpen: false,
  renaming: false,
  deleting: false,
  runStatusOpen: false,
}

/** @returns 浮层开关状态 + setter。 */
export function useChatUi(): readonly [ChatUiState, SliceSetters<ChatUiState>] {
  return useSlice(INITIAL_CHAT_UI, CHAT_UI_KEYS)
}

/* ── 切片二：会话内搜索（S1-B） ───────────────────────────────────────── */

/**
 * 搜索和"浮层开关"不一样：它有**异步阶段**。原来这些字段散成 8 个 useState，
 * "谁能同时为真"完全靠读代码推。收进一个接口后：
 *
 * - `warming`：索引还在后台建（宿主回 fallback），如实提示，别假装搜过
 * - `busy`：查询在飞
 * - `jumping`：命中在已加载窗口之外、正在翻那一页（1~3 秒），计数旁要说一声
 */
export interface ChatSearchState {
  /** 搜索条是否展开。 */
  open: boolean
  /** 当前搜索词（输入框实时值）。 */
  term: string
  /** 结果基准时间戳（"结果没变就别重算"）。 */
  at: number
  /** 查询在飞。 */
  busy: boolean
  /** 命中在已加载窗口外、正在翻页。 */
  jumping: boolean
  /** 宿主上限以上还有命中（显示成 "3/200+"）。 */
  hasMore: boolean
  /** 索引还在后台建（宿主回 fallback）。 */
  warming: boolean
  /** 输入法组字计数：组字期间不触发查询。 */
  composeTick: number
}

/** 状态键。 */
export const CHAT_SEARCH_KEYS = [
  'open', 'term', 'at', 'busy', 'jumping', 'hasMore', 'warming', 'composeTick',
] as const satisfies ReadonlyArray<keyof ChatSearchState>

/** 初值。 */
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

/** @returns 搜索界面状态 + setter。 */
export function useChatSearch(): readonly [ChatSearchState, SliceSetters<ChatSearchState>] {
  return useSlice(INITIAL_CHAT_SEARCH, CHAT_SEARCH_KEYS)
}

/* ── 切片三：滚动与阅读位置（S1-C） ──────────────────────────────────── */

/**
 * 这几个值由滚动驱动，是**读者在哪**的投影。它们不能只当"几个数字"看：必须同时是同一个
 * 状态机的一部分，否则会出现「按钮出现了但未读数没清」「定位触发了但轮次没跟」这类
 * 只在真机复现的错位。
 */
export interface ChatReadingState {
  /** 视口顶部那一行的轮次；0 表示还没有位置（渲染侧回退到最新轮）。 */
  currentTurn: number
  /** 是否显示「回到最新消息」按钮。 */
  showJumpToLatest: boolean
  /** 未读轮次计数。 */
  unreadCount: number
  /** 定位触发键：每次定位递增，驱动定位 effect 重跑。 */
  locateTick: number
  /** 卡片同步触发键：宿主推来的卡片需要重算时递增。 */
  cardSyncTick: number
}

/** 状态键。 */
export const CHAT_READING_KEYS = [
  'currentTurn', 'showJumpToLatest', 'unreadCount', 'locateTick', 'cardSyncTick',
] as const satisfies ReadonlyArray<keyof ChatReadingState>

/** 初值。 */
export const INITIAL_CHAT_READING: ChatReadingState = {
  currentTurn: 0,
  showJumpToLatest: false,
  unreadCount: 0,
  locateTick: 0,
  cardSyncTick: 0,
}

/** @returns 阅读位置状态 + setter。 */
export function useChatReading(): readonly [ChatReadingState, SliceSetters<ChatReadingState>] {
  return useSlice(INITIAL_CHAT_READING, CHAT_READING_KEYS)
}

/* ── 切片四：输入区与连接（S1-D） ─────────────────────────────────────── */

/**
 * 这一片里有两个值**不是纯界面开关**，而是外部事实的投影：
 *
 * | 值 | 真相源 | 这里的角色 |
 * |---|---|---|
 * | `offline` | 连通性探测（use-chat-connectivity） | 只记录最近一次已知值，不判断 |
 * | `mobileEnterToSend` | 宿主偏好（fetchMobilePreferences） | 同上 |
 *
 * 放在一起的理由：它们和输入区是**同一屏、同一批交互**（离线要不要禁用发送、
 * 回车是发送还是换行）。分开存会出现"离线了但发送键还亮着"这类不一致。
 */
export interface ChatComposerState {
  /** 「+」面板里正在挑文件（宿主往返中）。 */
  pickerBusy: boolean
  /** 输入框是否有焦点。 */
  composerFocused: boolean
  /** 回车是发送还是换行（真相源：宿主偏好）。 */
  mobileEnterToSend: boolean
  /** 目标条上有个动作在飞。 */
  goalBusy: boolean
  /** 停止按钮已进入二次确认（2.5 秒不动自动收回）。 */
  stopArmed: boolean
  /** 宿主不可达（真相源：连通性探测）。 */
  offline: boolean
}

/** 状态键。 */
export const CHAT_COMPOSER_KEYS = [
  'pickerBusy', 'composerFocused', 'mobileEnterToSend', 'goalBusy', 'stopArmed', 'offline',
] as const satisfies ReadonlyArray<keyof ChatComposerState>

/** 初值。 */
export const INITIAL_CHAT_COMPOSER: ChatComposerState = {
  pickerBusy: false,
  composerFocused: false,
  mobileEnterToSend: true,
  goalBusy: false,
  stopArmed: false,
  offline: false,
}

/** @returns 输入区状态 + setter。 */
export function useChatComposerState(): readonly [ChatComposerState, SliceSetters<ChatComposerState>] {
  return useSlice(INITIAL_CHAT_COMPOSER, CHAT_COMPOSER_KEYS)
}
