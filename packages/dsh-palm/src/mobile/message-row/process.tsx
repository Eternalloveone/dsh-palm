/**
 * 一轮的「过程组」：思考、工具调用与 diff 卡。
 *
 * 2026-11-08 实机投诉后重排为**正文里的一张过程表**（不再是一叠卡）：
 *
 * ```
 * ┌ 12 次工具调用  2 处报错                      ← 24px / 11px
 * │ 还有 9 步 ›                                  ← 默认只露最近 3 条
 * │ ● 读文件 · ChatView.tsx            完成      ← 36px 单行，无卡片外壳
 * └ [展开：思考块 / 叙述文本 / diff 卡]
 * ```
 *
 * 工具行默认可见、默认只列最近 3 条（其余收成「还有 N 步 ›」，点一次全展开）；
 * 思考与 diff 卡仍在展开体里，答案永远留在卡外。状态点只报宿主真给过的状态
 * （`running`/`ok`/`error`/`stopped`），拿不到就是灰点，不编"成功/失败"。
 *
 * 头一行只报**计数**：工具调用数与报错数。状态词与计时全页只在任务头的状态条
 * （`ui/status-strip.tsx`）—— 这一行再报一份就是真机上的第二个状态词、第三条计时。
 *
 * @module dsh-palm/mobile/message-row/process
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { RenderMessage, ToolCallInfo } from '../render/messages.ts'
import { MarkdownText } from '../render/markdown-text.tsx'
import {
  processErrorsText,
  processStepsText,
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
import { ArtifactCards } from './artifact-cards.tsx'
import { BlockList, type BlockRegistry } from './block-registry.tsx'
import { toVM } from './to-vm.ts'
import type { MessageBlock } from './types.ts'

/** 默认露出的最近工具行数；更多的收成一行「还有 N 步 ›」。 */
const RECENT_TOOLS = 3

/**
 * 一轮的"过程组"（桌面端 turn-process 的对应物）。头一行只报两件事：
 * 这一轮跑了多少个工具、有几处报错；每行工具在头下面直接列出来。
 * 状态词与计时不在这里（全页只在任务头状态条），所以本组件不再需要时钟。
 * 没有可展开的内容（没有思考、没有叙述、没有 diff 卡）时头是静态的，
 * 不假装能点开。
 */
