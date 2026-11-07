import type { EventFolder, RenderMessage, WireEvent } from '../../../messages.ts'
import type { MuxClient } from '../../../mux.ts'
import type { ChatSessionHandle } from '../hooks/use-chat-session.ts'

/**
 * 会话流式状态容器（纯数据，无 React）。
 *
 * S7a-3 的第一块：把散在 `ChatView` 里的 9 个 ref 收成**一个对象**，并把"换会话要清哪些"
 * 这件事写成 `resetStreamState()` —— 以前它散在加载 effect 里逐行赋值，漏一个就是跨会话串帧
 * （上一场的实时帧折进这一场的折叠器）。
 *
 * S7a-4 起这里还放**流的状态契约**：缓冲区上限/对账周期这些常量、回合裁决与尾页锚点的
 * 入参形状、以及「折叠里最新一轮」这个纯函数（对账与尾页锚点共用，见 newestFoldTurn）。
 * 它们没有 React，所以留在本模块；hook 只负责把它们接到 React 状态上。
 *
 * 这里只放**流式路径**的状态。不属于它的两项，别顺手搬进来：
 * - `hostClockSamples`：时钟校准，影响的是行的显示，不是流；
 * - `running` / `turnStartAt` / `hostLost` / `abandonedTurn`：这几个是 React 状态（要触发渲染），
 *   留给 `use-chat-stream` 用 `useState` 持有。
 */

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

/**
 * Hard cap on live events buffered while the initial history tail page is in
 * flight. Beyond this the oldest buffered event is dropped and a follow-up
 * history tail re-pull closes the seam.
 */
export const MAX_TAIL_BUFFER_EVENTS = 500

/**
 * 在跑时的**兜底**核对周期。运行状态的主来源是宿主在轮次边界主动推的
 * `session/status`（见 mobile-api 的 noteRunningFrame）—— 与桌面端同源，回合开始/
 * 结束那一刻手机就知道。这一条只防"边界帧被断流丢了"，所以只在 running 时跑；
 * 没在跑时完全不轮询（以前二十秒一次的 idle 探测已删，回合开始由推送叫醒）。
 */
export const RUNNING_RECONCILE_MS = 10_000
/** 尾页最后一条事件"多久算旧"：回合活着时事件不会停这么久，超过即认为那一轮
 *  已收工、只是 turn/end 帧丢了。真在跑的回合会被下一个事件翻回运行中，所以
 *  这个阈值宁短勿长——它只影响一次误判的时长，不影响正确性。 */
export const TURN_SILENCE_MS = 60_000
/** 状态仓里的快照多久算旧：超过就顺手催一次对账（不只是回合，队列/目标/待办一起吃新）。 */
export const SNAPSHOT_STALE_MS = 12_000

/** 打开会话/回到前台后的一次性核对延迟：先让宿主推的 status 帧落地，再兜一次。 */
export const INITIAL_RECONCILE_MS = 2_500
/** Consecutive listSessions failures (each RUNNING_RECONCILE_MS apart) that
 * prove the host is unreachable - the process stopped or the link is down.
 * The reconciliation can only self-heal a lost turn/end while the host answers;
 * once it has been silent this long, the indicator can never clear on its own,
 * so drop it instead of showing 输出中 for a host that is no longer running. */
export const RECONCILE_FAILURE_LIMIT = 3

/** 回合裁决：帧与对账共用的证据。 */
export interface TurnVerdict {
  running: boolean
  seq?: number | undefined
  turn?: number | undefined
  startAt?: number | undefined
  /**
   * 绕过 seq 门控。
   *
   * 只给"宿主花名册说这一轮停了"用：那是**停止纠正**，它的作用就是在边界帧丢掉时
   * 把状态拉回来，不能因为它的序号（或没有序号）比日志 seq 小而丢掉。
   * 反过来"说在跑"不走 force —— 迟到的 status(true) 不许把已收工的回合重新点着。
   */
  force?: boolean | undefined
}

/** 打开会话时尾页带回的回合证据（见 use-chat-stream 的 `noteTailPageAnchor`）。 */
export interface TailPageAnchor {
  /** 尾页窗口里那一轮 turn/start 的宿主时间（窗口里没有就是 undefined）。 */
  startAt: number | undefined
  /** 尾页最后一条事件的时间（判"彻底静默"用）。 */
  lastEventAt: number | undefined
  /** 会话名单说这一轮在跑吗（`session.running === true`）。 */
  rosterRunning: boolean
  /** 这一页折出来的行（判「被打断」时要从中取最新一轮）。 */
  foldedRows: readonly RenderMessage[]
}

/** Inputs of `useTurnState`（回合状态所有权）。 */
export interface UseTurnStateOptions {
  /** 当前会话。 */
  sessionId: string
  /** The page-lifetime mux client (undefined before the first effect tick). */
  mux?: MuxClient | undefined
  /** 9 个流式字段的容器（对账要清/种 `folder` 的开局锚点）。 */
  stream: StreamState
  /** 当前已提交的行：对账的「最新一轮」回退要读当前值。 */
  messages: readonly RenderMessage[]
  /**
   * 立刻向宿主问一次队列/回合快照。
   *
   * 走 ref 转一手：`refreshInbox` 本身要读 `applyTurnVerdict`，直接以函数入参会形成
   * 「谁先定义」的死结；ref 也让 reconcile 的依赖保持原样（不因它重建）。
   */
  refreshInboxRef: { current: (options?: { fresh?: boolean }) => void }
  /** 宿主 turn/end 的待办归一化（对账判停时也要做一次）。 */
  normalizeTurnEndTodo: () => void
  /** 页面是否在前台（兜底对账只在看得见时跑）。 */
  foreground: boolean
}

