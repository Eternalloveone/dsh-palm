/**
 * 会话流式状态容器（纯数据，无 React）。
 *
 * S7a-3 的第一块：把散在 `ChatView` 里的 9 个 ref 收成**一个对象**，并把"换会话要清哪些"
 * 这件事写成 `resetStreamState()` —— 以前它散在加载 effect 里逐行赋值，漏一个就是跨会话串帧
 * （上一场的实时帧折进这一场的折叠器）。
 *
 * 这里只放**流式路径**的状态。不属于它的两项，别顺手搬进来：
 * - `hostClockSamples`：时钟校准，影响的是行的显示，不是流；
 * - `running` / `turnStartAt` / `hostLost` / `abandonedTurn`：这几个是 React 状态（要触发渲染），
 *   留给 `use-chat-stream` 用 `useState` 持有。
 */
import type { EventFolder, WireEvent } from '../../messages.ts'

export interface StreamState {
  /** 实时帧缓冲：重载/加载途中到达的帧先放这里，页到齐后再折。 */
  liveBuffer: WireEvent[]
  /** 缓冲是否已经溢出丢帧（决定要不要回填缺口）。 */
  liveBufferOverflow: boolean
  /** 溢出丢掉的那段 seq 窗口，等待回填。 */
  dropWindow: { from: number; to: number } | undefined
  /** 打开时自动续页是否已经试过（只试一次，避免无限续）。 */
  autoExtended: boolean
  /** 打开时连续拉了几页（用于"首屏补满"的收敛判据）。 */
  openChainPages: number
  /** 当前折叠器；undefined 表示还没建立（首屏未落地）。 */
  folder: EventFolder | undefined
  /** 有没有成功读到过一页（决定失败时要不要报"打不开"）。 */
  loadedPage: boolean
  /** 重载尾页途中：实时帧改走缓冲。 */
  tailLoading: boolean
  /** rAF 合批的待折帧。 */
  eventBatch: WireEvent[]
}

export function createStreamState(): StreamState {
  return {
    liveBuffer: [],
    liveBufferOverflow: false,
    dropWindow: undefined,
    autoExtended: false,
    openChainPages: 0,
    folder: undefined,
    loadedPage: false,
    tailLoading: false,
    eventBatch: [],
  }
}

/**
 * 换会话时的重置。**必须在任何新会话的加载开始之前调用**，且必须整体调用——
 * 逐字段手工清是这套状态历史上唯一反复出问题的地方。
 */
export function resetStreamState(state: StreamState): void {
  state.liveBuffer = []
  state.liveBufferOverflow = false
  state.dropWindow = undefined
  state.autoExtended = false
  state.openChainPages = 0
  state.folder = undefined
  state.loadedPage = false
  state.tailLoading = false
  state.eventBatch = []
}
