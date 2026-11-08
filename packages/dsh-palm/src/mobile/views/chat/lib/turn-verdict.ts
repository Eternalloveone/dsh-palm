/**
 * 把「回合尾行」翻译成结论卡的四态与文案（P4 的适配层；2026-11-08 按对照稿重排版式）。
 *
 * 为什么单独一层：四态判定是**产品规则**（成了没成、要不要你决定、在跑、没跑通），
 * 而渲染只认 `VerdictCardProps`。把规则关在这里，可以用纯函数测透，不必挂 DOM；
 * 视图只负责"什么时候把这张卡放出来"。
 *
 * 一条硬约束：**数字必须真实**。这里只搬宿主的真数据：
 * - 耗时：`durationMs`（turn/end 定格的那一个）；
 * - 工具：本轮 assistant 行上真实发生的调用数（由 ChatRows 数出来传进来，或缺省取行上的 tools）；
 * - 文件：交付物 + 产出文件条数。
 * 任何一项拿不到就整项省略（连 0 都不补）——绝不用"大概"顶上去。
 *
 * @module dsh-palm/mobile/views/chat/lib/turn-verdict
 */
import type { RenderMessage } from '../../../projections/types.ts'
import type { VerdictCardProps, VerdictChip, VerdictStat, VerdictState } from '../../../ui/verdict-card.tsx'

/** 判定所需的外部信号。 */
export interface TurnVerdictInput {
  /** 回合尾行（`kind === 'turn'`），没有尾行时传 undefined。 */
  message: RenderMessage | undefined
  /** 这一轮还在跑（宿主还在出事件）。 */
  running: boolean
  /** 宿主连接断了（断线时不给"失败"结论，那是两回事）。 */
  hostLost?: boolean
  /** 这一轮挂着待你决定的审批/提问（优先于其它态）。 */
  awaitingDecision?: boolean
  /** 主操作（如"看看改动"），由调用方决定要不要给。 */
  primaryAction?: { label: string; onRun: () => void }
  /** 本轮真实发生的工具调用数（由行列表数出来；拿不到就不传）。 */
  tools?: number
}

/** 结论句最多取这么多个字，超出截断。 */
const HEADLINE_MAX = 48

/** 取第一句作结论句（没有句号就整段截断）。 */
function firstSentence(text: string): string {
  const trimmed = text.trim()
  if (trimmed === '') return ''
  const match = /^[\s\S]*?[。！？!?]/.exec(trimmed)
  const sentence = (match === null ? trimmed : match[0]).trim()
  return sentence.length > HEADLINE_MAX ? `${sentence.slice(0, HEADLINE_MAX)}…` : sentence
}

/** 真实条数：交付物 + 产出文件（没有就是 0，不渲染这一项）。 */
function filesOf(message: RenderMessage | undefined): number {
  if (message === undefined) return 0
  return (message.deliverables?.length ?? 0) + (message.produced?.length ?? 0)
}

/** 本轮工具次数：优先用调用方数出来的（跨行去重），否则退回行上带的调用。 */
function toolsOf(message: RenderMessage | undefined, tools: number | undefined): number {
  if (tools !== undefined && Number.isFinite(tools) && tools >= 0) return Math.round(tools)
  if (message?.tools === undefined) return 0
  return new Set(message.tools.map(tool => tool.callId)).size
}

/**
 * 耗时的展示口径：`12.4s`（对照稿）；到分钟量级就取整秒。
 * 只搬运 `durationMs`，不做任何估算。
 */