/** 回合状态 + 裁决/对账的对外句柄（帧分发器与对账轮询用）。 */
export interface TurnStateHandle {
  /** Whether the assistant is currently generating (turn/start..turn/end). */
  running: boolean
  /** 当前活跃轮次的轮号（turn/start 帧带回来的那一个）。 */
  runningTurn: number | undefined
  /** The running turn's logged `turn/start` event time (epoch ms), the clock anchor. */
  turnStartAt: number | null
  /** 被宿主放弃的回合（重启/被杀/断流，turn/end 永远没来）。 */
  abandonedTurn: number | undefined
  /** Sustained host silence: the live channel is gone (see hostLost doc in the hook). */
  hostLost: boolean
  /** The single turn-verdict entry (frames and reconciliation share it). */
  applyTurnVerdict: (verdict: TurnVerdict) => void
  /** 校正"这一轮到底还在不在跑"。 */
  reconcileRunning: () => void
  /**
   * 换会话：证据水位归零、用名单给的 running 播种、清活跃轮号与秒表锚点。
   * @param seedRunning - 名单上这条会话「在跑吗」（`session.running === true`）。
   */
  resetTurnState: (seedRunning: boolean) => void
  /** 打开会话：尾页带回的锚点 + 「被打断」判定（只写回合状态，不动视图状态）。 */
  noteTailPageAnchor: (page: TailPageAnchor) => void
  /** 帧分发器：任意帧都证明链路活着 → 清掉「连接中断」。 */
  clearHostLost: () => void
  /** 帧分发器：名单说这一轮停了 → 指针与秒表锚点一起清掉。 */
  clearActiveTurn: () => void
  /** 帧分发器：turn/start → 清「已中断」标记并锚定秒表。 */
  beginTurn: (startAt: number) => void
  /** 交付卡判据：这一轮是否亲眼看到过收工（`closedTurnsRef`）。 */
  hasClosedTurn: (turn: number) => boolean
  /** 原子快照通道可用（读到过至少一次带 turn 的 `mobile.sessionState`）。 */
  markSnapshotAlive: () => void
  /** 裁决门用的即时值（回调闭包里读不到渲染期的 running）。 */
  isRunning: () => boolean
  /** 当前活跃轮号的即时值（长寿命回调里读不到渲染期的 runningTurn）。 */
  getRunningTurn: () => number | undefined
}

/** The stream + turn-state handle consumed by `ChatView`. */
export interface ChatStreamHandle extends TurnStateHandle {
  /** The 9-field stream container (shared with the history layer). */
  stream: StreamState
  /** 缺口回填：缓冲溢出丢掉的那段 seq 窗口，逐页补回来。 */
  refillGap: (gap: { from: number; to: number }, signal: AbortSignal, isCancelled: () => boolean) => void
  /** 重载尾页（命令改写了历史 / 宿主丢了帧）。 */
  reloadTail: () => void
  /** 帧分发器：session/event 进流（重载期间入缓冲，平时进 rAF 批）。 */
  enqueueLiveEvent: (event: WireEvent) => void
  /**
   * 换会话：整体清空流状态、取消待折的 rAF 帧，再交给回合状态的 resetTurnState。
   * @param seedRunning - 名单上这条会话「在跑吗」（`session.running === true`）。
   */
  resetForSession: (seedRunning: boolean) => void
}

/** Inputs of `useChatStream`（流传输 + 折叠）。 */
export interface UseChatStreamOptions {
  /** 当前会话。 */
  sessionId: string
  /** The page-lifetime mux client (undefined before the first effect tick). */
  mux?: MuxClient | undefined
  /** 9 个流式字段的容器；所有权在 hook。 */
  stream: StreamState
  /** 当前已提交的行：对账的「最新一轮」回退要读当前值。 */
  messages: readonly RenderMessage[]
  /** 唯一提交入口（缺口回填 / 实时合批都写这里）。 */
  commitRows: ChatSessionHandle['commitRows']
  /** 整份换行（重载尾页 / 缺口回填用折叠器的快照）。 */
  applyMessages: (rows: RenderMessage[]) => void
  setHasOlder: (value: boolean) => void
  setError: (message: string) => void
  /**
   * 立刻向宿主问一次队列/回合快照。
   *
   * 走 ref 转一手：`refreshInbox` 本身要读本 hook 的 `applyTurnVerdict`，直接以函数
   * 入参会形成「谁先定义」的死结；ref 也让 reconcile 的依赖保持原样（不因它重建）。
   */
  refreshInboxRef: { current: (options?: { fresh?: boolean }) => void }
  /** 宿主 turn/end 的待办归一化（对账判停时也要做一次）。 */
  normalizeTurnEndTodo: () => void
  /** 页面是否在前台（兜底对账只在看得见时跑）。 */
  foreground: boolean
}

/**
 * 折叠里最新的一轮号（只看 assistant 行：user 行不带 turn 字段，轮次尾报告卡
 * 只是产出清单、不承载过程）。活跃轮次号缺席时的兜底 —— 中途重开一个还开着的
 * 回合时，running 是从会话名单或尾页锚点恢复的，那一帧 turn/start 没经手，
 * 而正在跑的那一轮必然是折叠里最后出现的一轮。
 *
 * S7a-4 从 `ChatView` 搬到本模块（ChatView 仍从这里导入）：对账与尾页锚点都要它，
 * 两处各留一份迟早会漂。
 */
export function newestFoldTurn(messages: readonly RenderMessage[]): number | undefined {
  let newest: number | undefined
  for (const message of messages) {
    if (message.kind !== 'assistant' || message.turn === undefined) continue
    if (newest === undefined || message.turn > newest) newest = message.turn
  }
  return newest
}
