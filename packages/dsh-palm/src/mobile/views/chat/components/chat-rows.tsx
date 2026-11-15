/**
 * 行渲染（S8b 从 `ChatView` 搬出）：把「消息列表 → MessageRow 列表」这一层从视图里
 * 摘出来，连带**行级判定链**（交付卡"已收工证据"、粘性过程条、只给 pending 行播入场
 * 动画、content-visibility）。
 *
 * **纯搬运**：判定顺序与真机结论注释逐字保留。视图只装配一个 props 对象。
 */
import { memo, useEffect, useState, type CSSProperties } from 'react'
import { dedupeById, type RenderMessage } from '../../../render/messages.ts'
import { MessageRow, type TurnDeliveryFacts } from '../../../render/message-row.tsx'
import { cardVisible, type CardPhase, type DeliveryRecord } from '../../../session/deliveries.ts'
import { DeliveryCard, type DeliveryState } from '../../../ui/delivery-card.tsx'
import { TurnHeadSkeleton } from '../../../ui/turn-header.tsx'
import { Button } from '../../../ui/primitives.tsx'
import { useRowHydrated } from '../hooks/use-row-hydrated.ts'
import { useRowWindow } from '../hooks/use-row-window.ts'
import { recordSpan } from '../../../platform/perf.ts'

/** 尾部这些行保持真实布局（不套 content-visibility）：贴底时 scrollHeight 才是精确值。 */
export const CONTENT_VISIBILITY_KEEP_BOTTOM = 10000

/**
 * 这一屏的卡面相位（唯一事实，2026-11-14 重构）。
 *
 * - 还没拿到宿主结论 → `unknown`（**默认值不是"没在跑"**，这是所有"先画后撤"的根源）；
 * - 结论是在跑 → `running`；
 * - 结论是没在跑 → `ended`。
 *
 * 判定本身在 `session/deliveries.ts` 的 `cardVisible()`（纯函数、可穷举）。
 * 这里只负责把 view 的三个布尔折成相位 —— 不再各自为政地当门。
 */
function phaseOf(view: ChatRowsView): CardPhase {
  if (view.runningKnown === false) return 'unknown'
  return view.running ? 'running' : 'ended'
}

/** 渲染前再按 id 兜一次：同一行只许出现一次（真机：重进正在跑的会话每行画两遍）。 */
export function dedupeRows(messages: readonly RenderMessage[]): RenderMessage[] {
  return dedupeById(messages as RenderMessage[])
}