function secondsText(durationMs: number): string {
  const seconds = Math.max(0, durationMs) / 1000
  const rounded = seconds >= 60 ? Math.round(seconds) : Math.round(seconds * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}s`
}

/** 一行三个大号数字：耗时 / 工具 / 文件；缺的整项跳过。 */
function statsOf(message: RenderMessage | undefined, tools: number): VerdictStat[] {
  const stats: VerdictStat[] = []
  if (message?.durationMs !== undefined) stats.push({ value: secondsText(message.durationMs), label: '耗时' })
  if (tools > 0) stats.push({ value: tools.toLocaleString('en-US'), label: '工具' })
  const files = filesOf(message)
  if (files > 0) stats.push({ value: files.toLocaleString('en-US'), label: '文件' })
  return stats
}

/** 底部彩色标签：每条都对应一件已发生的事实，没有就整行不渲染。 */
function chipsOf(message: RenderMessage | undefined, tools: number): VerdictChip[] {
  const chips: VerdictChip[] = []
  const files = filesOf(message)
  if (files > 0) chips.push({ label: `${files} 个文件`, tone: 'ok' })
  if (tools > 0) chips.push({ label: `${tools} 次工具`, tone: 'info' })
  if (message?.maxTokens === true) chips.push({ label: '输出被截断', tone: 'warn' })
  if (message?.failed === true) chips.push({ label: '本次回复失败', tone: 'warn' })
  return chips
}

/** 把统计与标签拼进 props（空数组不出现，避免空壳）。 */
function withFacts(props: VerdictCardProps, message: RenderMessage | undefined, tools: number): VerdictCardProps {
  const stats = statsOf(message, tools)
  const chips = chipsOf(message, tools)
  return {
    ...props,
    ...(stats.length === 0 ? {} : { stats }),
    ...(chips.length === 0 ? {} : { chips }),
  }
}

/**
 * 算出结论卡的四态。
 *
 * 优先级：**待决定 > 在跑 > 有产出 > 没做成**。
 * 断线（`hostLost`）不算"没做成"——那是连接问题，归 `working` 的补充句去解释。
 */
export function verdictStateOf(input: TurnVerdictInput): VerdictState {
  if (input.awaitingDecision === true) return 'decision'
  if (input.running) return 'working'
  const message = input.message
  if (message === undefined) return 'working'
  const hasArtifacts = (message.deliverables?.length ?? 0) > 0 || (message.produced?.length ?? 0) > 0
  const hasText = message.text.trim() !== ''
  if (hasArtifacts || hasText) return 'conclusion'
  return 'failed'
}

/**
 * 组装 `VerdictCard` 的 props。
 *
 * @param input - 回合尾行与外部信号
 * @returns 结论卡 props；没有可说的内容时返回 undefined（不渲染空卡）
 */
export function turnVerdictProps(input: TurnVerdictInput): VerdictCardProps | undefined {
  const state = verdictStateOf(input)
  const message = input.message
  const headline = firstSentence(message?.text ?? '')
  const tools = toolsOf(message, input.tools)

  if (state === 'working') {
    return withFacts({
      state,
      headline: headline === '' ? '正在处理这一轮' : headline,
      detail: input.hostLost === true ? '连接断开，恢复后会接着同步' : '还没结束，结果出来后替换这张卡',
    }, message, tools)
  }

  if (state === 'decision') {
    return withFacts({
      state,
      headline: headline === '' ? '有一件事等你决定' : headline,
      detail: '决定之后这一轮才会继续',
      ...(input.primaryAction === undefined
        ? {}
        : { actions: [{ label: input.primaryAction.label, onRun: input.primaryAction.onRun, primary: true }] }),
    }, message, tools)
  }

  if (state === 'failed') {
    return withFacts({
      state,
      headline: '这一轮没有产出',
      detail: '正文和文件都是空的；可以直接重试',
      ...(input.primaryAction === undefined
        ? {}
        : { actions: [{ label: input.primaryAction.label, onRun: input.primaryAction.onRun, primary: true }] }),
    }, message, tools)
  }

  return withFacts({
    state,
    headline: headline === '' ? '这一轮已完成' : headline,
    ...(input.primaryAction === undefined
      ? {}
      : { actions: [{ label: input.primaryAction.label, onRun: input.primaryAction.onRun }] }),
  }, message, tools)
}
