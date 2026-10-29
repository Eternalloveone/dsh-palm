/**
 * 一轮会话的"过程"行模型 —— 纯函数，无 React、无副作用，单独可测。
 *
 * 设计（2026-10-13 用户拍板，乙＝不编号）：
 * - **过程组**：一轮 assistant 消息的 `flow` 里，除末尾的"答案"之外的一切，
 *   按事件顺序排成行：思考块（缩进、左侧强调线）、工具行（图标＋动词＋对象＋
 *   中文状态）、中间叙述文本。思考与工具因此是**混排**的，与桌面端的
 *   turn-process 子树同构。
 * - **答案**：`flow` 末尾的那个文本段（答案永远在产生它的步骤之后）。单步或
 *   无 flow 的行退回 `message.text`。
 * - **折叠头**：第一行只承载状态词与用时（`已完成，用时1分20秒` / `深度求索中，
 *   用时6分24秒`），耗时数据来自 fold 盖在行上的 `turnStartAt`（运行中实时）与
 *   `durationMs`（回合结束定格）；真有报错步骤时，状态词右边多一个很弱的报错数
 *   （见 processErrorsText）。**步数不在卡面上了**：展开体首行报「共 N 步」
 *   （见 processStepsText，用户拍板：步数移出卡面、展开才看）。
 */
import type { RenderMessage, ToolCallInfo, ToolDiffView } from './messages.ts'
import { stepModel, type StepVariant } from './step-view.ts'

/** 一段思考：缩进文本块，折叠时只看标题，展开才看正文。 */
export interface ProcessReasoningRow {
  readonly kind: 'reasoning'
  readonly key: string
  readonly text: string
  /** 正文行数（折叠头的 `深度思考 · 42 行`）。 */
  readonly lines: number
}

/** 一次工具调用：图标 + 中文动词 + 参数派生摘要 + 状态。 */
export interface ProcessToolRow {
  readonly kind: 'tool'
  readonly key: string
  readonly tool: ToolCallInfo
}

/** 步骤之间的叙述性文本（不是答案，留在过程组里按位置渲染）。 */
export interface ProcessTextRow {
  readonly kind: 'text'
  readonly key: string
  readonly text: string
  readonly seq?: number
}

export type ProcessRow = ProcessReasoningRow | ProcessToolRow | ProcessTextRow

/** 折叠头的状态词：一眼看出成没成（失败与中断不再冒充成功）。 */
export type ProcessOutcome = 'running' | 'ok' | 'stopped' | 'failed'

const OUTCOME_TEXT: Record<ProcessOutcome, string> = {
  running: '深度求索中',
  ok: '已完成',
  stopped: '已中断',
  failed: '失败',
}

export function processStateText(outcome: ProcessOutcome): string {
  return OUTCOME_TEXT[outcome]
}

/**
 * 这一轮"还在跑"的唯一判据。真机实测：宿主是按步发 assistant/message 的，一行可能
 * 在回合中途就被标成已结束（`pending` 已落、最后一个工具也已返回结果），所以只认
 * pending/工具会让运行中的卡片读成"已完成"、秒表也不出现。
 *
 * 三个分量，缺一不可：
 * - `pending === true`：流式行（宿主还在往这一步里灌 delta）；
 * - 还有工具在跑：turn/end 会把在跑的工具翻成 stopped，所以不会把已结束的回合
 *   误判成运行中；
 * - `message.turn === liveTurn`：**这一行属于当前活跃的那一轮**（活跃轮次由宿主
 *   的 turn/start..turn/end 划定，ChatView 把它逐层传下来）。这一步是"按步定格"
 *   的行的唯一救生索 —— 它自己看不出回合还开着，只有视图级的活跃轮次知道。
 *   行没有 turn 字段、或活跃轮次已翻到下一轮（turn/end 到了）时，这一条不成立。
 *
 * 折叠头的状态词/秒表（message-row）与第二行（currentStepOf）必须共用这一个判据，
 * 否则会出现头读"深度求索中"、第二行却走"已结束"分支的自相矛盾。
 *
 * `settled` 是宿主给出的裁决：这一轮确定不在跑了。它为真时一律返回 false ——
 * 回合中途断流/被杀时，最后一次流式的行永远不会收到定稿的 assistant/message，
 * `pending` 就留在 true 上；只靠这个判据的话，那个过程框会永远显示"深度求索中"、
 * 秒表也永远不停。宿主说停了就是停了，残留的 pending / running 工具都不算数。
 *
 * 旧轮次的行同样一律不算在跑：活跃轮次已经翻过去，说明那一轮早就结束了。它的
 * `pending` 或"还在跑"的工具只是那一轮自己的收尾丢了（turn/end 没到、工具结果没
 * 回），不能拿它当"此刻还在跑"的证据 —— 否则手机在跑最新一轮时，上面几个旧过程框
 * 会一起转圈。
 */
