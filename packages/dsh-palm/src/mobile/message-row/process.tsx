/**
 * 一轮的「过程组」：思考、工具调用与 diff 卡。
 *
 * 2026-11-08 按对照稿（`docs/prototype/chat-rework.html`）重排为**一张独立卡**：
 *
 * ```
 * ┌ 跑了 5 个工具                    用时12秒
 * │ ● 读文件 · ChatView.tsx            完成   ← 状态点（绿=完成/蓝=运行中/红=失败）
 * │ ● 检索 · pendingTurnSeqRef         完成
 * └ [展开：思考块 / 叙述文本 / diff 卡]
 * ```
 *
 * 工具行**默认可见**（以前藏在折叠体里，用户得先点一下才知道跑过什么）；
 * 思考与 diff 卡仍在卡内展开，答案永远留在卡外。状态点只给宿主真报过的状态
 * （`running`/`ok`/`error`/`stopped`），拿不到就是灰点，不编"成功/失败"。
 *
 * @module dsh-palm/mobile/message-row/process
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { RenderMessage, ToolCallInfo } from '../render/messages.ts'
import { MarkdownText } from '../render/markdown-text.tsx'
import {
  isRowRunning,
  processErrorsText,
  processStateText,
  processStepsText,
  processTimeText,
  visibleRowCount,
  type ProcessModel,
  type ProcessOutcome,
  type ProcessReasoningRow,
  type ProcessToolRow,
} from '../render/process-rows.ts'
import { stepModel } from '../render/step-view.ts'
import { ChevronDownIcon, ChevronRightIcon } from '../components/icons.tsx'
import { ProcessLine } from '../ui/process-line.tsx'
import { Button } from '../ui/primitives.tsx'
import { forgetTurnAnchor, stableTurnAnchor } from './anchors.ts'
import { ArtifactCards } from './artifact-cards.tsx'
import { BlockList, type BlockRegistry } from './block-registry.tsx'
import { toVM } from './to-vm.ts'
import type { MessageBlock } from './types.ts'

/**
 * 一轮的"过程组"（桌面端 turn-process 的对应物）。头一行只说两件事：
 * 这一轮跑了多少个工具、一共花了多久；每行工具在头下面直接列出来。
 * 没有可展开的内容（没有思考、没有叙述、没有 diff 卡）时头是静态的，
 * 不假装能点开。
 */
