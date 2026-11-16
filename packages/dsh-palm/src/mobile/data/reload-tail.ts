/**
 * 重载尾页：已收工的命令可能改写历史（`/compact` 会把旧回合折起来），而实时帧无法撤销
 * 已经画出来的行 —— 只能重新拉一次尾页。
 *
 * S7a-2 从 `ChatView` 搬出；S7a-3b 起改为直接操纵 `StreamState`（那 9 个字段收在一个对象里），
 * 不再逐个接收 ref 包装。三条老规矩原样保留：
 *
 * 1. **重载期间到的实时帧先入缓冲**（`tailLoading`），页到齐后再折到新折叠器上；
 *    没有这道闸，帧会折进即将被替换的旧折叠器，然后随它一起被丢掉。
 * 2. **只有最新一次重载算数**（epoch + abort 掉上一次）：两次快速重载时，慢的那次
 *    不能把后一次的行盖掉。
 * 3. **一次都没读成功要明说**：点了一条已删的会话/失效链接，页面不能永远停在"加载中"。
 *
 * 第 4 条（2026-11-16 真机补）：**重读不许吃本地缓存**。水位对账发现"本地落后宿主
 * 一大截"才会走到这里，而那一刻的本地缓存正是要修掉的那份 —— 走
 * `canSkipEntryRead` 的直通就等于自愈读自己（实测 `localSeq` 卡在 2220，宿主已经
 * 3193，两次重读水位纹丝不动）。所以这里固定 `bypassEntryCache`，并在水位没前进
 * 时上报 `tail-reload-stall` / 读失败时上报 `tail-reload-failed`。
 */
import { loadChatPage } from './chat-page.ts'
import { history, listSessions, logTail, runningSessions } from '../api.ts'
import { TURN_SILENCE_MS, newestFoldTurn, type StreamState } from '../views/chat/state/stream-state.ts'
import { EventFolder, foldEvents, type RenderMessage } from '../render/messages.ts'

export interface ReloadTailDeps {
  sessionId: string
  /** 9 个流式字段（缓冲、折叠器、窗口、标志位）。 */
  state: StreamState
  /** 上一次重载的 abort 句柄（新的开始时先掐掉它）。 */
  controllerRef: { current: AbortController | undefined }
  /** 只认最新一次的代数。 */
  epochRef: { current: number }
  applyMessages: (rows: RenderMessage[]) => void
  setHasOlder: (value: boolean) => void
  setError: (message: string) => void
  refillGap: (gap: { from: number; to: number }, signal: AbortSignal, isCancelled: () => boolean) => void
  /** 探针上报（尽力而为）：自愈没成功必须留下现场，不能静默。 */
  reportProbe?: ((probe: string, detail: Record<string, unknown>) => void | Promise<unknown>) | undefined
}

/** 一次重载的期望值（只有水位自愈那条路会给）。 */
export interface ReloadTailOptions {
  /**
   * 期望重读后的水位**严格高于**这个值 —— 调用方已经知道本地停在这里、且宿主
   * 水位远在前面。不传就是普通重载（命令改写历史那种），不做水位断言。
   */
  expectSeqAbove?: number | undefined
}