export function isRowRunning(message: RenderMessage, liveTurn?: number, settled?: boolean): boolean {
  if (settled === true) return false
  if (liveTurn !== undefined && message.turn !== undefined && message.turn < liveTurn) return false
  return message.pending === true
    || (message.tools ?? []).some(tool => tool.state === 'running')
    || (liveTurn !== undefined && message.turn !== undefined && message.turn === liveTurn)
}

/** 成败的真源：turn/end 的 failed / max-tokens，以及被它收尾的 stopped 工具。 */
export function processOutcome(message: RenderMessage, liveTurn?: number, settled?: boolean): ProcessOutcome {
  if (isRowRunning(message, liveTurn, settled)) return 'running'
  if (message.failed === true) return 'failed'
  if (message.maxTokens === true) return 'stopped'
  return (message.tools ?? []).some(tool => tool.state === 'stopped') ? 'stopped' : 'ok'
}

/** 折叠头第二行：此刻进行到哪一步。 */
export interface ProcessCurrent {
  /** tool＝有具体动作；thinking＝模型在想；answering＝在写回复。 */
  readonly kind: 'tool' | 'thinking' | 'answering'
  /** 一行简报，例如「运行命令 · pytest -q」。 */
  readonly text: string
  /** 工具行的族（留给行首字形用）。 */
  readonly variant?: StepVariant
}

export interface ProcessModel {
  /** 过程行，已按事件顺序排序。空数组＝这一轮没有可折叠的过程（纯文本回答）。 */
  readonly rows: readonly ProcessRow[]
  /** 末尾文本段（答案），渲染在过程组之外。 */
  readonly answer: string | undefined
  readonly answerSeq: number | undefined
  readonly toolCount: number
  readonly reasoningCount: number
  /** 有 diff 视图的工具行数（关掉"显示工具调用"时仍会渲染这些卡片）。 */
  readonly artifactCount: number
  /** 这一轮所有 diff 视图的增/删行数（折叠头显示，不用展开就能看到改动量）。 */
  readonly tallyAdds: number
  readonly tallyDels: number
  /** 折叠头第二行的内容；没有值得说的一步时为 undefined（隐藏该行）。 */
  readonly current: ProcessCurrent | undefined
  /** 这一轮成没成。 */
  readonly outcome: ProcessOutcome
  /** 这一轮改过几个文件（去重后的 diff 路径数）。 */
  readonly changedFiles: number
  /**
   * 报错的工具步数（`state === 'error'` 的调用数）。
   * `stopped` 不算：那是 turn/end 把还在跑的工具翻掉的（中断），不是报错。
   */
  readonly errorCount: number
  /** 有 diff 视图的工具行的标题，用第一张卡的名字做代表（没有则为空串）。 */
  readonly artifactTitle: string
}

/** Added/removed line counts of a diff view. The artifact head's tally and the
 *  step row's suffix share it, so one view can never report two numbers. */
export function diffTallyOf(view: ToolDiffView | undefined): { adds: number; dels: number } {
  if (view === undefined) return { adds: 0, dels: 0 }
  let adds = 0
  let dels = 0
  for (const diff of view.diffs) {
    if (diff.oldText !== null) dels += toolDiffLines(diff.oldText).length
    adds += toolDiffLines(diff.newText).length
  }
  return { adds, dels }
}

