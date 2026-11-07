/**
 * 一轮的「过程组」：思考与工具调用折叠成一行。
 *
 * 从 message-row.tsx 拆出来（W2-3）：过程组自带折叠/展开、计时、步骤高亮，
 * 与消息卡片的排版无关；拆开后 message-row.tsx 只回答「一行消息长什么样」。
 *
 * @module dsh-palm/mobile/message-row/process
 */
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import type { RenderMessage, ToolCallInfo } from '../messages.ts'
import { MarkdownText } from '../markdown-text.tsx'
import {
  diffTallyOf,
  formatDuration,
  isRowRunning,
  processErrorsText,
  processFilesText,
  processHeadText,
  processModel,
  processStateText,
  processStepsText,
  processTimeText,
  visibleRowCount,
  type ProcessModel,
  type ProcessOutcome,
  type ProcessReasoningRow,
} from '../process-rows.ts'
import { stepModel, type StepVariant } from '../step-view.ts'
import { Button } from '../ui/primitives.tsx'
import { forgetTurnAnchor, stableTurnAnchor } from './anchors.ts'
import { ArtifactCards } from './artifact-cards.tsx'

/**
 * The running indicator's whale: one stroked path in a 16×16 box.
 *
 * This is only the still fallback. The living version is the animated PNG at
 * /m/running-whale.png — the same asset the desktop client replays — painted
 * as a `currentColor` mask. Hand-animating the path never got there: rotating
 * it, splitting the two leaves, even morphing the path data all still read as
 * two leaves turning, because the life in that asset comes from drawn
 * deformation, not from anything derivable at this size.
 */
const WHALE_REST_PATH = 'M8.844 13.742C8.967 12.328 8.45 10.4 8.45 9.65C8.45 8.94 8.88 8.43 9.6 8.43C11.285 8.43 12.106 8.281 12.685 8.104C13.71 7.791 14.585 6.768 15.055 5.945C15.137 5.803 14.99 5.641 14.829 5.671C13.829 5.86 12.828 5.376 11.827 4.978C10.659 4.514 9.491 4.707 8.935 4.876C8.805 4.915 8.658 4.819 8.636 4.686C8.468 3.643 7.405 2.615 5.498 2.238C4.54 2.048 3.748 1.574 3.347 1.202C3.252 1.113 3.088 1.125 3.03 1.242C2.628 2.059 2.168 3.82 5.248 6.115C5.82 6.494 6.31 6.785 6.574 7.637C6.72 8.104 6.157 9.168 6.061 9.368C5.157 11.27 5.089 12.19 4.926 13.742'

/**
 * Per-step body of a coalesced turn: each folded step renders as its own
 * anchored block (`data-step-seq`) so a search-hit locate can scroll to the
 * exact step. The streaming tail (the pending current step, whose text is the
 * part of `message.text` beyond the joined finalized steps) renders as a
 * final pending block — keeping the same per-step DOM for pending and settled
 * so the turn never re-lays.
 */
/**
 * 一轮的"过程组"（桌面端 turn-process 的对应物）：思考与工具调用混排在同一棵
 * 子树里，默认折叠成一行 —— 头里只有这一轮花了多久、走了几步、改了多少行，
 * 答案和报告卡留在组外，回复永远不被步骤淹掉。
 *
 * 行不编号（用户拍板乙）：层级只靠缩进和行首字形区分。
 * 没有可展开的行时头是静态的（纯文本回复也照样显示用时），与桌面端一致。
 */