export function reloadTailPage(deps: ReloadTailDeps, options: ReloadTailOptions = {}): void {
  const { sessionId, state, controllerRef, epochRef, applyMessages, setHasOlder, setError, refillGap } = deps

  controllerRef.current?.abort()
  const controller = new AbortController()
  controllerRef.current = controller
  const epoch = epochRef.current + 1
  epochRef.current = epoch
  state.tailLoading = true

  // 重读之前的水位：重读完没前进时，它是"卡住的是哪一份"的唯一证据。
  const previousSeq = state.folder?.lastSeq ?? -1

  /**
   * 这条重读一定走宿主：`bypassEntryCache` 让它跳过"刚同步过就用本地那份"的
   * 直通。水位对账正是因为**本地那份是旧的**才来这里的，吃缓存就等于自愈读自己。
   */
  void loadChatPage(sessionId, undefined, controller.signal, undefined, undefined, undefined, {
    bypassEntryCache: true,
  }).then(
    (page) => {
      if (epoch !== epochRef.current) return
      const buffered = state.liveBuffer
      state.liveBuffer = []
      state.tailLoading = false
      const folder = new EventFolder(page.rows, page.maxSeq)
      state.loadedPage = true
      state.folder = folder
      applyMessages(folder.fold(buffered))
      setHasOlder(page.hasMore)
      // 水位断言：宿主给的页面还是老的那一份（或者窗口比本地还短），重读就是白跑。
      // 以前这里什么都不说，磁盘上只留一条 lag，看不出"读了但没进展"。
      const expected = options.expectSeqAbove
      if (expected !== undefined && folder.lastSeq <= expected) {
        void deps.reportProbe?.('tail-reload-stall', {
          sessionId,
          expectedAbove: expected,
          got: folder.lastSeq,
          previous: previousSeq,
          rows: page.rows.length,
          entrySnapshot: page.entrySnapshot === true,
        })
      }
      // 重载窗口也溢出了：和首次加载一样把丢掉的那段补回来。
      const gap = state.dropWindow
      if (gap !== undefined) {
        state.dropWindow = undefined
        state.liveBufferOverflow = false
        refillGap(gap, controller.signal, () => epoch !== epochRef.current)
      }
    },
    (error: unknown) => {
      if (epoch !== epochRef.current) return
      state.tailLoading = false
      // 失败也要把缓冲倒进旧折叠器，否则这些帧永远留在缓冲里看不见。
      const buffered = state.liveBuffer
      state.liveBuffer = []
      if (buffered.length > 0) {
        const folder = state.folder
        applyMessages(folder === undefined ? foldEvents(buffered) : folder.fold(buffered))
      }
      // 有水位期望时，失败必须留现场：这条路径以前完全无声（`loadedPage` 已经是
      // true，连"打不开这个会话"都不会弹），用户看到的就是内容永远停在旧的。
      if (options.expectSeqAbove !== undefined) {
        void deps.reportProbe?.('tail-reload-failed', {
          sessionId,
          expectedAbove: options.expectSeqAbove,
          stillAt: state.folder?.lastSeq ?? -1,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
      if (!state.loadedPage) {
        setError('打不开这个会话：它可能已被删除，或链接已失效')
      }
    },
  )
}

/** 尾页边界探针的注入点（回合结论由 `use-turn-state` 的裁决入口统一落地）。 */
export interface ProbeTurnAtTailDeps {
  sessionId: string
  /** 尾页读成功（宿主可达）：清连续失败计数并撤掉「连接中断」。 */
  reachable: () => void
  /** 尾页读不到（旧宿主）：这条链路不可达。 */
  unreachable: () => void
  /**
   * 采纳一次回合结论（turn-state 的 adopt：唯一裁决 + 指针/锚点 + 待办归一化）。
   * 探针自己不做判断，只把它读到的证据交出去。
   */
  adopt: (open: boolean, startAt: number | undefined) => void
  /** 把「这一轮是被打断的」记下来（只写值，不裁决）。 */
  setAbandonedTurn: (value: number | undefined | ((previous: number | undefined) => number | undefined)) => void
  /** 长寿命回调里的即时轮号 / 行列表（闭包读到的是旧的）。 */
  getRunningTurn: () => number | undefined
  getMessages: () => readonly RenderMessage[]
}

/**
 * 尾页边界探针（S7a-4b 从 `use-turn-state` 的 `reconcileRunning` 拆出）。
 *
 * 与 {@link reloadTailPage} 同属「拉一页尾页，再据此决策」：这里读的是**日志尾页**的
 * 回合边界。判据一字不动（真机结论原样保留）：
 *
 * 1. 尾页 `turnOpen === false` = 最后一条边界是 turn/end → 确实收工；
 * 2. 静默**不是**收工凭据：编译命令跑三分钟、大文件读写期间日志一行都没有；
 * 3. 问 `runningSessions` 而不是 `session.list` 行上的 running（实测列表行会撒谎）；
 * 4. 宿主集合与日志都在说这轮没了 → 记「已中断」而不是「已完成」；
 * 5. 旧宿主（读不到尾页）才退回宿主列表 + 历史窗口扫描。
 *
 * @returns 外层尾页链的 Promise（内层集合/历史扫描按原实现 fire-and-forget，
 *  调用方的 in-flight 复位时机与搬迁前一致）。
 */
export function probeTurnAtTail(deps: ProbeTurnAtTailDeps): Promise<void> {
  const { sessionId, reachable, unreachable, adopt, setAbandonedTurn, getRunningTurn, getMessages } = deps
  return logTail(sessionId).then(
    (page) => {
      // 尾页本身就是宿主可达的证明。
      reachable()
      if (page.turnOpen === false) {
        // 日志最后一条边界是 turn/end：这一轮确实收工了。
        adopt(false, undefined)
        return
      }
      // 静默**不是**收工的凭据。一条编译命令跑三分钟、一次大文件读写，这段时间日志
      // 里一行事件都没有；此前"最后事件已经很久就判收工"正是"命令还在跑、过程框却
      // 写着已完成"的来源（工具行还停在运行中，头尾自相矛盾）。收工只认两条硬证据：
      // 日志最后一条边界是 turn/end（上面那条），或者宿主自己说这轮不跑了。
      //
      // 这里问的是 runningSessions 而不是 session.list 行上的 running：实测列表行会
      // 说谎——一轮正跑着（尾页锚点开着、最新事件 0 秒前），列表那一行还是 running=false，
      // 专用集合却把它算在里面。拿列表行当收工凭据，就会在每一轮跑到一半时把过程框
      // 判成已完成。
      const openedAt = page.turnStartAt
      const moving = page.lastEventAt !== undefined && Date.now() - page.lastEventAt <= TURN_SILENCE_MS
      void runningSessions().then(
        ({ sessionIds }) => {
          reachable()
          // 宿主集合说在跑就是在跑——哪怕日志一声不响（命令正跑着）。
          if (sessionIds.includes(sessionId)) { adopt(true, openedAt); return }
          // 集合说没在跑、可日志刚刚还在动：这一轮确实活着（集合靠帧维护，会落后）。
          if (moving) { adopt(true, openedAt); return }
          // 两条都没有：边界开着却彻底静了，集合也不认——这一轮是死在断流窗口里了。
          // 记下这一轮：它不是正常收工（没有 turn/end），要写「已中断」而不是「已完成」。
          setAbandonedTurn(previous => previous ?? getRunningTurn() ?? newestFoldTurn(getMessages()))
          adopt(false, undefined)
        },
        () => { adopt(true, openedAt) },
      )
      // 尾页说"还开着"就是真的还开着：宿主那一侧的窗口是从日志尾部折的，
      // turn/end 是最后一条边界，读不到它意味着它真的还没写下来。这里不再
      // 去问宿主的运行集合——实测宿主一整轮只推了一条 session/status（260 秒
      // 的监听里零条 running=false），那个集合既不能及时亮也不会及时灭，问了
      // 反而把正确的判断改错。
      adopt(true, page.turnStartAt)
    },
    () => {
      // 旧宿主读不到日志尾页：退回宿主列表判可达性 + 历史窗口扫描。
      void listSessions().then(
        (page) => {
          reachable()
          const row = page.items.find(item => item.sessionId === sessionId)
          // 只有明确说"跑着"的行才短路。缺行不算：列表按 updatedAt 分页，
          // 一个安静了一阵的会话会掉出首页，把它当"不跑"会让指示器永远卡住。
          if (row !== undefined && row.running !== false) return
          void (async (): Promise<void> => {
            try {
              const hpage = await history(sessionId, undefined, 1)
              for (let i = hpage.events.length - 1; i >= 0; i--) {
                const type = hpage.events[i]?.event?.type
                if (type === 'turn/end') {
                  // 正常收工：清掉中断标记，下一轮不许继承。
                  setAbandonedTurn(undefined)
                  adopt(false, undefined)
                  return
                }
                if (type === 'turn/start') {
                  const time = hpage.events[i]?.event?.time
                  adopt(true, typeof time === 'number' && Number.isFinite(time) ? time : undefined)
                  return
                }
              }
            } catch { /* transient; the next cadence retries */ }
          })()
        },
        () => { unreachable() },
      )
    },
  )
}
