/**
 * 回合状态所有权（S7a-4b）：`running` / `turnStartAt` / `hostLost` / `abandonedTurn` /
 * `runningTurn` 五个状态 + 唯一裁决入口 + 运行状态对账 + 尾页锚点。
 *
 * 从 `use-chat-stream` 里拆出来的第二层（S7a-4b，2026-11-06 改判）：流传输与折叠归
 * `use-chat-stream`，这里只管「这一轮到底在不在跑」——它**不碰消息行、不碰缓冲**，
 * 只读 `stream.folder` 的锚点、写回合状态。将来帧分发器（`mux.onFrame`）若要下放，
 * 落点就是这里（它需要的回合动作全在 {@link TurnStateHandle} 上）。
 *
 * 行为一字不改：判据、注释里的真机结论原样保留；尾页边界探针拆到
 * `data/reload-tail.ts`（与「重载尾页」同属拉一页尾页再决策），判据逐字保留。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RenderMessage } from '../../../render/messages.ts'
import { sessionState } from '../../../data/session.ts'
import { cachedSnapshot } from '../../../stream/session-store.ts'
import { probeTurnAtTail } from '../../../data/reload-tail.ts'
import {
  INITIAL_RECONCILE_MS,
  RECONCILE_FAILURE_LIMIT,
  RUNNING_RECONCILE_MS,
  SNAPSHOT_STALE_MS,
  TURN_SILENCE_MS,
  newestFoldTurn,
  type TailPageAnchor,
  type TurnVerdict,
  type TurnStateHandle,
  type UseTurnStateOptions,
} from '../state/stream-state.ts'

/**
 * Turn-state ownership for one chat.
 * @param options - session, stream container, current rows, and the two view callbacks
 *   the reconciliation needs (inbox refresh + todo normalization).
 * @returns the five React states plus the turn-verdict / reconciliation actions.
 */