export function ProcessGroup({ message, model, showToolCalls, focusedQuery, focusExpand, sessionId, hostNowMs, liveTurnStartAt, liveTurn, settled, liveClockTick }: {
  message: RenderMessage
  model: ProcessModel
  showToolCalls: boolean
  focusedQuery?: string
  /** 从会话内搜索跳过来：折叠的工具步骤要自动展开，命中正文才看得见。 */
  focusExpand?: boolean
  sessionId?: string
  hostNowMs?: number
  liveTurnStartAt?: number
  liveTurn?: number
  /** 宿主已裁决这一轮停了：残留的 pending / running 工具不算"还在跑"。 */
  settled?: boolean
  /** 父级的 1 Hz 心跳（见 live-clock.ts）。它每秒变一次，负责把这一行叫醒。 */
  liveClockTick?: number
}) {
  const [open, setOpen] = useState(false)
  // 从「搜索本会话」跳过来：命中的正文很可能在折叠着的展开体里，不展开就只看到
  // 一张"X 步已完成"的卡，用户以为"搜到了却没定位"。
  useEffect(() => {
    if (focusExpand === true) setOpen(true)
  }, [focusExpand])
  // 与 processOutcome 共用同一个"还在跑"判据：只认 pending 会让运行中的卡片读成
  // "已完成"，秒表也会消失；按步定格的行只有活跃轮次能救它。
  const running = isRowRunning(message, liveTurn, settled)
  // 有外部心跳就靠它叫醒；单独渲染这一行（测试、别的宿主）时才自己挂一个。
  const [, setSelfTick] = useState(0)
  useEffect(() => {
    if (!running || liveClockTick !== undefined) return
    const id = setInterval(() => { setSelfTick(previous => previous + 1) }, 1_000)
    return () => { clearInterval(id) }
  }, [running, liveClockTick])
  // 秒表走宿主时间：渲染层只做「宿主时间 − 锚点」，本机墙钟不参与（W3-5）。
  const now = hostNowMs ?? Date.now()
  // 锚点只认**宿主时间**：行上的 turnStartAt（turn/end 盖的）与页级 liveTurnStartAt。
  const rawAnchor = message.turnStartAt ?? liveTurnStartAt
  // 见 `stableTurnAnchor`：同一轮只认见过的最早锚点（跨重挂、跨刷新都在）。
  const anchorKey = `${sessionId ?? ''}:${message.turn ?? message.id}`
  const clockAnchor = running
    ? stableTurnAnchor(anchorKey, rawAnchor)
    : (forgetTurnAnchor(anchorKey), rawAnchor)
  // 结束时间以 turn/end 盖上的 durationMs 为准；窗口没收到 turn/end 时退回
  // turn/start 与最后一次触碰的时间差（中断的回合也能给出可信的耗时）。
  const liveElapsedMs = running && clockAnchor !== undefined
    ? Math.max(0, now - clockAnchor)
    : undefined
  const durationMs = message.durationMs
    ?? (message.turnStartAt !== undefined ? Math.max(0, message.time - message.turnStartAt) : undefined)
  const outcome: ProcessOutcome = running ? 'running' : (model.outcome === 'running' ? 'ok' : model.outcome)
  const stateText = processStateText(outcome)
  const timeText = processTimeText(outcome, {
    durationMs,
    ...(liveElapsedMs !== undefined ? { liveElapsedMs } : {}),
  })
  // 报错信号：只在这轮真有条目报错的工具步骤时才出现，没有就什么也不留。
  const errorsText = processErrorsText(model)
  const toolRows = model.rows.filter((row): row is ProcessToolRow => row.kind === 'tool')
  const visibleTools = showToolCalls ? toolRows : []
  // 过程折叠行（新设计「▸ 7 步过程 · 31 次工具调用」）：计划步数与工具调用数分开报，
  // 缺项就少说一项；展开/收起**复用本组件已有的 `open` 状态**，不另起一份状态。
  const planSteps = message.plan?.items.length
  const recentTools = toolRows.slice(-3).map((row) => {
    const step = stepModel(row.tool)
    return step.summary === '' ? step.title : `${step.title} · ${step.summary}`
  })
  // 展开体：思考块、步骤之间的叙述文本、diff 卡。工具行已经常显，不再进这里。
  const bodyRows = visibleRowCount(model, false)
  const stepsText = processStepsText(model, showToolCalls)
  const visibleRows = visibleRowCount(model, showToolCalls)
  const head = (
    <ProcessLine
      className={bodyRows === 0 ? 'chat-proc-head chat-proc-head-static' : 'chat-proc-head'}
      state={outcome}
      label={stateText}
      {...(planSteps === undefined || planSteps <= 0 ? {} : { steps: planSteps })}
      {...(showToolCalls && model.toolCount > 0 ? { toolCalls: model.toolCount } : {})}
      {...(errorsText === '' ? {} : { note: errorsText })}
      {...(timeText === '' ? {} : { time: timeText })}
      {...(running && recentTools.length > 0 ? { recent: recentTools, running } : {})}
      {...(bodyRows === 0 ? {} : { expanded: open, onToggle: () => { setOpen(value => !value) } })}
    />
  )
  const tools = visibleTools.length === 0 ? null : (
    <div className="chat-proc-tools">
      {visibleTools.map(row => <ToolRow tool={row.tool} key={row.key} />)}
    </div>
  )
  if (bodyRows === 0) {
    return (
      <div className={`chat-proc${running ? ' chat-proc-running' : ''}`} data-proc-rows={visibleRows}>
        {head}
        {tools}
      </div>
    )
  }
  return (
    <div className={`chat-proc${open ? ' chat-proc-open' : ''}${running ? ' chat-proc-running' : ''}`} data-proc-rows={visibleRows}>
      {head}
      {tools}
      {open && (
        <div className="chat-proc-body">
          {stepsText !== '' && <div className="chat-proc-steps">{stepsText}</div>}
          <ProcessRows message={message} model={model} showToolCalls={false} focusedQuery={focusedQuery} focusExpand={focusExpand} sessionId={sessionId} />
        </div>
      )}
    </div>
  )
}

/** 展开体：思考块、步骤之间的叙述文本、diff 卡，全按事件顺序排。 */
/** 展开体的渲染上下文：正文高亮、定位展开、会话 id 都从这里取。 */
interface ProcessBlocksContext {
  message: RenderMessage
  focusedQuery?: string
  focusExpand?: boolean
  sessionId?: string
}

/**
 * 块的渲染器表：**新增一种块 = 这里加一行 + 写样式**，不再动遍历逻辑。
 * 表是纯数据（kind → 组件），插件也能用 mergeRegistry 追加自己的块。
 */