/** Split one diff side into content lines (a trailing newline is a terminator). */
export function toolDiffLines(text: string): string[] {
  if (text === '') return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

/**
 * Human turn duration: `9分29秒` / `19秒` / `1小时2分`.
 *
 * Desktop parity (`formatRunDuration` in the desktop chat chrome): whole
 * seconds are FLOORED, never rounded. Rounding put the phone up to half a
 * second ahead of the desktop, and because the reading is re-derived from the
 * wall clock on every render, a tick that landed just past the half-second
 * showed one second more than the desktop at the same instant — read as "手机
 * 的秒表比桌面快". Floor makes the two numbers identical.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  // 超过一小时也要带秒：长回合里只看"几分"根本看不出还在不在动（用户要求）。
  if (hours > 0) return `${hours}小时${minutes}分${seconds}秒`
  if (minutes > 0) return `${minutes}分${seconds}秒`
  return `${seconds}秒`
}

/** Non-empty line count of a reasoning run (the think block's `N 行`). */
export function lineCount(text: string): number {
  return text.split('\n').length
}

/** Total diff tally of a set of tool calls (the collapsed head's `+N −M`). */
export function tallyOfTools(tools: readonly ToolCallInfo[]): { adds: number; dels: number } {
  let adds = 0
  let dels = 0
  for (const tool of tools) {
    const tally = diffTallyOf(tool.view)
    adds += tally.adds
    dels += tally.dels
  }
  return { adds, dels }
}

/**
 * 哪一段算"答案"：**步骤判据** —— 最后一个步骤的文本是答案（渲染在过程组之外），
 * 之前各步的文本留在组内当过程叙述。步骤身份来自 coalesce 记下的
 * `stepSeqs` / `stepTexts`（并行数组，一步一项）。
 *
 * 位置判据（flow 末尾的文本段）只用于在 flow 里定位那个文本段：最后一步可能以
 * 工具调用收尾，那时末尾的文本段属于更早的一步，按位置取答案会把过程叙述
 * 当成结论。单步行（没有步骤数组）自己就是最后一步 —— 整行文本即答案。
 */
function answerPartOf(
  message: RenderMessage,
  flow: ReadonlyArray<{ readonly kind: string; readonly text?: string; readonly seq?: number }>,
  target: string,
  lastSeq: number | undefined,
): number {
  for (let i = flow.length - 1; i >= 0; i--) {
    const part = flow[i]
    if (part === undefined || part.kind !== 'text') continue
    if (part.seq !== undefined && lastSeq !== undefined && part.seq === lastSeq) return i
    if (part.text === target) return i
  }
  return -1
}

/**
 * Split a folded assistant row into the process rows and the answer.
 * Order is preserved exactly as the fold recorded it, so thinking and tool calls
 * stay interleaved the way they happened.
 */
export function processModel(message: RenderMessage, liveTurn?: number, settled?: boolean): ProcessModel {
  const flow = message.flow ?? []
  const toolsById = new Map((message.tools ?? []).map(tool => [tool.callId, tool] as const))

  // 多步（coalesce 过的回合）：最后一步的文本才是答案，前面各步的文本是过程叙述。
  const steps = message.stepSeqs
  const stepTexts = message.stepTexts
  const splittable = steps !== undefined && stepTexts !== undefined
    && steps.length === stepTexts.length && stepTexts.length >= 2
  const lastStepText = splittable ? (stepTexts[stepTexts.length - 1] ?? '') : ''
  const lastStepSeq = splittable ? steps[steps.length - 1] : undefined
  const multiStepAnswer = splittable && lastStepText.trim() !== ''

  // 运行中不提升：这一轮还在跑时，末尾那段文本随时会被下一步取代，先提升到卡外就会
  // "闪一下又被收进卡里"（真机 1 秒内可见）。跑着时一律留在组内（可展开），等这一轮
  // 结束（turn/end，或活跃轮次翻走）再把最后一步的文本提到卡外 —— 只切一次。
  const running = isRowRunning(message, liveTurn, settled)
  let answer: string | undefined
  let answerSeq: number | undefined
  let answerIndex = -1
  let skipText = false
  if (multiStepAnswer) {
    answer = lastStepText
    answerSeq = lastStepSeq
    answerIndex = answerPartOf(message, flow, lastStepText, lastStepSeq)
  } else if (!splittable) {
    // 单步：整行的文本就是这一步的文本 ＝ 答案。该步的所有文本段都归答案，
    // 不在过程组里重复渲染。
    const textParts = flow.filter(part => part.kind === 'text' && part.text.trim() !== '') as ReadonlyArray<{ readonly kind: 'text'; readonly text: string; readonly seq?: number }>
    skipText = true
    if (message.text.trim() !== '') {
      answer = message.text
      // 锚点沿用这个文本段自己的 seq：搜索定位到这一步仍然能滚过去。
      answerSeq = textParts[0]?.seq
    } else if (textParts.length > 0) {
      const tail = textParts[textParts.length - 1]
      if (tail !== undefined) {
        answer = tail.text
        answerSeq = tail.seq
      }
    }
  } else if (running) {
    // 多步、而最后一步还没产出文本（刚起了工具或开始思考）：把"最近一段文本"继续留在
    // 卡外。否则卡外会瞬间空掉、那段文本又被收进卡里 —— 真机上就是"闪一下就不见了"。
    // 只影响运行中的行，回合结束后仍走上面两条既有分支。
    for (let i = flow.length - 1; i >= 0; i--) {
      const part = flow[i]
      if (part === undefined || part.kind !== 'text' || part.text.trim() === '') continue
      answer = part.text
      answerSeq = part.seq
      answerIndex = i
      break
    }
  }

  const rows: ProcessRow[] = []
  let toolCount = 0
  let reasoningCount = 0
  for (let i = 0; i < flow.length; i++) {
    const part = flow[i]
    if (part === undefined || i === answerIndex) continue
    if (part.kind === 'reasoning') {
      if (part.text.trim() === '') continue
      reasoningCount += 1
      rows.push({ kind: 'reasoning', key: `r${i}`, text: part.text, lines: lineCount(part.text) })
    } else if (part.kind === 'tool') {
      const tool = toolsById.get(part.callId)
      if (tool === undefined) continue
      toolCount += 1
      rows.push({ kind: 'tool', key: `t${i}`, tool })
    } else if (!skipText && part.text.trim() !== '') {
      rows.push({ kind: 'text', key: `x${i}`, text: part.text, ...(part.seq !== undefined ? { seq: part.seq } : {}) })
    }
  }

  // 已登记但 flow 里没有对应部件的调用（历史适配器可能省略 flow 部件）：位置不可知，
  // 补在过程末尾 —— 正好在答案之前，至少让步骤行和 diff 卡可见，不会被藏起来。
  const seenCalls = new Set<string>()
  for (const part of flow) {
    if (part.kind === 'tool') seenCalls.add(part.callId)
  }
  for (const item of message.tools ?? []) {
    if (seenCalls.has(item.callId)) continue
    toolCount += 1
    rows.push({ kind: 'tool', key: `t-${item.callId}`, tool: item })
  }

  // Legacy / adapter-omitted shapes: reasoning that only ever arrived as a
  // merged string (no positioned part). Its position inside the turn is
  // unknowable, so it goes first — the honest place for "before everything".
  if (reasoningCount === 0 && (message.reasoning ?? '').trim() !== '') {
    const text = message.reasoning ?? ''
    rows.unshift({ kind: 'reasoning', key: 'r-merged', text, lines: lineCount(text) })
    reasoningCount = 1
  }

  // 完全没有 flow、也没抽到答案的纯文本行：整行文本仍是答案。
  if (answer === undefined && rows.length === 0 && message.text.trim() !== '') {
    answer = message.text
  }

  const current = currentStepOf(message, rows, liveTurn, settled)
  const changed = new Set<string>()
  let artifactTitle = ''
  // 报错数只算「最终仍然失败」的调用：同一 callId 先 error、后来重试成功（state 变 ok）
  // 时不该在收工的卡上永远挂着「⚠ 1 处报错」——那是过程，不是结果。
  const finalStateByCall = new Map<string, string>()
  for (const tool of message.tools ?? []) {
    const id = tool.callId
    const state = tool.state
    if (id !== undefined && state !== undefined) finalStateByCall.set(id, state)
  }
  let errorCount = 0
  const countedErrors = new Set<string>()
  for (const tool of message.tools ?? []) {
    // 报错只认工具行自己的 state（tool/result 的 isError/error 落定）；stopped 是
    // turn/end 的中断收尾，不算报错。
    if (tool.state === 'error') {
      const callId = tool.callId
      const finalState = callId === undefined ? tool.state : finalStateByCall.get(callId) ?? tool.state
      const key = callId ?? `anon-${errorCount}`
      if (finalState === 'error' && !countedErrors.has(key)) {
        countedErrors.add(key)
        errorCount += 1
      }
    }
    for (const diff of tool.view?.diffs ?? []) changed.add(diff.path)
    if (artifactTitle === '' && tool.view !== undefined) artifactTitle = tool.view.title ?? tool.name
    // 宿主的 view 不是到处都有：本仓实测 49 次工具调用（含 13 次真改文件）里 view
    // 是零个，于是「未改动文件」成了永远的输出 —— 一句会骗人的话。改文件的工具的
    // 参数里带着路径，那是我们自己就有的证据，拿它兜底。
    for (const path of writtenPathsOf(tool)) changed.add(path)
  }
  const tally = tallyOfTools(message.tools ?? [])
  return {
    rows,
    answer,
    answerSeq,
    toolCount,
    reasoningCount,
    current,
    outcome: processOutcome(message, liveTurn, settled),
    changedFiles: changed.size,
    errorCount,
    artifactTitle,
    artifactCount: rows.filter(row => row.kind === 'tool' && row.tool.view !== undefined).length,
    tallyAdds: tally.adds,
    tallyDels: tally.dels,
  }
}

/**
 * 这一轮"看得见的行"有几行 —— 决定折叠头是不是可展开的。关掉"显示工具调用"时
 * 工具行不渲染，但有 diff 视图的卡片仍然渲染，所以卡片也要算进去。
 */
/** 折叠头第二行：此刻进行到哪一步。运行中看最新事件，结束后报最后一步做了什么。 */
function currentStepOf(message: RenderMessage, rows: readonly ProcessRow[], liveTurn?: number, settled?: boolean): ProcessCurrent | undefined {
  // 复用同一个"还在跑"判据（含活跃轮次）：pending 已落下但还有工具在跑、或这一行
  // 就属于当前活跃轮次的行同样是运行中，第二行必须走"进行中"分支（末尾是思考报
  // "思考中"、末尾是文本报"正在回答"）。
  if (isRowRunning(message, liveTurn, settled)) {
    const flow = message.flow ?? []
    const last = [...flow].reverse().find(part => !(part.kind === 'text' && part.text.trim() === ''))
    if (last === undefined || last.kind === 'reasoning') return { kind: 'thinking', text: '思考中' }
    if (last.kind === 'text') return { kind: 'answering', text: '正在回答' }
    const row = rows.find(candidate => candidate.kind === 'tool' && candidate.tool.callId === last.callId)
    if (row === undefined || row.kind !== 'tool') return { kind: 'thinking', text: '思考中' }
    // 工具已经跑完、下一句还没来：模型正在想下一步。
    return row.tool.state === 'running' ? currentOfTool(row.tool) : { kind: 'thinking', text: '思考中' }
  }
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]
    if (row === undefined) continue
    if (row.kind === 'tool') return currentOfTool(row.tool)
    if (row.kind === 'reasoning') return { kind: 'thinking', text: `深度思考 ${row.lines} 行` }
  }
  return undefined
}