/** 行渲染需要的全部输入（一个结构化对象，视图只装配一次）。 */
export interface ChatRowsView {
  messages: readonly RenderMessage[]
  sessionId: string
  showToolCalls: boolean
  showSystemMessages: boolean
  /** 宿主时间（毫秒，10 秒桶）：只用来算「几分钟前 / 快照是否新鲜」。 */
  hostNowMs?: number
  /**
   * 宿主时间取数函数（引用恒定）。
   *
   * 秒表要的是"渲染那一刻的宿主时间"，但把它当 prop 传数值会让每行的 `memo` 失效
   * （毫秒值每次渲染都变）。传函数两头都占：引用不变，行内渲染时现取。
   * 刷新靠 `liveClockTick` —— 只有正在跑的那一行收到它。
   */
  hostNow?: () => number
  /** 会话目标（任务头第二行「目标」）：只认宿主给的目标，不拿用户原话凑。 */
  goal?: string
  /** 秒表的真锚点（日志里的 turn/start）。 */
  clockAnchor: number | undefined
  liveTurn: number | undefined
  /**
   * 已废弃：1 Hz 心跳下沉到 `MessageRow` 内部自己起搏（见那边的 `rowRunning`）。
   *
   * 留着是为了不改调用点的形状；传什么都不再看。
   */
  liveClockTick?: number
  /** 这一行是否已收工（按轮判定）。 */
  settledOf: (message: RenderMessage) => boolean
  /** 这一行是否正在跑（决定要不要带 liveClockTick）。 */
  isRowRunning: (message: RenderMessage) => boolean
  timeFlags: readonly boolean[]
  running: boolean
  /**
   * 这一场的 `running` 有没有**结论**。
   *
   * 换会话首帧它是 false：名册滞后时会被当成"收工"，于是先画出一张上一轮的卡、等权威
   * 结论到了再撤 —— 真机 2026-11-14「切会话时那张一闪就没的卡」。**没结论就不画卡。**
   */
  runningKnown?: boolean
  activeTurn: number | undefined
  newestCardTurn: number | undefined
  hasClosedTurn: (turn: number) => boolean
  rowOfInterrupted: (message: RenderMessage) => RenderMessage
  /** 行的稳定 key（turn.step 组合键，退化为 id）。 */
  rowKeyOf: (message: RenderMessage) => string
  /** content-visibility 的高度估算。 */
  estimateHeight: (message: RenderMessage) => number
  /** 聚焦定位的命中行与查询串。 */
  focusMsgId: string | undefined
  chatHitQuery: string
  effectiveFocusQuery: string | undefined
  regenerateFor: (message: RenderMessage) => (() => void) | undefined
  stickyProcRow: RenderMessage | undefined
  hasOlder: boolean
  loading: boolean
  /** 正在翻更早的页（只驱动"加载更早"那颗按钮，不参与骨架判断）。 */
  olderLoading?: boolean
  /**
   * 这个会话"有没有消息"的证据：提交过行（或宿主答过 0 行）才为 true。
   * 传 false：还没提交过行 → rows 为空只画骨架，不下"空会话"的结论。
   * 不传（组件单独测试/其它场景）：退回按 loading 判，保持既有契约。
   */
  entryAnswered?: boolean
  /** 打开"本轮改动"详情页（卡尾「看全部改动」）。 */
  onOpenDelivery?: (facts: TurnDeliveryFacts) => void
  /**
   * 交付账本里**最新一条值得看**的交付（由 ChatView 持有、只追加不回退）。
   *
   * 卡只读它，不再从消息行里临时折（旧的 `changesByTurn`）—— 那是"每次渲染重算"的病根：
   * 行被合并/重排/整份替换时那份折叠结果跟着变，卡就一闪一闪、有时候干脆消失。
   */
  delivery?: DeliveryRecord
  /**
   * 刚发出去、宿主还没回执的那条用户消息（幽灵行）。
   *
   * 只画在列表末尾、**不进 `messages`**：它不是事实，只是"已经送出去了"的即时反馈，
   * 所以不参与账本、搜索、消息计数（没有 `data-message-id`）。宿主行落地后由 ChatView
   * 按同文认领撤掉。
   */
  outgoing?: { id: string; text: string; at: number }
  /**
   * 「已送达、模型还没开口」的等待态（对齐业界 `submitted` 态）。
   *
   * 以前这段窗口完全空白：占位在宿主用户行到达时就被认领撤掉，而过程条要等首个
   * chunk/工具才出现 —— 实测空窗 13.6 秒（真机反馈："点完发送一直没有反馈"）。
   */
  awaitingOutput?: boolean

  loadOlder: () => void | Promise<void>
  onOpenFile: (path: string) => void
}

/**
 * 消息列表的渲染边界。
 *
 * `memo` 是这里唯一的目的：**任何与消息无关的状态变化都不许把整列表重算一遍**。
 * 点一次上下文弹层、发一条消息（`sending` 翻面）、开关抽屉、1 Hz 秒表心跳 ——
 * 以前这些全会让 ChatRows 重新执行，逐行重建 props，于是 `MessageRow` 的 memo
 * 对每一行都失效（真机 10× CPU 降频实测：一次轻点 400~600 ms 脚本时间）。
 *
 * 它能挡住的前提（改动前必须知道）：
 * 1. 传进来的 props 引用要稳（ChatView 侧一律 `useCallback` / 分桶的 `hostNow*`）；
 * 2. 行级回调不许在 `.map` 里现造闭包（现造 = 每行一个新引用 = 每行必重渲染）。
 * 第 2 条由 `chat-rows-memo.test.tsx` 守着：谁把 `onOpenFile` 改回内联箭头，
 * 那条用例会当场红。
 */
