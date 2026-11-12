/**
 * 过程折叠行：会话正文里那一行「▸ 31 次工具调用 · 2 处报错」。
 *
 * 版式真源：`docs/prototype/overview.html`「2 · 会话正文」的
 * `▸ 7 步过程 · 31 次工具调用`（`overview.html` 的 `.steps/.sp`），
 * 以及 `docs/prototype/delivery-card.html` 同位置的 `.sp`。
 *
 * 三条硬规则：
 * 1. **不持有状态**：展开与否、点开做什么，都由既有的过程组（`ProcessGroup`
 *    的 `open` / `setOpen`）决定；本组件只是受控的一行。`onToggle` 不给时
 *    渲染成静态行（`role="status"`），不假装能点。
 * 2. **只报计数，不报状态词与计时**：这一行只说「N 次工具调用」与「M 处报错」；
 *    状态词与耗时全页只在任务头的状态条里（`ui/status-strip.tsx`）。缺哪项就
 *    少说一项，两个都没有才退回调用方给的占位（`—`）。
 * 3. **触控 ≥44px**：可点行的最小高度吃 `--palm-hit`；运行中追加的
 *    「最近 3 步」是第二行，不挤占点击区。
 *
 * @module dsh-palm/mobile/ui/process-line
 */
import { Button } from './primitives.tsx'
import { FlipNumber } from './flip-number.tsx'

/** 过程行的 props。 */
export interface ProcessLineProps {
  /** 真实工具调用次数（`31 次工具调用`）；拿不到就不传。 */
  toolCalls?: number
  /** 计数拿不到时的占位（`—`：没有权威数据，不给结论）。 */
  label?: string
  /** 这一轮还在跑（点阵呼吸、进度线扫光、命令条交叉淡化都以它为准）。 */
  running?: boolean
  /** 报错信号（沿用既有口径：`2 处报错`）。 */
  note?: string
  /**
   * 这一轮改过几个文件（`改 7 个文件`）。
   *
   * 2026-11-10 按用户要求从任务头状态条的灰字搬到这里：它是**这一轮过程的产出量**，
   * 和「N 次工具调用 · M 处报错」是同一类事实，放在同一行才讲得通；状态条只说状态与耗时。
   * 传 0 或不传都不画（没有改动就不占位）。
   */
  files?: number
  /** 这一行代表的过程状态（running / ok / stopped / failed），落到 `data-state` 供样式与诊断。 */
  state?: string
  // 2026-11-10：环形进度已删除（用户：「没有任何作用」）。步数仍由展开体首行
  // 「共 N 步」报，头行只留计数 + 报错 + 文件数，右侧只挂展开箭头。
  /** 额外的根类名（既有过程组的 `chat-proc-head` 等钩子由调用方挂）。 */
  className?: string
  /** 展开状态（受控；由既有过程组持有）。 */
  expanded?: boolean
  /** 点整行切换展开/收起；不给就是静态行。 */
  onToggle?: () => void
}

/** 正整数的千分位文本；0/非有限数返回空串（不占位）。 */
function countText(value: number): string {
  return Number.isFinite(value) && value > 0 ? Math.round(value).toLocaleString('zh-CN') : ''
}

/**
 * 把「2 处报错」这种 `数字 + 后缀` 的文案拆开，让数字走滚动动效。
 *
 * 拆不开（没有前导数字、或只有数字没有后缀）就返回 undefined —— 调用方原样输出，
 * 不猜格式、不改文案。
 *
 * @param text - 报错信号原文（宿主口径：`N 处报错`）
 * @returns 数字与后缀；不是这个形状就没有
 */
function splitLeadingCount(text: string): { value: number; rest: string } | undefined {
  const match = /^(\d+)\s*(\S.*)$/u.exec(text)
  if (match === null) return undefined
  const [, digits, rest] = match
  if (digits === undefined || rest === undefined) return undefined
  return { value: Number(digits), rest }
}

/**
 * 主文案：`31 次工具调用`；没有计数时退回调用方给的占位。
 *
 * @param toolCalls - 工具调用次数
 * @param label - 计数拿不到时的占位
 * @returns 折叠行的主文案（永不为空）
 */
function mainTextOf(toolCalls: number | undefined, label: string | undefined): string {
  const callsText = toolCalls === undefined ? '' : countText(toolCalls)
  if (callsText !== '') return `${callsText} 次工具调用`
  return label === undefined || label === '' ? '过程' : label
}

/**
 * 渲染一条过程折叠行。
 *
 * @param props - 计数、报错、展开状态与切换回调
 * @returns 可点行（`onToggle` 存在）或静态行
 */
export function ProcessLine({
  toolCalls,
  label,
  note,
  files,
  running,
  state,
  className,
  expanded = false,
  onToggle,
}: ProcessLineProps) {
  const main = mainTextOf(toolCalls, label)
  const filesText = files === undefined ? '' : countText(files)
  /** 报错信号里的那个数字（`2 处报错` 的 2）单独走滚动；其余文案原样保留。 */
  const noteCount = note === undefined || note === '' ? undefined : splitLeadingCount(note)
  const spoken = [main, note, filesText === '' ? undefined : `改 ${filesText} 个文件`]
    .filter((part): part is string => part !== undefined && part !== '')
    .join('，')

  const content = (
    <>
      {/* 2026-11-10 重设计：折叠行从"一行灰字"改成一条可点的窄条。
          左边一个小状态点（颜色由 data-state 决定，读屏不读：文字已经说了计数），
          右边一个 ▸/▾ —— 箭头在右是"展开"的通用位置，放左会跟列表符号混。 */}
      <span className="palm-proc-dot" data-state={state} aria-hidden="true" />
      {/* chat-proc-* 是过程卡既有样式与诊断钩子（同一个位置的同一行，避免两套皮）：
          计数 / 报错两段共用原有排版，视觉细节仍由 palm-proc-* 收口。 */}
      <span className="chat-proc-line chat-proc-label">
        {/* 计数走翻牌动效（A 版：整字翻，没有牌面）；读屏仍读下面这串完整文案。 */}
        <span className="palm-proc-main chat-proc-state">
          {toolCalls === undefined || countText(toolCalls) === ''
            ? main
            : <><FlipNumber value={toolCalls} />{' 次工具调用'}</>}
        </span>
        {note === undefined || note === '' ? null : (
          <span className="palm-proc-note chat-proc-errors">
            {/* 2026-11-11 用户：报错里的数字也用同款滚动（`2 处报错` → 2 会滚）。 */}
            {noteCount === undefined ? note : <><FlipNumber value={noteCount.value} />{' '}{noteCount.rest}</>}
          </span>
        )}
        {filesText === '' ? null : (
          <span className="palm-proc-files chat-proc-files">
            {'改 '}
            <FlipNumber value={files ?? 0} />
            {' 个文件'}
          </span>
        )}
      </span>

      {onToggle === undefined
        ? null
        : <span className="palm-proc-caret chat-proc-caret" aria-hidden="true">{expanded ? '▾' : '▸'}</span>}

    </>
  )

  const rootClass = className === undefined || className === '' ? 'palm-proc' : `palm-proc ${className}`

  if (onToggle === undefined) {
    return (
      <div className={rootClass} role="status" data-state={state} aria-label={spoken === '' ? undefined : spoken}>
        {content}
      </div>
    )
  }

  return (
    <Button
      type="button"
      className={rootClass}
      data-state={state}
      aria-expanded={expanded}
      aria-label={`${spoken === '' ? main : spoken}，${expanded ? '收起过程' : '展开过程'}`}
      onClick={onToggle}
    >
      {content}
    </Button>
  )
}