export function ProcessGroup({ message, model, showToolCalls, focusedQuery, focusExpand, sessionId, clockOffsetMs, liveTurnStartAt, liveTurn, settled, liveClockTick }: {
  message: RenderMessage
  model: ProcessModel
  showToolCalls: boolean
  focusedQuery?: string
  /** 从会话内搜索跳过来：折叠的工具步骤要自动展开，命中正文才看得见。 */
  focusExpand?: boolean
  sessionId?: string
  clockOffsetMs?: number
  liveTurnStartAt?: number
  liveTurn?: number
  /** 宿主已裁决这一轮停了：残留的 pending / running 工具不算"还在跑"。 */
  settled?: boolean
  /** 父级的 1 Hz 心跳（见 live-clock.ts）。它每秒变一次，负责把这一行叫醒。 */
  liveClockTick?: number
}) {
  const [open, setOpen] = useState(false)
  // 这一行是从「搜索本会话」跳过来的：命中的正文很可能在折叠着的工具步骤里，不展开
  // 就只看到一张「X 步已完成」的卡，用户以为"搜到了却没定位"（实测渲染出 1759 字，
  // 可搜正文 5157 字，差额全在折叠体里）。深链进入（initialFocusQuery）不展开——那条
  // 路径用户期望先看结论。
  useEffect(() => {
    if (focusExpand === true) setOpen(true)
  }, [focusExpand])
  // 与 processOutcome / currentStepOf 共用同一个"还在跑"判据：只认 pending 会让
  // 运行中的卡片读成"已完成"，秒表也会消失；按步定格的行只有活跃轮次能救它。
  const running = isRowRunning(message, liveTurn, settled)
  // 有外部心跳就靠它叫醒；单独渲染这一行（测试、别的宿主）时才自己挂一个。
  // 两者都只负责"每秒踢一次重渲染"，读数在下面渲染时直接取墙钟。
  const [, setSelfTick] = useState(0)
  useEffect(() => {
    if (!running || liveClockTick !== undefined) return
    const id = setInterval(() => { setSelfTick(previous => previous + 1) }, 1_000)
    return () => { clearInterval(id) }
  }, [running, liveClockTick])
  // 秒表走宿主时间：偏移量来自 frameEvent.time 与本地时间的差，
  // 否则手机 NTP 与宿主差几秒，秒表就和桌面端对不上。
  const now = Date.now()
  // 锚点只认**宿主时间**：行上的 turnStartAt（turn/end 盖的）与页级 liveTurnStartAt
  // （ChatView 从宿主帧推出来的）。原先兜底用的 firstSeenAt 是"手机第一次看到这一行"的
  // 本地时间 —— 中途打开页面、或回合在手机连上之前就开始时，它比宿主真正的回合开始晚
  // 一大截，真机表现就是"手机读数比桌面端偏小"。拿不到宿主锚点就干脆不报秒表（宁缺勿错）。
  const rawAnchor = message.turnStartAt ?? liveTurnStartAt
  // 见 `stableTurnAnchor`：同一轮只认见过的最早锚点（跨重挂、跨刷新都在）。
  const anchorKey = `${sessionId ?? ''}:${message.turn ?? message.id}`
  const clockAnchor = running
    ? stableTurnAnchor(anchorKey, rawAnchor)
    : (forgetTurnAnchor(anchorKey), rawAnchor)
  // 每一帧都直接按墙钟重算：读数 = 现在 + 宿主偏移 − 锚点，取整由 formatDuration
  // 统一向下取整（桌面端同样口径）。
  //
  // 这里以前有一层"只增不减"的棘轮，本意是挡住校准抖动，代价是**偏大的样本一旦
  // 出现就永久留在屏幕上**：偏移被一帧慢包顶高 1.5 秒之后，秒表就永久比桌面快 1.5 秒，
  // 而下一帧真值追上来时要一口气跨两秒 —— 真机"突然跳 2 秒"就是这个。抖动应该在
  // 源头（ChatView 的偏移估计取窗口内最大值）解决，不该把误差冻结在显示值里。
  const liveElapsedMs = running && clockAnchor !== undefined
    ? Math.max(0, now + (clockOffsetMs ?? 0) - clockAnchor)
    : undefined
  // 结束时间以 turn/end 盖上的 durationMs 为准；窗口没收到 turn/end 时退回
  // turn/start 与最后一次触碰的时间差（中断的回合也能给出可信的耗时）。
  const durationMs = message.durationMs
    ?? (message.turnStartAt !== undefined ? Math.max(0, message.time - message.turnStartAt) : undefined)
  const outcome: ProcessOutcome = running ? 'running' : (model.outcome === 'running' ? 'ok' : model.outcome)
  const head = processHeadText(model, {
    running,
    durationMs,
    ...(liveElapsedMs !== undefined ? { liveElapsedMs } : {}),
  })
  const stateText = processStateText(outcome)
  const timeText = processTimeText(outcome, {
    durationMs,
    ...(liveElapsedMs !== undefined ? { liveElapsedMs } : {}),
  })
  const current = model.current
  // 报错信号：只在这轮真有条目报错的工具步骤时才出现，比状态词弱一档（第三档灰、
  // 更小一号），没有就什么也不留（不留空占位）。stopped（中断）不算报错。
  const errorsText = processErrorsText(model)
  const headLabel = errorsText === '' ? head : `${head}，${errorsText}`
  // 灰阶里不出现红绿数字：改动量写成一句人话，放第二行右侧；本回合确定没改动任何
  // 文件时也明说（只有回合结束后才敢下这个结论，运行中返回空串）。
  const filesText = processFilesText(model, !running)
  // 步数移出卡面：展开体首行才报「共 N 步」（关掉"显示工具调用"时不声称步数）。
  const stepsText = processStepsText(model, showToolCalls)
  const visibleRows = visibleRowCount(model, showToolCalls)
  // 行首符号（动作由 CSS 给，结算后动画自动停止）：
  // 运行中画鲸鱼 —— 优先用 /m/running-whale.png 那张动画 PNG（就是桌面端在放
  // 的那一张），以 currentColor 蒙版染色；浏览器不支持 mask-mode 或用户开了
  // "减弱动态效果"时，退回同轮廓的静态 SVG。见 mobile-styles.ts。
  // 结束后**按结果**给符号：成功 ✅ / 失败 ❌ / 中断 ⏹️。此前一律显示 ✓，
  // 失败与中断也挂个对勾，属于误导。
  const leadIcon = model.outcome === 'failed' ? '❌' : model.outcome === 'stopped' ? '⏹️' : '✅'
  const lead = running
    ? (
        <span className="chat-proc-lead chat-proc-lead-running" aria-hidden>
          <span className="chat-proc-whale-loop" />
          <svg className="chat-proc-whale-still" viewBox="0 0 16 16" fill="none" focusable="false">
            <path d={WHALE_REST_PATH} stroke="currentColor" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )
    : <span className="chat-proc-lead" aria-hidden>{leadIcon}</span>
  if (visibleRows === 0) {
    return (
      <div className="chat-proc" data-proc-rows="0">
        <div className="chat-proc-head chat-proc-head-static" role="status" aria-label={headLabel}>
          <span className="chat-proc-line chat-proc-label">
            {lead}
            <span className="chat-proc-state">{stateText}</span>
            {errorsText !== '' && <span className="chat-proc-errors">{errorsText}</span>}
            {timeText !== '' && <span className="chat-proc-time">{timeText}</span>}
          </span>
          {current !== undefined && (
            <span className="chat-proc-line chat-proc-current">
              <span className="chat-proc-current-text">{current.text}</span>
            </span>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className={`chat-proc${open ? ' chat-proc-open' : ''}${running ? ' chat-proc-running' : ''}`} data-proc-rows={visibleRows}>
      <Button
        type="button"
        className="chat-proc-head"
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className="chat-proc-line chat-proc-label">
          {lead}
          <span className="chat-proc-state">{stateText}</span>
          {errorsText !== '' && <span className="chat-proc-errors">{errorsText}</span>}
          {timeText !== '' && <span className="chat-proc-time">{timeText}</span>}
        </span>
        {current !== undefined && (
          <span className="chat-proc-line chat-proc-current">
            {/* 非工具步骤（思考中 / 正在回答）也给行首符号：💭 + 轻微呼吸。
                此前只有工具族才渲染，折叠卡第二行因此比展开后的每一行都少一个符号。
                运行命令时齿轮加转：只有在跑的那一步才转，结算后必须停。 */}
            <span className={`chat-step-icon${current.variant === undefined ? ' chat-step-icon-thinking' : ''}${running && current.variant === 'bash' ? ' chat-step-icon-spin' : ''}`} aria-hidden>
              {current.variant === undefined ? '💭' : stepIcon(current.variant)}
            </span>
            <span className="chat-proc-current-text">{current.text}</span>
            {filesText !== '' && <span className="chat-proc-meta">{filesText}</span>}
          </span>
        )}
        <span className="chat-proc-caret" aria-hidden>{open ? '▾' : '▸'}</span>
      </Button>
      {open && (
        <div className="chat-proc-body">
          {stepsText !== '' && <div className="chat-proc-steps">{stepsText}</div>}
          <ProcessRows message={message} model={model} showToolCalls={showToolCalls} focusedQuery={focusedQuery} focusExpand={focusExpand} sessionId={sessionId} />
        </div>
      )}
    </div>
  )
}

/** 展开体：思考块、工具行、步骤之间的叙述文本、diff 卡，全按事件顺序排。 */
function ProcessRows({ message, model, showToolCalls, focusedQuery, focusExpand, sessionId }: {
  message: RenderMessage
  model: ProcessModel
  showToolCalls: boolean
  focusedQuery?: string
  focusExpand?: boolean
  sessionId?: string
}) {
  const nodes: ReactNode[] = []
  let pendingTools: ToolCallInfo[] = []
  let key = 0
  let textIndex = 0
  const flush = (): void => {
    if (pendingTools.length > 0) {
      nodes.push(<ArtifactCards key={`card-${key}`} tools={pendingTools} />)
      key += 1
      pendingTools = []
    }
  }
  for (const row of model.rows) {
    if (row.kind === 'reasoning') {
      flush()
      nodes.push(<ThinkBlock key={row.key} row={row} />)
      continue
    }
    if (row.kind === 'tool') {
      // 工具行跟着开关走；diff 卡不跟 —— 卡是这一轮的产出（改了哪些文件），
      // 关掉"显示工具调用"是想少看过程噪音，不是想看不到改动。
      if (showToolCalls) nodes.push(<ToolStep key={row.key} tool={row.tool} />)
      if (row.tool.view !== undefined) pendingTools.push(row.tool)
      else flush()
      continue
    }
    flush()
    // Legacy flows carry no part seq: fall back to the coalesced step seq so a
    // search-hit locate can still scroll to this step.
    const stepSeq = row.seq ?? message.stepSeqs?.[textIndex]
    // 过程/步骤正文里**也有答案**：一轮多步被打包成一张卡时，卡的正文字面只渲染
    // 最后一步（process-rows.ts 的 answer = stepTexts[last]），前面各步的正文被折进
    // 这里。索引收的正是这些答案段（每步一条文档），所以这里必须跟着高亮 —— 否则
    // 命中「下一个」落到这一步时，屏幕上连一个标记都没有（真机：计数在走、画面不动）。
    // 推理链（ThinkBlock）与工具卡仍然不参与：它们从来不是索引的命中来源。
    const body = <MarkdownText text={row.text} pending={message.pending === true} forceOpen={focusedQuery !== undefined} highlightQuery={focusedQuery} sessionId={sessionId} />
    nodes.push(stepSeq === undefined
      ? <Fragment key={row.key}>{body}</Fragment>
      : <div key={row.key} className="chat-flow-text" data-step-seq={stepSeq} data-part-id={`text-${textIndex}`}>{body}</div>)
    textIndex += 1
  }
  flush()
  return <>{nodes}</>
}

/**
 * 一段思考：缩进、左侧强调线。折叠时只说"深度思考 · 42 行"，展开才读正文
 * （正文不长时一次给全，不做二级折叠——少一次点击）。
 *
 * 推理链**不参与搜索**：索引只收正文答案，如果这里还按命中词自动展开并高亮，
 * 用户就会看到"搜到的位置落在深度思考里"——搜得到的是答案，跳过去却在推理链上。
 * 所以这里既不收 focusedQuery、也不再按命中自动展开。
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
        <span className="chat-think-icon" aria-hidden>✦</span>
        <span className="chat-think-label">深度思考 · {row.lines} 行</span>
        <span className="chat-think-caret" aria-hidden>{open ? '▾' : '▸'}</span>
      </Button>
      {open && <div className="chat-think-body">{row.text}</div>}
    </div>
  )
}

/**
 * One process-timeline row (the phone's `ToolRow`): state dot, family glyph,
 * the act's title and the args-derived summary. Tapping reveals the raw
 * arguments; the diff content itself stays in the message body where it
 * already renders at its call time point.
 */
function ToolStep({ tool }: { tool: ToolCallInfo }) {
  const [open, setOpen] = useState(false)
  const model = stepModel(tool)
  const state = tool.state ?? 'running'
  const tally = tool.view === undefined ? undefined : diffTallyOf(tool.view)
  return (
    <div
      className="chat-step"
      data-state={state}
      data-step-title={model.title}
      data-step-summary={model.summary}
      data-step-state={STEP_STATE_LABELS[state] ?? state}
    >
      <Button
        type="button"
        className="chat-step-head"
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className="chat-step-icon" aria-hidden>{stepIcon(model.variant)}</span>
        <span className="chat-step-title">{model.title}</span>
        <span className="chat-step-summary">{model.summary}</span>
        <span className={`chat-step-state chat-step-state-${state}`}>{STEP_STATE_LABELS[state] ?? state}</span>
        {tally !== undefined && (
          <span className="chat-step-tally" aria-hidden>
            <span className="chat-step-tally-add">+{tally.adds}</span>
            <span className="chat-step-tally-del">−{tally.dels}</span>
          </span>
        )}
        <span className="chat-step-caret" aria-hidden>{open ? '▾' : '▸'}</span>
      </Button>
      {open && tool.arguments !== undefined && (
        <pre className="chat-tool-args">{tool.arguments}</pre>
      )}
    </div>
  )
}

/** 步骤状态用中文写出来：不靠颜色也能读（用户是普通用户，不是看色卡的）。 */
const STEP_STATE_LABELS: Record<string, string> = {
  running: '运行中',
  ok: '完成',
  error: '失败',
  stopped: '已中断',
}

/** 每步行首符号（手机端用 emoji 集；桌面端对应的是 figma 那套静态 SVG 图标）。 */
function stepIcon(variant: StepVariant): ReactNode {
  if (variant === 'search') return '🔍'
  if (variant === 'read') return '📂'
  if (variant === 'bash') return '⚙️'
  if (variant === 'write' || variant === 'edit') return '✏️'
  if (variant === 'code') return '💻'
  return '🔧'
}