/** 工具行的一句话：「运行命令 · pytest -q」。 */
function currentOfTool(tool: ToolCallInfo): ProcessCurrent {
  const model = stepModel(tool)
  return {
    kind: 'tool',
    text: model.summary === '' ? model.title : `${model.title} · ${model.summary}`,
    variant: model.variant,
  }
}

/**
 * 会落盘的工具名（小写比较）。
 *
 * 只列"名字一出现就必然写文件"的：纯读的 read/grep/glob 不在内，命令行工具也在
 * 外——`pwsh` 里 sed、cp、重定向都能改文件，但那要靠参数语义猜，猜错就会谎报，
 * 宁可不算。
 */
const WRITING_TOOLS = new Set([
  'edit',
  'write',
  'write_file',
  'multi_edit',
  'multiedit',
  'apply_patch',
  'applypatch',
  'str_replace',
  'str_replace_editor',
  'create_file',
  'notebook_edit',
])

/** 参数里可能装路径的键（各家工具命名不一致，能认的都认）。 */
const ARGUMENT_PATH_KEYS = ['file_path', 'filePath', 'path', 'file', 'target_file', 'notebook_path']

/**
 * 这次调用写的是哪个文件——从**参数**里读。
 *
 * 宿主给的结果视图（`view.diffs`）在这个部署里实测是零个，只认它的话「未改动文件」
 * 就成了永远的输出，而它明明是一句会骗人的结论。参数是我们本来就有的一手证据。
 * 参数里挑不出路径时（比如整体补丁），退成一个按 callId 唯一的名字：改了，只是不知
 * 改的是哪个文件——数量上仍然算一次，不至于把改动报成零。
 */