export function useTurnState(options: UseTurnStateOptions): TurnStateHandle {
  const { sessionId, mux, stream, messages, refreshInboxRef, normalizeTurnEndTodo, foreground } = options

  /** Whether the assistant is currently generating (turn/start..turn/end). */
  const [running, setRunning] = useState(false)
  /** 同值的 ref 镜像：send() 的成功回调要知道"这条消息是排队发出去的"，但它不该
   *  因为每轮 running 翻转就重建（回调里的闭包会过期，而重建会让输入区的 onKeyDown
   *  在回合切换的瞬间拿到旧 send）。 */
  const runningRef = useRef(running)
  runningRef.current = running

  /** `mobile.sessionState` 这条原子快照通道是否可用（读到过至少一次带 turn 的快照）。 */
  const snapshotAliveRef = useRef(false)
  const verdictSeqRef = useRef(Number.NEGATIVE_INFINITY)
  /**
   * **已收工**的轮号集合 —— 交付卡出现的唯一凭据。
   *
   * 真机多次反馈："会话还在跑，屏幕上已经冒出「本轮产出」"。根因是这张卡出现的
   * 判据一直在猜（猜哪一轮在跑、猜位置、拿不到就保守藏）。现在改成**要有证据**：
   * 只有亲眼看到这一轮收工（宿主说停了、或收到 turn/end），它才允许显示。
   */
  const closedTurnsRef = useRef<Set<number>>(new Set())

  /**
   * 最近一次**亲眼看到收工**的回合（轮号 + 收工时刻）：迟到的「在跑」不许把已经
   * 收工的回合重新点着（宿主乱序快照 / 迟到的花名册帧都走 `applyTurnVerdict`）。
   * 只有轮号更大、或带一个比收工时刻更新的 `startAt`（真的新起了一轮）才允许点亮。
   */
  const closedTurnRef = useRef<{ turn?: number; at?: number } | undefined>(undefined)

  // Live mirror of `messages`：回调可能在很久之后才跑（首帧 rAF 甚至晚于尾页
  // 落地），所以它们必须读当前列表，不是闭包创建时的那一份。
  const messagesRef = useRef<readonly RenderMessage[]>(messages)
  messagesRef.current = messages

  /**
   * 「这一轮在不在跑」的**唯一裁决入口**（2026-10-31 根治）。
   *
   * 证据有两类，但它们只是**同一个状态机的输入**，不是两套判断：
   *   · 实时帧（turn/start、turn/end、session/status）—— 快；
   *   · 宿主对账（`mobile.turnState`）—— 权威，带证据 seq。
   *
   * 规则：**证据按 seq 单调**。序号更旧的结论一律丢弃（晚到的旧答复不许把已经
   * 收工的回合重新点着，也不许把正在跑的回合判成收工）。
   *
   * 以前的写法是各处直接 `setRunning(...)`：帧一说就改、对账一说又改，两者谁后到谁
   * 生效 —— 这就是"有时候卡片/过程条状态不对"的根源。现在只剩这一个入口。
   */
  const applyTurnVerdict = useCallback((verdict: TurnVerdict): void => {
    const hasSeq = typeof verdict.seq === 'number' && Number.isFinite(verdict.seq)
    const seq = hasSeq ? verdict.seq as number : Number.NEGATIVE_INFINITY
    if (verdict.force !== true && hasSeq) {
      // 只有**带序号**的证据之间才比新旧：晚到的旧答复不许覆盖已经应用的新结论。
      // 没有序号的证据（旧宿主的对账/尾页、宿主花名册）是"当刻读到的事实"，
      // 不做门控 —— 否则它会被一个更大的帧序号永久挡住（真机：指示器不再熄灭）。
      if (seq < verdictSeqRef.current) return
      if (seq > verdictSeqRef.current) verdictSeqRef.current = seq
    }
    if (verdict.running) {
      // 终态锁定：**能证明是同一轮**才丢（轮号相同/更旧、或压根没有新一轮的证据）。
      // 时间一律在宿主时钟里比：`closed.at` 是 turn/end 的宿主时间，`startAt` 也是
      // 宿主的 —— 拿本机 Date.now() 去比会把真在跑的新一轮挡在外面（真机实测）。
      const closed = closedTurnRef.current
      if (verdict.force !== true && closed !== undefined) {
        const sameTurn = verdict.turn !== undefined && closed.turn !== undefined && verdict.turn <= closed.turn
        const bare = verdict.turn === undefined && verdict.startAt === undefined
        const newerStart = verdict.startAt !== undefined && (closed.at === undefined || verdict.startAt > closed.at)
        const newerTurn = verdict.turn !== undefined && (closed.turn === undefined || verdict.turn > closed.turn)
        if (sameTurn || bare || (!newerStart && !newerTurn)) return
      }
      setRunning(true)
      if (verdict.turn !== undefined) setRunningTurn(verdict.turn)
      if (verdict.startAt !== undefined) {
        setTurnStartAt(previous => previous ?? verdict.startAt as number)
      }
      return
    }
    setRunning(false)
    // 收工：指针与秒表锚点一起清掉，否则上一轮会一直匹配 liveTurn；
    // 同时把这一轮的轮号记进"已收工"集合 —— 交付卡凭它才允许出现。
    if (runningTurnRef.current !== undefined) closedTurnsRef.current.add(runningTurnRef.current)
    if (verdict.turn !== undefined) closedTurnsRef.current.add(verdict.turn)
    const closed = verdict.turn ?? runningTurnRef.current
    if (closed !== undefined) closedTurnRef.current = { turn: closed, ...(verdict.at === undefined ? {} : { at: verdict.at }) }
    setRunningTurn(undefined)
    setTurnStartAt(null)
  }, [])

  /**
   * 当前活跃轮次的**轮号**（turn/start 帧里带回来的那一个）。它与 {@link running}
   * 同生同灭：凡是写 running 的地方都一起写这里（帧里的 turn/start、turn/end、
   * 名单/尾页锚点的恢复、reconcile 探针、steer 被拒），所以行级判据看到的活跃
   * 轮次永远就是底部状态行看到的那一轮。轮号缺席（中途重开时 running 是从名单
   * 或尾页锚点恢复的，手上没有那一帧）时由 {@link liveTurn} 退回折叠里的最新一轮。
   */
  const [runningTurn, setRunningTurn] = useState<number | undefined>(undefined)
  /** reconcile 是长寿命 effect：ref 里放最新轮号（messages 已有 messagesRef）。 */
  const runningTurnRef = useRef<number | undefined>(runningTurn)
  useEffect(() => { runningTurnRef.current = runningTurn }, [runningTurn])

  /**
   * 被宿主放弃的回合（重启/被杀/断流，turn/end 永远没来）。
   *
   * 之前这种回合会在 reconcile 判停后落到 `ok` 分支：卡片显示「已完成 ✅ 用时 X」，
   * 正文却是断在半句的 partial 或者空白 —— 假成功，桌面端同一轮是中断态。这里把
   * 它记下来，渲染时给整轮盖上 maxTokens（已有的「已中断」通道），文案与桌面端一致。
   */
  const [abandonedTurn, setAbandonedTurn] = useState<number | undefined>(undefined)

  /**
   * The running turn's logged `turn/start` event time (epoch ms), the turn
   * clock's anchor (desktop parity). Null while no turn is open or when the
   * boundary fell outside the loaded window — the clock then falls back to
   * the view's mount time, exactly like the desktop TurnStatus.
   */
  const [turnStartAt, setTurnStartAt] = useState<number | null>(null)

  /** Sustained host silence (RECONCILE_FAILURE_LIMIT failed roster reads):
   * the live channel is gone and nothing local can prove the turn ended. The
   * clock and its anchor are deliberately KEPT - a phone that switched
   * networks or woke from a locked screen must not lose the elapsed time it
   * was watching - and only the wording changes until an answer (or a live
   * frame) comes back. */
  const [hostLost, setHostLost] = useState(false)

  /**
   * 只要一轮的交付卡**在"没在跑"的时候露过面**，就记进已收工集合。
   *
   * 为什么需要（2026-11-01 真机）：发消息的那一刻，上一轮的交付卡会闪一下消失
   * （实测 1 → 0 → 1，约 2 秒）。原因是那一刻 `running` 已经翻成 true，而这一轮的
   * 轮号可能还没从对账/帧里补上，于是 `closedTurns` 里没有它、卡片被当成"没证据"藏掉。
   * 卡都露过面了，它就是收工过的 —— 这个事实不该因为"下一轮开始了"而失效。
   */
  useEffect(() => {
    if (running) return
    let changed = false
    for (const message of messages) {
      if (message.kind !== 'turn' || message.turn === undefined) continue
      if (closedTurnsRef.current.has(message.turn)) continue
      closedTurnsRef.current.add(message.turn)
      changed = true
    }
    void changed
  }, [messages, running])

  /** 一次只跑一个运行状态核对（重连基线帧与定时器会同时想查）。 */
  const reconcileInFlightRef = useRef(false)
  /** 连续几次核对拿不到宿主答复（宿主进程没了/链路断了）。 */
  const reconcileFailureRef = useRef(0)
  /** 组件是否还挂着：核对是异步的，回来时可能已经换页。 */
  const aliveRef = useRef(true)

  /** 校正"这一轮到底还在不在跑"。
   *
   *  以日志尾页的轮次边界为准：宿主在服务端就折好了尾页（实测 17~31 ms /
   *  99 KB），而 session.history 要解压整份日志——52 MB 的会话实测 34 秒，
   *  那段等待本身就是用户眼里的"刷新很慢"。旧宿主没有尾页通道时才退回
   *  宿主列表 + 历史窗口扫描。 */
  const reconcileRunning = useCallback((): void => {
    // 原子快照（`mobile.sessionState`）可用时，回合结论已由它给出（同一份切面、与桌面端同源）。
    // 这时尾页/运行集合/花名册**不再产生回合判断** —— 它们只负责"宿主还活着吗"。
    // 以前两条路各判一份、谁后到谁生效，就是"有时候状态不对"的最后一个来源。
    if (snapshotAliveRef.current) {
      if (reconcileInFlightRef.current) return
      reconcileInFlightRef.current = true
      void sessionState(sessionId).then(
        (snapshot) => {
          reconcileFailureRef.current = 0
          if (aliveRef.current) setHostLost(false)
          const snapshotTurn = (snapshot as { turn?: { running?: boolean; turnStartAt?: number } }).turn
          if (snapshotTurn !== undefined && typeof snapshotTurn.running === 'boolean') {
            const wasRunning = runningRef.current
            applyTurnVerdict({
              running: snapshotTurn.running,
              ...(snapshotTurn.turnStartAt === undefined ? {} : { startAt: snapshotTurn.turnStartAt }),
            })
            if (wasRunning && !snapshotTurn.running) {
              normalizeTurnEndTodo()
              stream.folder?.clearOpenTurnStart()
            }
          }
        },
        () => {
          // 这一条读失败不代表链路断了（其它通道还在），但连续失败要能标"连接中断"。
          reconcileFailureRef.current += 1
          if (aliveRef.current && reconcileFailureRef.current >= RECONCILE_FAILURE_LIMIT) setHostLost(true)
        },
      ).finally(() => { reconcileInFlightRef.current = false })
      return
    }

    if (reconcileInFlightRef.current) return
    reconcileInFlightRef.current = true
    const reachable = (): void => {
      reconcileFailureRef.current = 0
      if (aliveRef.current) setHostLost(false)
    }
    const unreachable = (): void => {
      reconcileFailureRef.current += 1
      // 连续失败只标记"链路没了"，不动运行状态：撤掉会让用户正在看的
      // 运行时钟凭空消失（见 hostLost 的说明）。
      if (aliveRef.current && reconcileFailureRef.current >= RECONCILE_FAILURE_LIMIT) setHostLost(true)
    }
    const adopt = (open: boolean, startAt: number | undefined): void => {
      if (!aliveRef.current) return
      // 走唯一裁决入口：对账与实时帧共用同一个状态机（seq 单调，谁新谁算）
      applyTurnVerdict({ running: open, startAt })
      if (!open) {
        // 探针也是 turn/end：活跃轮次同样清空，行级判据不能停在旧轮上。
        setRunningTurn(undefined)
        setTurnStartAt(null)
        // 外部锚点只在"这一轮还开着"时有意义：清掉，免得下一轮收工时拿它定格。
        stream.folder?.clearOpenTurnStart()
        normalizeTurnEndTodo()
        return
      }
      // Anchor the clock at the logged start (desktop parity): a live frame
      // that already supplied a newer anchor wins.
      if (startAt !== undefined) {
        setTurnStartAt(previous => previous ?? startAt)
        // 同一份真起点也交给折叠：否则收工那一刻用时会被"窗口最早一行"缩短。
        stream.folder?.noteOpenTurnStart(startAt)
      }
    }
    // 收工/在跑只有一个来源：宿主的 turnState。它把"转发帧看到过的边界"与"日志写下的
    // 边界"按 seq 比一次再回答；手机不再拿静默时长、日志窗口里看不看得见边界、会话表
    // 行的 running 去推断——那三条都曾经把正跑着的一轮判成已完成。旧宿主没有这个方法
    // （或这一次读失败）时才退回尾页那套（判据见 data/reload-tail.ts 的 probeTurnAtTail）。
    const reconcileFromTail = (): void => {
      void probeTurnAtTail({
        sessionId,
        reachable,
        unreachable,
        adopt,
        setAbandonedTurn,
        getRunningTurn: () => runningTurnRef.current,
        getMessages: () => messagesRef.current,
      }).finally(() => { reconcileInFlightRef.current = false })
    }
    // 回合判定不再单独打 `mobile.turnState`：原子快照里已经有 turn（和行/队列同一个
    // 切面），这里直接读状态仓里那份。快照太旧（空闲时 chat 侧每 8 秒一问）就顺手
    // 催一次对账 —— 一次往返同时服务队列、回合、目标和待办，省掉一整条通道。
    const cached = cachedSnapshot(sessionId)
    const snapshotAge = cached === undefined ? Number.POSITIVE_INFINITY : Date.now() - cached.asOf
    if (cached === undefined || snapshotAge > SNAPSHOT_STALE_MS) {
      refreshInboxRef.current()
    }
    if (cached === undefined) {
      // 第一次核对还没有快照可读：退回尾页那套（宿主老、或刚打开还没落地）。
      reconcileFromTail()
      reconcileInFlightRef.current = false
      return
    }
    reachable()
    adopt(cached.turn.running === true, cached.turn.turnStartAt)
    reconcileInFlightRef.current = false
  }, [sessionId, normalizeTurnEndTodo])

  // Running reconciliation: the live turn/end frame can be lost to a tunnel
  // blip - the EventSource reconnects, its keep-alives resume, the polling
  // fallback never arms, and the indicator would stay on for a finished turn
  // until the next full reload. The same is true in reverse: a turn that starts
  // while the phone is dozing never announces itself. So this cadence runs in
  // BOTH directions and stays cheap - `reconcileRunning` reads the server-folded
  // log tail (~20 ms) instead of session.history (34 s on a 52 MB session).
  useEffect(() => {
    aliveRef.current = true
    if (!foreground) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = (): void => {
      if (cancelled) return
      // 兜底核对。运行状态的主来源现在是宿主在轮次边界主动推的 session/status
      // （与桌面端同源）：回合开始/结束那一刻手机就知道，不再每十秒重新怀疑一次。
      // 这里只覆盖"边界帧被断流丢了"——所以只在跑着的时候排下一拍，没在跑就停，
      // 回合开始由那条推送叫醒。
      reconcileRunning()
      // 只要**还在跑**或者**还挂着"连接中断"**就继续对账。
      //
      // 真机（2026-10-31）：SSE 断过之后，"连接中断"这颗 chip 会一直挂着 ——
      // 因为对账只在 running 为真时排下一拍，而断流时常常正好是"这一轮已经结束"
      // 的状态，于是再也没人去过问，用户只能靠刷新页面把横幅消掉。
      // 这里让 hostLost 也驱动重试：一旦某次对账成功，横幅自动消失、循环停下。
      if (running || hostLost) timer = setTimeout(tick, RUNNING_RECONCILE_MS)
    }
    // 打开会话、回到前台、running 翻转：先让推送落地，再兜一次。
    timer = setTimeout(tick, INITIAL_RECONCILE_MS)
    return () => {
      cancelled = true
      aliveRef.current = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [running, hostLost, sessionId, mux, foreground, reconcileRunning])

  /**
   * 尾页落地时恢复回合锚点（原加载 effect 里的那一段）。
   *
   * Restore the turn-clock anchor from the tail window (desktop parity): the
   * window carries the open turn/start's logged time when the boundary is
   * within reach, so a mid-turn reload keeps the real elapsed time instead of
   * counting from mount. A live turn/start frame already anchored it (newer) —
   * never overwrite that.
   */
  const noteTailPageAnchor = useCallback((page: TailPageAnchor): void => {
    const { startAt } = page
    if (startAt !== undefined) {
      setTurnStartAt(prev => prev ?? startAt ?? null)
      // 把这个真起点也种进折叠：窗口里看不到 turn/start 时，收工定格只能退回
      // 「窗口最早一行」当锚点，秒表会在收工时往回跳（真机 8分37秒 → 6分48秒）。
      stream.folder?.noteOpenTurnStart(startAt)
      // The anchor is a clock, not a verdict. It used to raise the running
      // flag on its own, on the theory that an open boundary outweighs the
      // roster's agent-liveness flag while a subagent runs. In practice a
      // turn that died without writing its turn/end left exactly that
      // boundary behind, so every reopen of that chat painted a running turn over a
      // session the desktop knew was idle. Opening a chat now takes the
      // roster's `running` as the verdict (seeded above, and corrected by
      // the host's `session/status` frame as soon as one lands); the anchor
      // only decides where the stopwatch starts.
      //
      // 名单说这个会话不在跑，页面却留了一条开着的边界：这一轮是被打断的（宿主重启、
      // 进程被杀、断流），不是正常收工。记下来，渲染时写「已中断」而不是「已完成」。
      // 只有「名单说不跑」还不够 —— 一轮正跑着时名单也可能滞后；再加一条日志彻底静默
      // 的证据（宿主集合与日志都在说这轮没了），才判它被打断。
      const silent = page.lastEventAt !== undefined && Date.now() - page.lastEventAt > TURN_SILENCE_MS
      if (!page.rosterRunning && silent) {
        setAbandonedTurn(previous => previous ?? newestFoldTurn(page.foldedRows))
      }
      setRunningTurn(undefined)
    }
  }, [stream])

  /** 帧分发器：turn/start → 清「已中断」标记，并把秒表锚到这一帧的宿主时间。 */
  const beginTurn = useCallback((startAt: number): void => {
    setAbandonedTurn(undefined)
    setTurnStartAt(startAt)
  }, [])

  /** 帧分发器：这一轮收工/被放弃 → 活跃轮号与秒表锚点一起清掉。 */
  const clearActiveTurn = useCallback((): void => {
    setRunningTurn(undefined)
    setTurnStartAt(null)
  }, [])

  /**
   * 换会话：证据水位归零 + 名单播种 + 清活跃轮号/秒表锚点。
   *
   * **必须在任何新会话的加载开始之前调用**：整体 reset 而不是逐字段清 —— 逐字段
   * 是这套状态历史上唯一反复出问题的地方（漏一个就是跨会话串帧）。
   */
  const resetTurnState = useCallback((seedRunning: boolean): void => {
    // 会话切换：证据水位归零（上一场的序号不能挡住这一场的结论），
    // 再用宿主在这条会话上给的初始值播种。
    verdictSeqRef.current = Number.NEGATIVE_INFINITY
    // 上一场的"已收工"不能挡住这一场：换会话 = 重新开始收工台账。
    closedTurnRef.current = undefined
    applyTurnVerdict({ running: seedRunning })
    // 会话切换：上一轮的轮号绝不能留给下一场（名单恢复的 running 会把它当成
    // 活跃轮次，把上一场那一轮的卡片误判成运行中）。
    setRunningTurn(undefined)
    setTurnStartAt(null)
  }, [applyTurnVerdict])

  /** 交付卡判据：这一轮是否亲眼看到过收工。 */
  const hasClosedTurn = useCallback((turn: number): boolean => closedTurnsRef.current.has(turn), [])

  /** 原子快照通道可用（`refreshInbox` 读到带 turn 的快照时置位）。 */
  const markSnapshotAlive = useCallback((): void => { snapshotAliveRef.current = true }, [])

  /** 任意帧都证明链路活着（帧分发器每条帧都调一次）。 */
  const clearHostLost = useCallback((): void => { setHostLost(false) }, [])

  /** 裁决门用的即时值（回调闭包里读不到渲染期的 running）。 */
  const isRunning = useCallback((): boolean => runningRef.current, [])

  /** 活跃轮号的即时值（长寿命回调里读不到渲染期的 runningTurn）。 */
  const getRunningTurn = useCallback((): number | undefined => runningTurnRef.current, [])

  return {
    running,
    runningTurn,
    turnStartAt,
    abandonedTurn,
    hostLost,
    applyTurnVerdict,
    reconcileRunning,
    resetTurnState,
    noteTailPageAnchor,
    clearHostLost,
    clearActiveTurn,
    beginTurn,
    hasClosedTurn,
    markSnapshotAlive,
    isRunning,
    getRunningTurn,
  }
}
