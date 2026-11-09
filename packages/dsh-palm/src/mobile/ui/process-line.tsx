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

/** 过程行的 props。 */
export interface ProcessLineProps {
  /** 真实工具调用次数（`31 次工具调用`）；拿不到就不传。 */
  toolCalls?: number
  /** 计数拿不到时的占位（`—`：没有权威数据，不给结论）。 */
  label?: string
  /** 报错信号（沿用既有口径：`2 处报错`）。 */
  note?: string
  /** 运行中：最近几步的标题（只显示最后 3 条）。 */
  recent?: readonly string[]
  /** 这一轮还在跑（才显示「最近 3 步」）。 */
  running?: boolean
  /** 这一行代表的过程状态（running / ok / stopped / failed），落到 `data-state` 供样式与诊断。 */
  state?: string
  /** 额外的根类名（既有过程组的 `chat-proc-head` 等钩子由调用方挂）。 */
  className?: string
  /** 展开状态（受控；由既有过程组持有）。 */
  expanded?: boolean
  /** 点整行切换展开/收起；不给就是静态行。 */
  onToggle?: () => void
}

/** 「最近 N 步」最多列几条（定版：最近 3 步）。 */
const RECENT_MAX = 3

/** 正整数的千分位文本；0/非有限数返回空串（不占位）。 */
function countText(value: number): string {
  return Number.isFinite(value) && value > 0 ? Math.round(value).toLocaleString('zh-CN') : ''
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
  recent,
  running,
  state,
  className,
  expanded = false,
  onToggle,
}: ProcessLineProps) {
  const main = mainTextOf(toolCalls, label)
  const spoken = [main, note]
    .filter((part): part is string => part !== undefined && part !== '')
    .join('，')
  // 「最近 3 步」：只取最后三条，运行中才出现；标题为空的不占行。
  const recentTitles = running === true
    ? (recent ?? []).filter(title => title.trim() !== '').slice(-RECENT_MAX)
    : []

  const content = (
    <>
      {onToggle === undefined
        ? null
        : <span className="palm-proc-caret chat-proc-caret" aria-hidden="true">{expanded ? '▾' : '▸'}</span>}
      {/* chat-proc-* 是过程卡既有样式与诊断钩子（同一个位置的同一行，避免两套皮）：
          计数 / 报错两段共用原有排版，视觉细节仍由 palm-proc-* 收口。 */}
      <span className="chat-proc-line chat-proc-label">
        <span className="palm-proc-main chat-proc-state">{main}</span>
        {note === undefined || note === '' ? null : <span className="palm-proc-note chat-proc-errors">{note}</span>}
      </span>
      {recentTitles.length === 0 ? null : (
        <span className="palm-proc-recent">最近：{recentTitles.join(' · ')}</span>
      )}
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
