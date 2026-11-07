/**
 * 行渲染（S8b 从 `ChatView` 搬出）：把「消息列表 → MessageRow 列表」这一层从视图里
 * 摘出来，连带**行级判定链**（交付卡"已收工证据"、粘性过程条、只给 pending 行播入场
 * 动画、content-visibility）。
 *
 * **纯搬运**：判定顺序与真机结论注释逐字保留。视图只装配一个 props 对象。
 */
import type { CSSProperties } from 'react'
import { dedupeById, type RenderMessage } from '../../messages.ts'
import { MessageRow } from '../../message-row.tsx'
import { Button } from '../../ui/primitives.tsx'

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
 * **位置**：最后一条用户消息之后出现的轮次 = 本轮。这一轮只要还在跑（底部"输出中"），
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
  /** 宿主时钟偏移（毫秒）：行内用时按它换算。 */
  clockOffsetMs: number
  /** 秒表的真锚点（日志里的 turn/start）。 */
  clockAnchor: number | undefined
  liveTurn: number | undefined
  liveClockTick: number
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
  regenerateState: 'idle' | 'busy' | 'failed'
  stickyProcRow: RenderMessage | undefined
  hasOlder: boolean
  loading: boolean
  loadOlder: () => void | Promise<void>
  onOpenFile: (path: string) => void
}

export function ChatRows(view: ChatRowsView): React.ReactElement {
  const rows = dedupeRows(view.messages)
  return (
    <>
      {view.hasOlder && (
        <Button type="button" className="chat-load-older" disabled={view.loading} onClick={() => { void view.loadOlder() }}>
          {view.loading ? '加载中…' : '加载更早的消息'}
        </Button>
      )}
      {rows.map((message, index) => {
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
        // （真机 2026-10-31）。现在一律藏；过程条由粘性快照保证不丢。
        if (!shouldRenderCard(message, view)) return null
        const cv: CSSProperties | undefined = index < view.messages.length - CONTENT_VISIBILITY_KEEP_BOTTOM
          ? { contentVisibility: 'auto' as const, containIntrinsicSize: `auto ${view.estimateHeight(message)}px` }
          : undefined
        const interrupted = view.rowOfInterrupted(message)
        return (
          <MessageRow
            key={view.rowKeyOf(message)}
            enter={animateIn}
            message={interrupted}
            sessionId={view.sessionId}
            showToolCalls={view.showToolCalls}
            showSystemMessages={view.showSystemMessages}
            clockOffsetMs={view.clockOffsetMs}
            liveTurnStartAt={view.clockAnchor}
            liveTurn={view.liveTurn}
            settled={view.settledOf(message)}
            liveClockTick={view.isRowRunning(interrupted) ? view.liveClockTick : undefined}
            showTime={view.timeFlags[index] === true}
            focused={message.id === view.focusMsgId}
            focusedQuery={message.id === view.focusMsgId && view.chatHitQuery !== '' ? view.chatHitQuery : view.effectiveFocusQuery}
            focusExpand={message.id === view.focusMsgId && view.chatHitQuery !== ''}
            style={cv}
            onOpenFile={(path) => { view.onOpenFile(path) }}
            onRegenerate={view.regenerateFor(message)}
            regenerateState={view.regenerateState}
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
          clockOffsetMs={view.clockOffsetMs}
          liveTurnStartAt={view.clockAnchor}
          liveTurn={view.liveTurn}
          settled={false}
          liveClockTick={view.liveClockTick}
          showTime={false}
          focused={false}
          focusedQuery={''}
          style={undefined}
          onOpenFile={(path) => { view.onOpenFile(path) }}
          onRegenerate={() => undefined}
          regenerateState={view.regenerateState}
        />
      )}
      {view.loading && view.messages.length === 0 && <p className="chat-typing">加载中…</p>}
      {!view.loading && view.messages.length === 0 && <p className="chat-typing">还没有消息，发一句话开始吧</p>}
    </>
  )
}