const PROCESS_BLOCK_REGISTRY: BlockRegistry<ProcessBlocksContext> = {
  reasoning: ({ block }) => (block.kind === 'reasoning' ? <ThinkBlock row={block.row} /> : null),
  tool: ({ block }) => (block.kind === 'tool' ? <ToolRow tool={block.tool} /> : null),
  'tool-group': ({ block }) => (block.kind === 'tool-group' ? <ArtifactCards tools={[...block.tools]} /> : null),
  text: ({ block, ctx }) => (block.kind === 'text' ? renderTextBlock(block, ctx) : null),
}

/** 正文块：有步骤号的包一层 data-step-seq，会话内搜索才能滚到这一步。 */
function renderTextBlock(block: Extract<MessageBlock, { kind: 'text' }>, ctx: ProcessBlocksContext): ReactNode {
  const body = (
    <MarkdownText
      text={block.text}
      pending={ctx.message.pending === true}
      forceOpen={ctx.focusedQuery !== undefined}
      highlightQuery={ctx.focusedQuery}
      sessionId={ctx.sessionId}
    />
  )
  if (block.seq === undefined) return body
  return <div className="chat-flow-text" data-step-seq={block.seq} data-part-id={`text-${block.index}`}>{body}</div>
}
function ProcessRows({ message, model, showToolCalls, focusedQuery, focusExpand, sessionId }: {
  message: RenderMessage
  model: ProcessModel
  showToolCalls: boolean
  focusedQuery?: string
  focusExpand?: boolean
  sessionId?: string
}) {
  const blocks = useMemo(
    () => toVM(model, { showToolCalls, pending: message.pending === true, stepSeqs: message.stepSeqs }),
    [model, showToolCalls, message.pending, message.stepSeqs],
  )
  const ctx: ProcessBlocksContext = { message, focusedQuery, focusExpand, sessionId }
  return <BlockList blocks={blocks} registry={PROCESS_BLOCK_REGISTRY} ctx={ctx} />
}

/**
 * 一段思考：缩进、左侧强调线。折叠时只说"深度思考 · 42 行"，展开才读正文
 * （正文不长时一次给全，不做二级折叠——少一次点击）。
 *
 * 推理链**不参与搜索**：索引只收正文答案，如果这里还按命中词自动展开并高亮，
 * 用户就会看到"搜到的位置落在深度思考里"。
 */
function ThinkBlock({ row }: { row: ProcessReasoningRow }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="chat-think">
      <Button
        type="button"
        className="chat-think-head"
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className="chat-think-caret" aria-hidden>
          {open ? <ChevronDownIcon width={16} height={16} /> : <ChevronRightIcon width={16} height={16} />}
        </span>
        <span className="chat-think-label">深度思考 · {row.lines} 行</span>
      </Button>
      {open && <div className="chat-think-body">{row.text}</div>}
    </div>
  )
}

/**
 * 一行工具（对照稿的工具块行）：状态点 + 「动作 · 对象」 + 右侧状态词。
 * 点行展开原始参数；diff 内容仍留在消息体里它发生的位置。
 *
 * 状态点只认宿主给过的状态：ok=绿、running=蓝、error=红、stopped=琥珀、
 * 没有 state=灰（不是"成功"，也不冒充"运行中"）。
 */
function ToolRow({ tool }: { tool: ToolCallInfo }) {
  const [open, setOpen] = useState(false)
  const model = stepModel(tool)
  const state = tool.state
  const label = state === undefined ? '' : STEP_STATE_LABELS[state]
  return (
    <div
      className="chat-step"
      data-state={state ?? 'unknown'}
      data-step-title={model.title}
      data-step-summary={model.summary}
      data-step-state={label}
    >
      <Button
        type="button"
        className="chat-step-head"
        aria-expanded={open}
        aria-label={`${model.title}${model.summary === '' ? '' : ` · ${model.summary}`}${label === '' ? '' : `，${label}`}`}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className="chat-step-dot" data-state={state ?? 'unknown'} aria-hidden />
        <span className="chat-step-title">{model.title}</span>
        <span className="chat-step-summary">{model.summary}</span>
        {label === '' ? null : <span className={`chat-step-state chat-step-state-${state}`}>{label}</span>}
        <span className="chat-step-caret" aria-hidden>{open ? '▾' : '▸'}</span>
      </Button>
      {open && tool.arguments !== undefined && (
        <pre className="chat-tool-args">{tool.arguments}</pre>
      )}
    </div>
  )
}

/** 步骤状态用中文写出来：不靠颜色也能读。 */
const STEP_STATE_LABELS: Record<string, string> = {
  running: '运行中',
  ok: '完成',
  error: '失败',
  stopped: '已中断',
}
