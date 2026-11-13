/**
 * 行渲染（S8b 从 `ChatView` 搬出）：把「消息列表 → MessageRow 列表」这一层从视图里
 * 摘出来，连带**行级判定链**（交付卡"已收工证据"、粘性过程条、只给 pending 行播入场
 * 动画、content-visibility）。
 *
 * **纯搬运**：判定顺序与真机结论注释逐字保留。视图只装配一个 props 对象。
 */
import { memo, type CSSProperties } from 'react'
import { dedupeById, type RenderMessage } from '../../../render/messages.ts'
import { MessageRow, type TurnDeliveryFacts } from '../../../render/message-row.tsx'
import type { DeliveryRecord } from '../../../session/deliveries.ts'
import { DeliveryCard } from '../../../ui/delivery-card.tsx'
import { TurnHeadSkeleton } from '../../../ui/turn-header.tsx'
import { Button } from '../../../ui/primitives.tsx'
import { useRowHydrated } from '../hooks/use-row-hydrated.ts'

/** 尾部这些行保持真实布局（不套 content-visibility）：贴底时 scrollHeight 才是精确值。 */
export const CONTENT_VISIBILITY_KEEP_BOTTOM = 30

/**
 * 交付卡该不该画（S7 的"已收工证据"判定链）。
 *
 * **正在跑的那一轮，永远不画交付卡**（真机 2026-11-01 又复现："会话还没结束就冒出交付
 * 结果卡"）。原因是我给"露过面就记为已收工"开的后门：流式中间只要有一帧"没在跑"
 * （重连、快照空格、被别处的停/起带一下），这一轮就被记成已收工；之后 running 再变回
 * true，它就成了"有证据"的卡。所以再加一条硬约束：**票号等于本轮时，无论证据如何都
 * 不画** —— 证据只能放行"更早的轮次"。
 *
 * 判据不再依赖"知道哪一轮在跑"（liveTurn 有时是 undefined：手机没收到注册/帧），而是看
 * **位置**：最后一条用户消息之后出现的轮次 = 本轮。这一轮只要还在跑（过程条还在长），
 * 它的"本轮产出"就不该出现 —— 收工之后自然就有了。
 */
export function shouldRenderCard(
  message: RenderMessage,
  view: {
    running: boolean
    activeTurn: number | undefined
    newestCardTurn: number | undefined
    hasClosedTurn: (turn: number) => boolean
  },
): boolean {
  if (message.kind !== 'turn') return true
  if (!view.running) return true
  // 优先用"最后一条用户消息之后的轮次"（位置判据）；拿不到时（实时帧丢了、刚重连、
  // 这一轮还没产生任何行）退回"票号最大的一轮"——**保守优先**：宁可先把最新那张卡
  // 藏起来，也不要在跑着的时候冒出交付卡（真机多次反馈）。
  const isActiveTurn = message.turn !== undefined
    && view.activeTurn !== undefined
    && message.turn === view.activeTurn
  const cardHasEvidence = message.turn !== undefined && !isActiveTurn && (
    view.hasClosedTurn(message.turn)
    || (view.newestCardTurn !== undefined && message.turn < view.newestCardTurn)
  )
  return cardHasEvidence
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
  /**
   * 结论资格（水合门）：**该会话的行**落定（`loading` 落下）+ **本会话的宿主快照**
   * 到齐且新鲜（缓存里那份也算，秒开靠它）才算。没水合时**不下任何结论**：行照画
   * （④ 缓存种子先上屏），状态条判 `unknown` —— 先画「已完成」再被「运行中」改写，
   * 就是真机那条首帧跳变。
   */
  const hydrated = useRowHydrated(view.sessionId, view.loading, view.hostNowMs)
  const delivery = view.delivery
  /**
   * 末尾槽位那张卡可不可见：仍是同一条「已收工证据」链（在跑的那一轮绝不画）。
   *
   * 判据按 **turn 号**走，只是身份从"某一行"换成了账本记录 —— 行怎么重排都不影响它。
   */
  const deliveryVisible = delivery !== undefined
    && shouldRenderCard(
      { kind: 'turn', id: `turn-tail:${delivery.turn}`, turn: delivery.turn } as unknown as RenderMessage,
      view,
    )
  /**
   * 账本 → 卡面。
   *
   * `presented` 里带 `description` 的是 `present` 声明过的交付物（卡上打「交付物」）；
   * 其余是工具产出、没有声明，按「改动」行显示 —— 与旧行内卡的标签语义一致，不把
   * 产出偷偷升格成交付物。已有 diff 统计的路径以账本的 `changes` 为准（带 +A −D）。
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
  return (
    <>
      {view.hasOlder && (
        <Button type="button" className="chat-load-older" disabled={view.olderLoading === true} onClick={() => { void view.loadOlder() }}>
          {view.olderLoading === true ? '加载中…' : '加载更早的消息'}
        </Button>
      )}
      {rows.map((message, index) => {
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
        // 在跑的时候，**本轮**的交付卡一律不显示（判据见 shouldRenderCard）：
        // 以前只藏"不带过程信息的卡"，于是带过程的卡照样把"本轮产出"显示出来
        // （真机 2026-10-31）。现在交给末尾槽位那张卡自己过同一条链。
        if (!shouldRenderCard(message, view)) return null
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
            focusedQuery={message.id === view.focusMsgId && view.chatHitQuery !== '' ? view.chatHitQuery : view.effectiveFocusQuery}
            focusExpand={message.id === view.focusMsgId && view.chatHitQuery !== ''}
            style={cv}
            onOpenFile={view.onOpenFile}
            onRegenerate={view.regenerateFor(message)}
            {...(view.goal === undefined || view.goal === '' ? {} : { turnGoal: view.goal })}
          />
        )
      })}
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
        >
          <DeliveryCard
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
       * 三态**只认 `loading`**，不要加 `!hydrated`。
       *
       * 试过"没水合也画骨架"：会话读不出来时 `loading` 会落、快照却永远到不了，
       * 于是骨架一直转 —— 正好违反「会话打不开时明确说一句，而不是永远加载中」。
       * "ready 之后、快照还没到"那几十毫秒的窗口交给第 1 层的会话快照去填，
       * 空态判据保持单一来源。
       */}
      {rows.length === 0 && (view.entryAnswered === false || (view.entryAnswered === undefined && view.loading)
        ? <TurnHeadSkeleton />
        : <p className="chat-typing">还没有消息，发一句话开始吧</p>)}
    </>
  )
})
