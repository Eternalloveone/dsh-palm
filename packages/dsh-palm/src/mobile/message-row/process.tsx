/**
 * 一轮的「过程组」：思考、工具调用与 diff 卡。
 *
 * 2026-11-08 实机投诉后重排为**正文里的一张过程表**（不再是一叠卡）：
 *
 * ```
 * ┌ 12 次工具调用  2 处报错                      ← 24px视觉 / 11px，44px点击区
 * │ 正文留在流里；已完成步骤默认收起，活动步骤与错误直接可见
 * └ [展开：工具步骤 / 思考块 / 叙述文本 / diff 卡]
 * ```
 *
 * 已完成的工具行默认收起；运行中、失败和中断行仍直接可见。展开后默认只列最近 3 条，
 * 其余收成「还有 N 步 ›」；思考与 diff 卡仍在展开体里，答案永远留在卡外。
 * 状态点只报宿主真给过的状态
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
import { LatestCommand } from '../ui/latest-command.tsx'
import { ProcessLine } from '../ui/process-line.tsx'
import { Button } from '../ui/primitives.tsx'
import { ArtifactCards } from './artifact-cards.tsx'
import { ToolDetailSheet } from '../components/tool-detail-sheet.tsx'
import { ToolImages } from './tool-images.tsx'
import { BlockList, type BlockRegistry } from './block-registry.tsx'
import { toVM } from './to-vm.ts'
import type { MessageBlock } from './types.ts'

/**
 * 一轮的"过程组"（桌面端 turn-process 的对应物）。头一行只报两件事：
 * 这一轮跑了多少个工具、有几处报错；已完成步骤默认收起，需关注的状态行直接可见。
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
  // 展开态就是完整时间轴，不再有「还有 N 步」的分页（2026-11-10）。
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
  // 过程折叠行（「▸ 31 次工具调用 · 2 处报错」）：**只报计数**。计划步数在状态条的
  // 文案/刻度轨里，状态词与计时也在那里；这里再报一份就是同一件事说两遍。
  // 展开/收起**复用本组件已有的 `open` 状态**，不另起一份状态。
  // 头行只报计数；已完成步骤折叠，活动/错误/中断状态仍直接可见。
  // 展开体 = 单一时间轴：思考块、叙述文本、工具行按事件顺序交错，整轮的 diff 卡在末尾。
  const stepsText = processStepsText(model, showToolCalls)
  const visibleRows = visibleRowCount(model, showToolCalls)
  // 工具行保留在 DOM 中，切换摘要/展开时不卸载行状态。
  const bodyRows = visibleRows
  // 折叠态 + 运行中：**只渲染最新的一条命令**（固定高度，交叉淡化）。
  // 原来这里铺的是 visibleTools 全量，每来一条新工具就多一行、整块长高 18px ——
  // 用户两次投诉的"跳来跳去"就是它。展开后仍是完整清单，失败/中断照旧全可见。
  const latestTool = visibleTools.length === 0 ? undefined : visibleTools[visibleTools.length - 1]
  // 折叠态始终只显示一条「当前命令」：如果只在 running 时显示，回合结束那一刻
  // 就会从一行跳成 N 行 —— 又是另一种抖动。收起 = 一条，展开 = 时间轴全量。
  const singleCommand = !open && latestTool !== undefined
  const toolsVisibility = open
    ? 'expanded'
    : running || outcome === 'failed' || outcome === 'stopped' || model.errorCount > 0
      ? 'active'
      : 'summary'
  const head = (
    <ProcessLine
      className={bodyRows === 0 ? 'chat-proc-head chat-proc-head-static' : 'chat-proc-head'}
      state={outcome}
      // 没有工具计数时不给结论：沿用 unknown 档的「—」，不拿状态词补位。
      label="—"
      {...(showToolCalls && model.toolCount > 0 ? { toolCalls: model.toolCount } : {})}
      {...(errorsText === '' ? {} : { note: errorsText })}
      // 「改 N 个文件」跟着过程条走（任务头不再重复报）：同一行的第二类计数事实。
      {...(model.changedFiles > 0 ? { files: model.changedFiles } : {})}
      {...(bodyRows === 0 ? {} : { expanded: open, onToggle: () => { setOpen(value => !value) } })}
    />
  )
  // 折叠态才画这一条「当前命令」；展开态的工具行在时间轴里（见下面的 ProcessRows）。
  // 旧版把工具行抽到卡头下方单独一摞（`.chat-proc-tools`），思考与工具看着像两件事，
  // 时间顺序被拍成两截 —— 2026-11-10 用户要求按时间组织，这里不再单独铺一摞。
  const tools = singleCommand && latestTool !== undefined
    ? <LatestCommand text={commandTextOf(latestTool.tool)} state={latestTool.tool.state ?? 'unknown'} />
    : null
  // 没有可展开的东西时头是静态的（bodyRows === 0 那条分支），展开体也就不存在。
  if (bodyRows === 0) {
    return (
      <div className={`chat-proc${running ? ' chat-proc-running' : ''}`} data-proc-rows={visibleRows} data-tools={toolsVisibility}>
        {head}
        {tools}
      </div>
    )
  }
  return (
    <div className={`chat-proc${open ? ' chat-proc-open' : ''}${running ? ' chat-proc-running' : ''}`} data-proc-rows={visibleRows} data-tools={toolsVisibility}>
      {head}
      {tools}
      {open && (
        <div className="chat-proc-body">
          {stepsText !== '' && <div className="chat-proc-steps">{stepsText}</div>}
          {/* 展开体 = 单一时间轴：工具行也在里面（按事件顺序与思考/正文交错）。 */}
          <ProcessRows message={message} model={model} showToolCalls={showToolCalls} focusedQuery={focusedQuery} sessionId={sessionId} />
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
  tool: ({ block, ctx }) => (block.kind === 'tool'
    ? <ToolRow tool={block.tool} {...(ctx.sessionId === undefined ? {} : { sessionId: ctx.sessionId })} />
    : null),
  'tool-group': ({ block, ctx }) => (block.kind === 'tool-group'
    ? <ArtifactCards tools={[...block.tools]} {...(ctx.sessionId === undefined ? {} : { sessionId: ctx.sessionId })} />
    : null),
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
  /** 这一轮还在跑：交付卡是收工物，运行中不画（2026-11-11 用户「运行过程中会弹出来」）。 */
  const running = model.outcome === 'running'
  const blocks = useMemo(() => {
    const raw = toVM(model, { showToolCalls, pending: message.pending === true, stepSeqs: message.stepSeqs })
    // 方案 B1（用户 2026-11-10 拍板）：整轮的改动合并成**一张卡，固定在时间轴末尾**。
    // 时间轴只按事件顺序排"发生过什么"（思考 / 叙述 / 工具行），产出的文件改动统一收口，
    // 这样一轮跑十几次写文件也不会让卡片插在时间轴中间反复出现。
    const cards = raw.flatMap(block => (block.kind === 'tool-group' ? [...block.tools] : []))
    const flow = raw.filter(block => block.kind !== 'tool-group')
    // 2026-11-11 用户：「有时候运行过程中会弹出来这个交付物卡片」。
    // 这张卡是**收工物**：跑的过程中每写一次文件它就重画一次（3 个文件 → 11 个文件），
    // 既打断阅读又和"还没结束"的事实打架。运行中先不画，收工后一次性出现；
    // 过程中的进度由上面的工具行与折叠行计数表达，信息不丢。
    if (cards.length === 0 || running) return flow
    return [...flow, { kind: 'tool-group' as const, key: 'group-turn', tools: cards }]
  }, [model, showToolCalls, message.pending, message.stepSeqs, running])
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
function ToolRow({ tool, sessionId }: { tool: ToolCallInfo; sessionId?: string }) {
  // 整行点开**详情面板**（C1）：以前点开只摊一段原始参数，输出文本根本看不到。
  // 参数仍在 `data-step-args` 上（长按菜单的「复制命令」从这里读）。
  const [detail, setDetail] = useState(false)
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
      {...(tool.arguments === undefined ? {} : { 'data-step-args': tool.arguments })}
    >
      <Button
        type="button"
        className="chat-step-head"
        aria-haspopup="dialog"
        aria-label={`${model.title}${model.summary === '' ? '' : ` · ${model.summary}`}${label === '' ? '' : `，${label}`}，查看详情`}
        onClick={() => { setDetail(true) }}
      >
        <span className="chat-step-dot" data-state={state ?? 'unknown'} aria-hidden />
        <span className="chat-step-title">{model.title}</span>
        <span className="chat-step-summary">{model.summary}</span>
        {label === '' ? null : <span className={`chat-step-state chat-step-state-${state}`}>{label}</span>}
        <span className="palm-proc-caret chat-step-caret" aria-hidden="true">›</span>
      </Button>
      {/* 有图就在标题行下一行直接摆缩略图（用户定版 B：折叠态也要能看见，没有图就不占位）。 */}
      <ToolImages tool={tool} {...(sessionId === undefined ? {} : { sessionId })} />
      {detail && (
        <ToolDetailSheet
          tool={tool}
          {...(sessionId === undefined ? {} : { sessionId })}
          onClose={() => { setDetail(false) }}
        />
      )}
    </div>
  )
}

/**
 * 一条命令的单词行文案：`标题 · 摘要`（没有摘要就只给标题）。
 *
 * 折叠态下这条要挤在过程条下面的一行里，所以只保留"做什么 + 对谁做"两段，
 * 多余信息留给展开体。
 *
 * @param tool - 一次工具调用
 * @returns 单行文案（不会为空：标题一定有）
 */
function commandTextOf(tool: ToolCallInfo): string {
  const model = stepModel(tool)
  return model.summary === '' ? model.title : `${model.title} · ${model.summary}`
}
/** 步骤状态用中文写出来：不靠颜色也能读。 */
const STEP_STATE_LABELS: Record<string, string> = {
  running: '运行中',
  ok: '完成',
  error: '失败',
  stopped: '已中断',
}
