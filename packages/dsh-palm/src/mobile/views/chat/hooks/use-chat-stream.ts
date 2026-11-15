/**
 * 流传输与折叠的所有权（S7a-4a）：9 个流式字段的容器（注入）、缓冲入队 / rAF 合批、
 * 缺口回填（`refillGap`）、重载尾页（`reloadTail`）、换会话重置（`resetForSession`）。
 *
 * S7a-4b（2026-11-06 改判）把它拆成两层：
 * - **本文件**：传输与折叠（流状态、缓冲、批处理、补洞、重载）。
 * - **`use-turn-state.ts`**：回合状态机（5 个状态、唯一裁决入口、对账、尾页锚点）。
 * 依赖方向只有一条：本文件调用 `useTurnState`，并把它的句柄**原样透传**出去
 * （`ChatView` 的帧分发器要用）；回合层不认识本文件，没有双向穿透。
 *
 * 预算（S7a-4b，Lead 2026-11-06 改判）：本文件 ≤420 行、`use-turn-state.ts` ≤340 行
 * （实测 219 / 411：回合层的 reconcileRunning 本体 107 行 + cadence 38 + 尾页锚点 30
 * 是拆不掉的判据，注释按"真机结论必须保留"逐字留着）。
 *
 * 边界：
 * - `mux.onFrame` 那 271 行仍在 `ChatView`：它是帧 → 十几个视图状态的分发器，属于装配。
 * - `hostClockSamples` / `hostClockOffset` / `turnStartAtRef` 留在 `ChatView`：时钟校准
 *   影响的是行的显示，不是流。
 * - `stream` 仍由 `ChatView` 创建后注入：`useChatHistory` 的 `getFirstRow` /
 *   `loadedRowCount` 在本 hook 能被调用之前就要读 `stream.folder`，容器若在这里创建，
 *   那条初始化链会绕回 TDZ。所有权（读写与重置）在本 hook。
 */
import { useCallback, useEffect, useRef } from 'react'
import { foldEvents, type WireEvent } from '../../../render/messages.ts'
import { perfMark } from '../../../platform/perf.ts'
import { reportProbe } from '../../../data/diag.ts'
import { refillGap as refillGapRows } from '../../../data/refill-gap.ts'
import { reloadTailPage } from '../../../data/reload-tail.ts'
import { ledgerSnapshot } from '../state/frame-ledger.ts'
import {
  FLUSH_STALL_REPORT_MS,
  MAX_TAIL_BUFFER_EVENTS,
  resetStreamState,
  type ChatStreamHandle,
  type UseChatStreamOptions,
} from '../state/stream-state.ts'
import { useTurnState } from './use-turn-state.ts'

/**
 * 一批帧允许等多久。60fps 下一帧就折（~16ms）；250ms 是"这一帧丢了"的判定线：
 * 后台不跑是正常的（那一侧不报），前台超过它必然是真丢了。
 */
const FLUSH_FALLBACK_MS = 250

/**
 * Stream transport for one chat.
 * @param options - session, the injected stream container, and the row writers the
 *   history layers write through.
 * @returns the composed handle: turn state (透传) + stream actions.
 */