function writtenPathsOf(tool: ToolCallInfo): string[] {
  if (!WRITING_TOOLS.has(tool.name.toLowerCase())) return []
  // error / stopped 都没落盘，不能算作改动。
  if (tool.state === 'error' || tool.state === 'stopped') return []
  // 有视图就以视图为准：那边的路径是宿主的正式口径，这里的参数只是兜底。两边都收
  // 会把同一个文件算两次（视图常用相对路径，参数是绝对路径，去重抵不掉）。
  if ((tool.view?.diffs?.length ?? 0) > 0) return []
  const args = parseToolArguments(tool.arguments)
  const paths: string[] = []
  for (const key of ARGUMENT_PATH_KEYS) {
    const value = args?.[key]
    if (typeof value === 'string' && value.trim() !== '') paths.push(value)
  }
  return paths.length > 0 ? paths : [`?${tool.callId}`]
}

function parseToolArguments(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** 第二行右侧的补充信息：「改了 3 个文件」/「未改动文件」。 */
export function processFilesText(model: ProcessModel, settled: boolean): string {  // 有改动时运行中也照报数量（文件数只会涨，不会说谎）。
  if (model.changedFiles > 0) return `改了 ${model.changedFiles} 个文件`
  // "没改动"只有回合结束才敢下结论：运行中文件数还会涨，此时报"未改动文件"就是误报。
  return settled ? '未改动文件' : ''
}

/**
 * 展开体首行的步数（「共 4 步」）—— 卡面第一行不再拼步数（用户拍板：步数移出卡面，
 * 展开才看）。口径与旧卡面的 `· N 步` 完全一致：N 是本轮的工具调用数。关掉"显示
 * 工具调用"时工具行不渲染，于是也不再声称步数（沿用旧行为），返回空串。
 */
export function processStepsText(model: ProcessModel, showToolCalls: boolean): string {
  const steps = showToolCalls ? model.toolCount : 0
  return steps > 0 ? `共 ${steps} 步` : ''
}

/**
 * 卡面第一行的报错信号（「⚠ 2 处报错」）；没有报错步骤时是空串 —— 不留空占位。
 * 判据只认工具行自己的 `state === 'error'`（由 tool/result 的 isError/error 落定，
 * 见 messages.ts 的 applyToolResult）；`stopped` 是 turn/end 把还在跑的工具翻掉的
 * （中断，不是报错），不计入。
 */
export function processErrorsText(model: ProcessModel): string {
  return model.errorCount > 0 ? `⚠ ${model.errorCount} 处报错` : ''
}

export function visibleRowCount(model: ProcessModel, showToolCalls: boolean): number {
  if (showToolCalls) return model.rows.length
  return model.rows.filter(row => row.kind !== 'tool').length + model.artifactCount
}

/**
 * The collapsed head's label (the static head's `aria-label` and the whole
 * sentence in tests): the state word plus the turn's duration. Running turns
 * tick (`深度求索中，用时6分24秒`), settled turns report what they cost
 * (`已完成，用时1分20秒`). The step count is NOT part of it any more — it moved
 * into the expanded panel (`共 N 步`, see processStepsText).
 */
/** 少于这个时长不报秒数：刚开口就闪一个"用时1秒"反而像故障。 */
export const RUNNING_CLOCK_THRESHOLD_MS = 3_000

export function processHeadText(model: ProcessModel, input: { running: boolean; durationMs: number | undefined; liveElapsedMs?: number }): string {
  // 运行中不报时间：实时计时归底部状态行（"输出中 · 6分24秒"，P0 起就在那儿，
  // 而且消息滚出屏幕也看得见）。同一时刻只允许一个地方在数秒。
  const outcome: ProcessOutcome = input.running ? 'running' : (model.outcome === 'running' ? 'ok' : model.outcome)
  const time = processTimeText(outcome, input)
  // 屏幕上状态词与用时是两个元素（用时靠右对齐，不该出现孤零零的逗号），
  // 但整句（aria-label 与测试用）保持"已完成，用时1分20秒"。
  return time === '' ? processStateText(outcome) : `${processStateText(outcome)}，${time}`
}

/**
 * 状态词后面那半句（「，用时3分33秒」）。运行中不足阈值时是空的 ——
 * 刚开口就闪一个"用时1秒"反而像故障；回合没结束又没锚点时也只有状态词。
 *
 * 步数已经不在这一句里（用户拍板：步数移出卡面，展开体首行报「共 N 步」）：
 * 没有时长 ⇒ 空串，第一行只剩状态词，绝不出现孤零零的 `N 步`。
 */
export function processTimeText(
  outcome: ProcessOutcome,
  input: { durationMs: number | undefined; liveElapsedMs?: number },
): string {
  if (outcome === 'running') {
    return input.liveElapsedMs === undefined || input.liveElapsedMs < RUNNING_CLOCK_THRESHOLD_MS
      ? ''
      : `用时${formatDuration(input.liveElapsedMs)}`
  }
  return input.durationMs === undefined ? '' : `用时${formatDuration(input.durationMs)}`
}