export function ProcessGroup({ message, model, showToolCalls, focusedQuery, focusExpand, sessionId, authority }: {
  message: RenderMessage
  model: ProcessModel
  showToolCalls: boolean
  focusedQuery?: string
  /** 从会话内搜索跳过来：折叠的工具步骤要自动展开，命中正文才看得见。 */
  focusExpand?: boolean
  sessionId?: string
  /**
   * 宿主快照到齐（水合门，见 `chat-rows.tsx`）。没到就**只画 `unknown`**：
   * 不写状态词、不报耗时。**缺省 = 已水合**（直接渲染这一行的宿主/测试自带证据）。
   */
  authority?: boolean
}) {
  const [open, setOpen] = useState(false)
  // 「还有 N 步 ›」只展开一次：点过就全量，不再二次折叠（回看一轮跑过的 12 步时，
  // 用户要的是"全都在"，不是"再点一次"）。
  const [showAllTools, setShowAllTools] = useState(false)
  // 从「搜索本会话」跳过来：命中的正文很可能在折叠着的展开体里，不展开就只看到
  // 一张"X 步已完成"的卡，用户以为"搜到了却没定位"。
  useEffect(() => {
    if (focusExpand === true) setOpen(true)
  }, [focusExpand])
  // 状态词的唯一来源：`model.outcome`（它的判据在 processOutcome：没有 authority
  // 就是 unknown）。这里不再另判一遍「还在跑」—— 两处判据一旦打架，就会各自
  // 写一个状态词（旧的 `running ? … : model.outcome === 'running' ? 'ok'` 还会
  // 在打架时兜成「已完成」，正是最后一条「缺字段当成功」）。
  const outcome: ProcessOutcome = authority !== false ? model.outcome : 'unknown'
  const running = outcome === 'running'
  // 报错信号：只在这轮真有条目报错的工具步骤时才出现，没有就什么也不留。
  const errorsText = processErrorsText(model)
  const toolRows = model.rows.filter((row): row is ProcessToolRow => row.kind === 'tool')
  const visibleTools = showToolCalls ? toolRows : []
  // 一行一步：默认只露最近 3 条，其余收成一行「还有 N 步 ›」（12 条工具不再刷两屏）。
  const hiddenTools = showAllTools ? 0 : Math.max(0, visibleTools.length - RECENT_TOOLS)
  const shownTools = hiddenTools === 0 ? visibleTools : visibleTools.slice(hiddenTools)
  // 过程折叠行（「▸ 31 次工具调用 · 2 处报错」）：**只报计数**。计划步数在状态条的
  // 文案/刻度轨里，状态词与计时也在那里；这里再报一份就是同一件事说两遍。
  // 展开/收起**复用本组件已有的 `open` 状态**，不另起一份状态。
  // 头行不再另报一份「最近：…」—— 最近 3 步本来就常显在下面。
  // 展开体：思考块、步骤之间的叙述文本、diff 卡。工具行已经常显，不再进这里。
  const bodyRows = visibleRowCount(model, false)
  const stepsText = processStepsText(model, showToolCalls)
  const visibleRows = visibleRowCount(model, showToolCalls)
  const head = (
    <ProcessLine
      className={bodyRows === 0 ? 'chat-proc-head chat-proc-head-static' : 'chat-proc-head'}
      state={outcome}
      // 没有工具计数时不给结论：沿用 unknown 档的「—」，不拿状态词补位。
      label="—"
      {...(showToolCalls && model.toolCount > 0 ? { toolCalls: model.toolCount } : {})}
      {...(errorsText === '' ? {} : { note: errorsText })}
      {...(bodyRows === 0 ? {} : { expanded: open, onToggle: () => { setOpen(value => !value) } })}
    />
  )
  const tools = visibleTools.length === 0 ? null : (
    <div className="chat-proc-tools">
      {/* 折叠行与工具行同一条 36px 行，只在最前面多这一条：其余步骤都收在它后面。 */}
      {hiddenTools === 0 ? null : (
        <div className="chat-step" data-state="fold">
          <Button
            type="button"
            className="chat-step-head"
            aria-expanded={false}
            aria-label={`还有 ${hiddenTools} 步，展开全部`}
            onClick={() => { setShowAllTools(true) }}
          >
            <span className="chat-step-title">还有 {hiddenTools} 步</span>
            <span className="chat-step-caret" aria-hidden="true">›</span>
          </Button>
        </div>
      )}
      {shownTools.map(row => <ToolRow tool={row.tool} key={row.key} />)}
    </div>
  )
  // 没有可展开的东西时头是静态的（bodyRows === 0 那条分支），展开体也就不存在。
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
          <ProcessRows message={message} model={model} showToolCalls={false} focusedQuery={focusedQuery} sessionId={sessionId} />
        </div>
      )}
    </div>
  )
}

/** 展开体：思考块、步骤之间的叙述文本、diff 卡，全按事件顺序排。
 *  上下文：正文高亮、会话 id 都从这里取（定位展开只管"要不要自动打开"，与块无关）。 */
interface ProcessBlocksContext {
  message: RenderMessage
  focusedQuery?: string
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
    <MarkdownText text={block.text} pending={ctx.message.pending === true} forceOpen={ctx.focusedQuery !== undefined}
      highlightQuery={ctx.focusedQuery} sessionId={ctx.sessionId} />
  )
  if (block.seq === undefined) return body
  return <div className="chat-flow-text" data-step-seq={block.seq} data-part-id={`text-${block.index}`}>{body}</div>
}
function ProcessRows({ message, model, showToolCalls, focusedQuery, sessionId }: {
  message: RenderMessage
  model: ProcessModel
  showToolCalls: boolean
  focusedQuery?: string
  sessionId?: string
}) {
  const blocks = useMemo(
    () => toVM(model, { showToolCalls, pending: message.pending === true, stepSeqs: message.stepSeqs }),
    [model, showToolCalls, message.pending, message.stepSeqs],
  )
  return <BlockList blocks={blocks} registry={PROCESS_BLOCK_REGISTRY} ctx={{ message, focusedQuery, sessionId }} />
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