export function useChatStream(options: UseChatStreamOptions): ChatStreamHandle {
  const {
    sessionId,
    mux,
    stream,
    messages,
    commitRows,
    applyMessages,
    setHasOlder,
    setError,
    refreshInboxRef,
    normalizeTurnEndTodo,
    foreground,
  } = options

  /**
   * 重载尾页的即时句柄：对账层（`useTurnState`）要靠它做"水位失配"的自愈，
   * 而它建在本层、依赖对账层的 `resetTurnState` —— 直接以函数入参会成环。
   */
  const reloadTailRef = useRef<() => void>(() => {})

  // 回合状态机是独立的一层：本层只透传，不反向依赖（见文件头）。
  const turn = useTurnState({
    sessionId,
    mux,
    stream,
    messages,
    refreshInboxRef,
    normalizeTurnEndTodo,
    foreground,
    reloadTailRef,
  })

  /** 待折帧的 rAF 句柄（undefined 表示没有排程）。 */
  const eventFlushRafRef = useRef<number | undefined>(undefined)
  /** 与 rAF 并行的兜底句柄（见 scheduleEventFlush 的注释）。 */
  const eventFlushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** 「闸门该响没响」上次上报的时刻（同一会话节流）。 */
  const flushStallReportAtRef = useRef(0)
  /** 上报用的即时会话号（回调依赖为空，闭包里的会过期）。 */
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId

  /** 把缓冲里的事件折进列表（幂等，空批直接返回）。rAF、兜底定时器、回前台补刀都调它。 */
  const flushEventBatch = useCallback((): void => {
    const batch = stream.eventBatch
    stream.eventBatch = []
    if (batch.length === 0) return
    const folder = stream.folder
    // Opt-in perf mark: decode/fold/coalesce done, state update about to
    // schedule (span recv→state measures the whole client pipeline).
    const last = batch[batch.length - 1]
    perfMark('state', { seq: last?.seq, frame: 'session/event', detail: `batch:${batch.length}` })
    // 实时折叠的基线是 EventFolder 的快照，而它只装"页给的行"：日志补回来的报告
    // 行不在里面。以前这一步直接覆盖，于是**下一条消息一来**（用户发送、宿主推帧），
    // 上一轮的交付物卡就被快照吃掉 —— 真机「发送完当前消息，上一条的卡消失」。
    commitRows(previous => (folder === undefined ? foldEvents(batch, previous) : folder.fold(batch)))
  }, [])

  /** 卸掉两种排程（幂等；换会话与卸载都要）。 */
  const cancelFlushSchedule = useCallback((): void => {
    if (eventFlushRafRef.current !== undefined) {
      cancelAnimationFrame(eventFlushRafRef.current)
      eventFlushRafRef.current = undefined
    }
    if (eventFlushTimerRef.current !== undefined) {
      clearTimeout(eventFlushTimerRef.current)
      eventFlushTimerRef.current = undefined
    }
  }, [])

  /**
   * 闸门在前台却没响：把现场交给宿主（同一会话 60s 一条，带帧台账）。
   *
   * 这一类失效在真机上**零 JS 异常**，只能靠主动上报定位。
   */
  const reportFlushStall = useCallback((): void => {
    const now = Date.now()
    if (now - flushStallReportAtRef.current < FLUSH_STALL_REPORT_MS) return
    flushStallReportAtRef.current = now
    void reportProbe?.('flush-stall', {
      sessionId: sessionIdRef.current,
      batched: stream.eventBatch.length,
      tailLoading: stream.tailLoading,
      folderReady: stream.folder !== undefined,
      frames: ledgerSnapshot().frames,
    }).catch(() => { /* 上报是尽力而为 */ })
  }, [])

  /**
   * Schedule one flush of the buffered message events (idempotent).
   *
   * rAF 只是**排程手段**，不是内容的安全网：真机上页面被冻结/切后台时这一帧可以
   * 永远不来，而闸门句柄只在回调里复位 —— 句柄不清就是把闸门焊死，之后每一条实时
   * 消息只进缓冲、不落地。所以每一批都同时挂一个定时器，谁先到谁折，晚到的是空批。
   */
  const scheduleEventFlush = useCallback((): void => {
    if (eventFlushRafRef.current !== undefined || eventFlushTimerRef.current !== undefined) return
    eventFlushRafRef.current = requestAnimationFrame(() => {
      eventFlushRafRef.current = undefined
      if (eventFlushTimerRef.current !== undefined) {
        clearTimeout(eventFlushTimerRef.current)
        eventFlushTimerRef.current = undefined
      }
      flushEventBatch()
    })
    // 兜底：后台/冻结时 rAF 不跑是正常的（不报），前台还没等到帧才是真丢了。
    eventFlushTimerRef.current = setTimeout(() => {
      eventFlushTimerRef.current = undefined
      if (eventFlushRafRef.current !== undefined) {
        cancelAnimationFrame(eventFlushRafRef.current)
        eventFlushRafRef.current = undefined
        if (typeof document === 'undefined' || document.visibilityState === 'visible') reportFlushStall()
      }
      flushEventBatch()
    }, FLUSH_FALLBACK_MS)
    // 依赖故意为空：`stream` 是稳定容器，`commitRows` 取订阅时的那一份。
  }, [])

  /**
   * One live session event into the stream.
   *
   * 重载期间（`tailLoading`）先入缓冲，等页到齐再折；缓冲到顶就丢最旧的，并记下
   * 丢掉的 seq 窗口等回填。其余时候进 rAF 批。
   */
  const enqueueLiveEvent = useCallback((event: WireEvent): void => {
    if (stream.tailLoading) {
      if (stream.liveBuffer.length >= MAX_TAIL_BUFFER_EVENTS) {
        // Bound the tail-load window: drop the oldest buffered event and
        // remember its seq window so the follow-up refill can re-fetch
        // exactly the dropped range (a flat tail re-pull would only
        // return events the fold already consumed). Warn once per load.
        const dropped = stream.liveBuffer.shift()
        if (dropped !== undefined) {
          const current = stream.dropWindow
          stream.dropWindow = current === undefined
            ? { from: dropped.seq, to: dropped.seq }
            : { from: Math.min(current.from, dropped.seq), to: Math.max(current.to, dropped.seq) }
        }
        if (!stream.liveBufferOverflow) {
          console.warn(
            `history tail is slow: live buffer reached ${MAX_TAIL_BUFFER_EVENTS} events; the dropped seq window will be re-fetched`,
          )
          stream.liveBufferOverflow = true
        }
      }
      stream.liveBuffer.push(event)
      return
    }
    // rAF micro-batch: buffer the event and fold all buffered events on
    // the next animation frame (one reconcile per frame instead of one
    // per SSE chunk). The immediate side-effects in the frame dispatcher
    // (turn/start·end, todo/write) already ran synchronously, so the running
    // indicator and plan strip stay responsive; only the message fold is deferred.
    stream.eventBatch.push(event)
    scheduleEventFlush()
  }, [stream, scheduleEventFlush])

  // 卸载时别再让待折的帧跑：会话已经没了，折叠只会写进一个新实例。
  useEffect(() => () => { cancelFlushSchedule() }, [])

  // 回到前台：后台期间排下的那一批必须当场落地（那一帧的 rAF 可能已经被系统丢掉）。
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return
      if (eventFlushRafRef.current === undefined && eventFlushTimerRef.current === undefined) return
      cancelFlushSchedule()
      flushEventBatch()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => { document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  /**
   * 缺口回填：实现已搬到 data/refill-gap.ts（纯逻辑，入参显式），这里只把当前
   * 会话的折叠器 / 行列表写入方打进去。
   */
  const refillGap = useCallback((gap: { from: number; to: number }, signal: AbortSignal, isCancelled: () => boolean): void => {
    refillGapRows({
      sessionId,
      gap,
      signal,
      isCancelled,
      folder: () => stream.folder,
      commitRows,
      applyMessages,
    })
  }, [sessionId, commitRows, applyMessages])

  /** Monotonic reload epoch: only the newest reloadTail lands. */
  const reloadEpochRef = useRef(0)
  /** Abort the previous reloadTail when a new one starts (no cross-resolve). */
  const reloadControllerRef = useRef<AbortController | undefined>(undefined)

  /**
   * 重载尾页：实现已搬到 data/reload-tail.ts（纯逻辑 + 显式注入），这里只把当前会话的
   * 各个 ref / 写入方打进去。
   */
  const reloadTail = useCallback((): void => {
    reloadTailPage({
      sessionId,
      state: stream,
      controllerRef: reloadControllerRef,
      epochRef: reloadEpochRef,
      applyMessages,
      setHasOlder,
      setError,
      refillGap,
    })
  }, [sessionId, refillGap, applyMessages, setHasOlder])

  /**
   * Latest `reloadTail`, for the live-frame dispatcher and the turn reconciler (both
   * subscribe once and must still call the current implementation): `reloadTail` is
   * rebuilt whenever `applyMessages` changes, they are not.
   */
  useEffect(() => { reloadTailRef.current = reloadTail }, [reloadTail])
  const reloadTailCurrent = useCallback((): void => { reloadTailRef.current() }, [])

  /**
   * 换会话时的重置（原 ChatView 加载 effect 里的那一段）。
   *
   * **必须在任何新会话的加载开始之前调用**：流状态整体 reset，再交给回合状态机
   * （证据水位 + 名单播种 + 活跃轮号）—— 逐字段手工清是这套状态历史上唯一反复
   * 出问题的地方（漏一个就是跨会话串帧）。
   */
  const resetForSession = useCallback((seedRunning: boolean): void => {
    resetStreamState(stream)
    // A session switch must not let a pending flush fold the PREVIOUS session's
    // buffered events into the new session's folder: drop the batch and cancel
    // both schedules (rAF + the fallback timer).
    cancelFlushSchedule()
    turn.resetTurnState(seedRunning)
  }, [stream, turn.resetTurnState])

  return {
    ...turn,
    stream,
    refillGap,
    reloadTail: reloadTailCurrent,
    resetForSession,
    enqueueLiveEvent,
  }
}