export const ChatRows = memo(function ChatRows(view: ChatRowsView): React.ReactElement {
  const rows = dedupeRows(view.messages)
  /** 滚动容器：虚拟窗口要按 scrollTop 反推视口落在第几行。 */
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  useEffect(() => { setScroller(document.querySelector<HTMLElement>('.chat-scroll')) }, [])
  /** 焦点行（搜索定位）必须留在窗口里。 */
  const focusIndex = view.focusMsgId === undefined
    ? -1
    : rows.findIndex(row => row.id === view.focusMsgId)
  const win = useRowWindow({
    total: rows.length,
    focusIndex,
    sessionKey: view.sessionId,
    estimate: (index) => {
      const row = rows[index]
      return row === undefined ? 0 : view.estimateHeight(row)
    },
    scroller,
  })
  /** 占位高度用 ref 写样式：JSX 内联 style 会撞质量预算（inlineStyles ≤ 8）。 */
  const bindSpacer = (height: number) => (node: HTMLDivElement | null): void => {
    if (node !== null) node.style.blockSize = `${height}px`
  }
  /**
   * 结论资格（水合门）：**该会话的行**落定（`loading` 落下）+ **本会话的宿主快照**
   * 到齐且新鲜（缓存里那份也算，秒开靠它）才算。没水合时**不下任何结论**：行照画
   * （④ 缓存种子先上屏），状态条判 `unknown` —— 先画「已完成」再被「运行中」改写，
   * 就是真机那条首帧跳变。
   */
  const hydrated = useRowHydrated(view.sessionId, view.loading, view.hostNowMs)
  const delivery = view.delivery
  /**
   * 末尾槽位那张卡可不可见 = **一个纯函数**（`cardVisible`）：
   * 相位 + 账本最新一条 + 屏上行数。跑着不画、没结论不画、空屏不画，
   * 三条规则全在函数里，这里不再各自为政地叠门。
   */
  const deliveryVisible = cardVisible({ phase: phaseOf(view), delivery, rowCount: rows.length })
  /**
   * 账本 → 卡面：`presented` 里带 `description` 的才是 `present` 声明过的交付物；
   * 其余按「改动」行显示（已有 diff 统计的以账本 `changes` 为准，带 +A −D）。
   */
  const declaredFiles = delivery === undefined
    ? []
    : delivery.presented.filter(file => file.description !== undefined)
  const deliveryChanges = [...(delivery?.changes ?? [])]
  for (const file of delivery?.presented ?? []) {
    if (file.description !== undefined) continue
    if (deliveryChanges.some(change => change.path === file.path)) continue
    deliveryChanges.push({ path: file.path })
  }
  const openDeliveryOf = view.onOpenDelivery
  /**
   * 这一轮的**结论态**（P4 四态）：删掉行内那张卡之后，四态必须由末尾槽位继续表达，
   * 否则失败的一轮也会写成「交付完成」。收尾行说 failed 就是 failure；没有收尾行
   * （历史卡是补读回来的）按正常收工。
   */
  const cardState: DeliveryState = delivery !== undefined
    && view.messages.some(message => message.kind === 'turn' && message.turn === delivery.turn && message.failed === true)
    ? 'failure'
    : 'success'
  /*
   * 渲染耗时记账（2026-11-15）：真机 31 秒里主线程被占 23 秒（74%），而 RPC 解析、
   * 缓存写、帧分发三处埋点全是空的 —— 那这段时间最可能就在反复渲染。只有先量到这个，
   * 才能回答"是不是渲染"，而不是继续换方向试。
   */
  const renderStartedAt = performance.now()
  const out = (
    <>
      {/* 一条行都没有时不画「加载更早的消息」：宿主对空会话也可能答 hasMore=true
          （窗前面还有 session/start 之类的系统事件），按钮点下去永远是空的。 */}
      {view.hasOlder && rows.length > 0 && (
        <Button type="button" className="chat-load-older" disabled={view.olderLoading === true} onClick={() => { void view.loadOlder() }}>
          {view.olderLoading === true ? '加载中…' : '加载更早的消息'}
        </Button>
      )}
      {/* 上方占位：被窗口挡在外面的行，只留高度（虚拟窗口见 use-row-window）。 */}
      {win.topSpacer > 0 ? <div ref={bindSpacer(win.topSpacer)} className="chat-window-spacer" aria-hidden="true" /> : null}
      {rows.map((message, index) => {
        // 窗口之外的行不进 DOM：97 行时 20× 降频下 max 3333ms，18 行时 206ms。
        if (index < win.start || index >= win.end) return null
        // 收尾行（kind === 'turn'）在这里**一行都不画**：交付卡由列表末尾的固定槽位渲染
        // （见下面的 `deliveryVisible`）。卡挂在行上时，行一被合并/重排/整份替换，
        // 卡就跟着重挂或消失 —— 真机反复出现过「一闪一闪」「点进来又没了」。
        //
        // `as string` 是故意的：阻止 TS 把 kind 收窄成"不是 turn"，后面还要按 kind
        // 分支取时间/动画等字段（收窄后那些比较会被判成 never）。
        if ((message.kind as string) === 'turn') return null
        // 只在「正在流式落地」的行上播入场动画：历史行不播。
        //
        // 原来动画无条件挂在每一行上，而打开会话是"先粗后细"两轮提交（第一轮的行还
        // 没有 turn/step → key 退化成 id，折完之后 key 变成 turn.step 组合键），
        // React 把整屏行卸了重挂（实测 113/114 行 remount）→ 动画整屏重播一遍，
        // 肉眼就是「一打开会话正文闪一下」（2026-10-30 真机）。
        const animateIn = message.pending === true
        // 行全渲染：不可见行交给 content-visibility（浏览器自己记住布局过的
        // 真实高度，不是我们估的数）。尾部 CONTENT_VISIBILITY_KEEP_BOTTOM 行
        // 保持真实布局，贴底时 el.scrollHeight 才是精确值。
        //
        // 卡只在末尾那一个槽位画（`deliveryVisible`），行这里不再有第二套判定。
        const cv: CSSProperties | undefined = index < view.messages.length - CONTENT_VISIBILITY_KEEP_BOTTOM
          ? { contentVisibility: 'auto' as const, containIntrinsicSize: `auto ${view.estimateHeight(message)}px` }
          : undefined
        const interrupted = view.rowOfInterrupted(message)
        /** 只算一次：它同时决定秒表粒度（用哪个时间桶）和要不要带心跳。 */
        const rowRunning = view.isRowRunning(interrupted)
        return (
          <MessageRow
            key={view.rowKeyOf(message)}
            enter={animateIn}
            message={interrupted}
            sessionId={view.sessionId}
            showToolCalls={view.showToolCalls}
            showSystemMessages={view.showSystemMessages}
            hostNow={view.hostNow}
            hostNowMs={view.hostNowMs}
            liveTurnStartAt={view.clockAnchor}
            liveTurn={view.liveTurn}
            settled={view.settledOf(message)}
            hydrated={hydrated}
            rowRunning={rowRunning}
            showTime={view.timeFlags[index] === true}
            focused={message.id === view.focusMsgId}
            // 会话内搜索期间**所有行**都渲染高亮：计数直接数屏幕上的 <mark>，
            // 不再"一行一处地推算"。只给焦点行高亮时，别的命中在屏幕上根本不存在，
            // 数字和画面永远对不上（真机「7/17+ 但屏幕上一个高亮都没有」）。
            focusedQuery={view.chatHitQuery}
            // 过程组只接**纯定位**（没有任何搜索词）时的 anchorQuery。搜索一旦有词，
            // 过程/工具/思考就一律不接高亮 —— 首页搜索结果点进来也带 focusQuery，
            // 那条路径同样是"搜索"，不能让它把过程条点亮。
            anchorQuery={view.chatHitQuery === '' && message.id === view.focusMsgId ? view.effectiveFocusQuery : undefined}
            // 只对"进入并定位"（没有搜索词）展开过程条；搜索跳转不该把过程拉开
            // （过程不参与匹配，展开只会挡住正文）。
            focusExpand={message.id === view.focusMsgId && view.effectiveFocusQuery !== undefined}
            style={cv}
            onOpenFile={view.onOpenFile}
            onRegenerate={view.regenerateFor(message)}
            {...(view.goal === undefined || view.goal === '' ? {} : { turnGoal: view.goal })}
          />
        )
      })}
      {/* 下方占位：往上翻时窗口后面那些行只留高度。 */}
      {win.bottomSpacer > 0 ? <div ref={bindSpacer(win.bottomSpacer)} className="chat-window-spacer" aria-hidden="true" /> : null}
      {view.stickyProcRow !== undefined && (
        <MessageRow
          key={view.stickyProcRow.id}
          enter={false}
          message={view.stickyProcRow}
          sessionId={view.sessionId}
          showToolCalls={view.showToolCalls}
          showSystemMessages={view.showSystemMessages}
          hostNow={view.hostNow}
          hostNowMs={view.hostNowMs}
          liveTurnStartAt={view.clockAnchor}
          liveTurn={view.liveTurn}
          settled={false}
          hydrated={hydrated}
          rowRunning={true}
          showTime={false}
          focused={false}
          focusedQuery={''}
          style={undefined}
          onOpenFile={(path) => { view.onOpenFile(path) }}
          onRegenerate={() => undefined}
        />
      )}
      {/*
       * 幽灵用户行：点发送后宿主回执/首帧之前，先让用户看见自己那句话。
       * 不设 `data-message-id`（它不算消息行），只带 `data-outgoing-id` 便于探针识别。
       */}
      {view.outgoing !== undefined && (
        <div className="chat-msg chat-msg-user chat-msg-outgoing" data-outgoing-id={view.outgoing.id}>
          <p className="chat-msg-text">{view.outgoing.text}</p>
          <p className="chat-outgoing-wait mobile-muted">已送出 · 等待输出…</p>
        </div>
      )}
      {/*
       * 交付卡：列表**末尾的固定槽位**。一页只此一张，数据来自账本（`view.delivery`），
       * 不是某一行。
       *
       * 为什么不挂在收尾行里：行会被合并/重排/整份替换（缓存页 → 网络页 → 补页），
       * 卡于是跟着重挂或消失 —— 真机反复出现的「卡一闪一闪」「点进会话卡又没了」。
       * 槽位只认 turn 号，行怎么抖都不动它。
       */}
      {deliveryVisible && delivery !== undefined && (
        <div
          className="chat-turn-tail-row"
          data-turn={delivery.turn}
          data-message-id={`turn-tail:${delivery.turn}`}
          /* 归属戳：这条卡的账本属于**哪一场**。跨会话串味时它能在 DOM 里一眼看出来
             （自洽用例和真机探针都认这个属性）。 */
          data-owner={view.sessionId}
        >
          <DeliveryCard
            state={cardState}
            deliverables={declaredFiles}
            changes={deliveryChanges}
            onOpenFile={view.onOpenFile}
            {...(openDeliveryOf === undefined
              ? {}
              : {
                  onOpenChanges: () => {
                    openDeliveryOf({
                      turn: delivery.turn,
                      deliverables: declaredFiles,
                      changes: deliveryChanges,
                    })
                  },
                })}
          />
        </div>
      )}
      {/*
       * 等待态：宿主已接单（用户行到了或回了执），模型还没开口。
       * 复用 `.chat-typing` 的样式（一行浅色提示），不新增 CSS 类。
       */}
      {view.awaitingOutput === true && (
        <p className="chat-typing chat-awaiting" role="status">已送达 · 等待模型响应…</p>
      )}
      {/*
       * 三态**只认 `loading`**，不要加 `!hydrated`。
       *
       * 试过"没水合也画骨架"：会话读不出来时 `loading` 会落、快照却永远到不了，
       * 于是骨架一直转 —— 正好违反「会话打不开时明确说一句，而不是永远加载中」。
       * "ready 之后、快照还没到"那几十毫秒的窗口交给第 1 层的会话快照去填，
       * 空态判据保持单一来源。
       */}
      {/* 幽灵行 / 等待态在时也不许画空态：用户刚发过话，屏幕上却有"还没有消息"。 */}
      {rows.length === 0 && view.outgoing === undefined && view.awaitingOutput !== true
        && (view.entryAnswered === false || (view.entryAnswered === undefined && view.loading)
          ? <TurnHeadSkeleton />
          : <p className="chat-typing">还没有消息，发一句话开始吧</p>)}
    </>
  )
  recordSpan('render:rows', performance.now() - renderStartedAt)
  return out
})
