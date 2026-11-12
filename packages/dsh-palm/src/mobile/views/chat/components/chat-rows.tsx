/**
 * 行渲染（S8b 从 `ChatView` 搬出）：把「消息列表 → MessageRow 列表」这一层从视图里
 * 摘出来，连带**行级判定链**（交付卡"已收工证据"、粘性过程条、只给 pending 行播入场
 * 动画、content-visibility）。
 *
 * **纯搬运**：判定顺序与真机结论注释逐字保留。视图只装配一个 props 对象。
 */
import { memo, type CSSProperties } from 'react'
import { dedupeById, type RenderMessage } from '../../../render/messages.ts'
import { toolDiffLines } from '../../../render/process-rows.ts'
import { MessageRow, type TurnDeliveryFacts } from '../../../render/message-row.tsx'
import { planStepsOf, type TaskSteps } from '../../../session/task-status.ts'
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
  loadOlder: () => void | Promise<void>
  onOpenFile: (path: string) => void
  /** 交付卡「看全部改动 ›」：交给 App 打开交付详情页（不给就不画入口）。 */
  onOpenDelivery?: (facts: TurnDeliveryFacts) => void
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
  // ── 按轮折叠的「任务头 / 交付卡」数据 ──────────────────────────────────
  // 一个回合的数据散在多行上（每步一条 assistant + 一条 turn 收尾行），视图层只在
  // 这里折一次；MessageRow 只负责画，不自己猜数字（拿不到的字段留 undefined）。
  /** 这一轮的计划步数：计划快照只挂在 turn 收尾行上，回填给同一轮的所有行。 */
  const stepsByTurn = new Map<number, TaskSteps>()
  /** 这一轮改过哪些文件 + 增删行数（diff 视图里读，按路径合并）。 */
  const changesByTurn = new Map<number, { path: string; adds: number; dels: number }[]>()
  /** 失败 / 截断的回合：交付卡不画，终态交给状态条。 */
  const brokenTurns = new Set<number>()
  for (const row of rows) {
    const turn = row.turn
    if (turn === undefined) continue
    if (row.kind === 'turn') {
      if (row.plan !== undefined) stepsByTurn.set(turn, planStepsOf(row.plan) ?? { done: 0, total: row.plan.items.length })
      continue
    }
    if (row.kind !== 'assistant') continue
    // 只认宿主明说过的失败/截断（turn/end 的 error / max-tokens）：
    // `stopped` 工具有两种来路（真中断 / 结果帧没折进来），不能拿来判「这一轮没成」。
    if (row.failed === true || row.maxTokens === true) brokenTurns.add(turn)
    const changes = changesByTurn.get(turn) ?? []
    for (const tool of row.tools ?? []) {
      for (const diff of tool.view?.diffs ?? []) {
        const adds = toolDiffLines(diff.newText).length
        const dels = diff.oldText === null || diff.oldText === undefined ? 0 : toolDiffLines(diff.oldText).length
        const hit = changes.find(change => change.path === diff.path)
        // 同一文件可能被写好几次：取最大的一次（最终文件形态），不累加中间态。
        if (hit === undefined) changes.push({ path: diff.path, adds, dels })
        else {
          hit.adds = Math.max(hit.adds, adds)
          hit.dels = Math.max(hit.dels, dels)
        }
      }
    }
    changesByTurn.set(turn, changes)
  }
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
        const turn = message.turn
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
            {...(view.onOpenDelivery === undefined ? {} : { onOpenChanges: view.onOpenDelivery })}
            onRegenerate={view.regenerateFor(message)}
            {...(view.goal === undefined || view.goal === '' ? {} : { turnGoal: view.goal })}
            {...(turn === undefined || stepsByTurn.get(turn) === undefined ? {} : { turnSteps: stepsByTurn.get(turn) })}
            {...(turn === undefined || message.kind !== 'turn' || changesByTurn.get(turn) === undefined ? {} : { turnChanges: changesByTurn.get(turn) })}
            {...(message.kind !== 'turn' ? {} : { turnCompleted: turn === undefined || !brokenTurns.has(turn) })}
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
      {rows.length === 0 && (view.loading
        ? <TurnHeadSkeleton />
        : <p className="chat-typing">还没有消息，发一句话开始吧</p>)}
    </>
  )
})
