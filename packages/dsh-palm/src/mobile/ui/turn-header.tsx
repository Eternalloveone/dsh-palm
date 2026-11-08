/**
 * 回合任务头：一个回合的四行摘要（会话正文流的第一块）。
 *
 * 版式真源（唯一）：
 * - `docs/prototype/overview.html`「2 · 会话正文」：
 *   `● 已完成 · 7 步 / 7 步        12.4s` → 目标一行（15px/600）→ 32px 状态条；
 * - `docs/screenshots/prototype-overview.png`：同上，肉眼基线；
 * - `docs/prototype/delivery-card.html` A 图：`.trow` / `.goal` / `.bmeta`。
 *
 * 四行固定顺序：
 * 1. **状态行**：状态点 + 状态词 + 步数（`7 步 / 7 步`）+ 右侧耗时；
 * 2. **目标**：这一轮要什么（15px/600，最多两行的高度由文本自己撑）；
 * 3. **状态条**：{@link StatusStrip}（种类/进度/步数都来自 `session/task-status.ts`）；
 * 4. **元信息**：`改 N 个文件 · N 测试通过 · 模型`（10.5px 弱化，拿不到的那项不出现）。
 *
 * 三条硬规则：
 * - **不造数据**：所有字段都是可选的，拿不到就不画那一行/那一段；
 * - **不写行内样式**：颜色/字号全走 `--palm-flow-*` 与 `--palm-*` 令牌；
 * - **触控 ≥44px**：状态条给了 `onOpen` 时由 `StatusStrip` 自己撑到 `--palm-hit`。
 *
 * @module dsh-palm/mobile/ui/turn-header
 */
import { Skeleton } from './primitives.tsx'
import { StatusStrip, type StatusStripKind, type StatusStripSteps } from './status-strip.tsx'

/** 任务头的 props：全部取自现有回合数据，缺哪项就不画哪项。 */
export interface TurnHeaderProps {
  /** 回合状态（`session/task-status.ts` 产出的同一套词表）。 */
  kind: StatusStripKind
  /** 状态词覆盖（默认按 `kind` 取「已完成 / 失败 / 思考中…」）。 */
  state?: string
  /** 计划步数：给了就在状态行报 `N 步 / M 步`，也传给状态条画刻度轨。 */
  steps?: StatusStripSteps
  /** 0..1 进度（交给状态条；不给就走未知档）。 */
  progress?: number
  /** 这一轮用了多久（毫秒）。运行中传实时值，收工后传 `durationMs`。 */
  durationMs?: number
  /** 目标一行：这一轮的用户请求 / 会话目标；没有就不画。 */
  goal?: string
  /** 元信息：这一轮改了几个文件。 */
  changedFiles?: number
  /** 元信息：多少条测试通过。 */
  testsPassed?: number
  /** 元信息：模型名。 */
  model?: string
  /** 点状态条打开运行详情（给了才可点）。 */
  onOpen?: () => void
}

/** 状态行用的完整状态词。 */
const STATE_WORD: Record<StatusStripKind, string> = {
  think: '思考中',
  read: '读文件',
  edit: '改文件',
  test: '跑测试',
  approve: '等你决定',
  stuck: '可能卡住了',
  // 没有权威数据：不写状态词（灰点 + 破折号），不猜「进行中」也不猜「已完成」。
  unknown: '—',
  done: '已完成',
  failed: '失败',
  stopped: '已中断',
  queued: '排队中',
}

/** 状态条用的短状态词（`完成 · 7 步`，与定版图同一个口径）。 */
const STRIP_WORD: Record<StatusStripKind, string> = {
  ...STATE_WORD,
  think: '思考',
  edit: '改文件',
  done: '完成',
}

/**
 * 耗时 → 定版图口径的秒数（一分钟内 `12.4s`；更长走 `6分24秒`，与手机端既有口径一致）。
 *
 * @param ms - 毫秒
 * @returns `12.4s` / `6分24秒` 这样的短文本
 */
export function formatSeconds(ms: number): string {
  const seconds = Math.max(0, ms) / 1000
  if (seconds < 60) {
    const rounded = Math.round(seconds * 10) / 10
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}s`
  }
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}分${rest}秒`
}

/** 计数按千分位分组（`2,923`），与定版图一致；非有限数直接空串。 */
function countText(value: number): string {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)).toLocaleString('zh-CN') : ''
}

/**
 * 渲染一个回合的任务头。
 *
 * @param props - 状态、目标、步数、耗时与元信息
 * @returns 任务头（四行里只画拿得到的那几行）
 */
export function TurnHeader({
  kind,
  state,
  steps,
  progress,
  durationMs,
  goal,
  changedFiles,
  testsPassed,
  model,
  onOpen,
}: TurnHeaderProps) {
  const known = kind !== 'unknown'
  const word = state ?? STATE_WORD[kind]
  // 无权威数据时耗时不画（还没开始的回合报「12.4s」就是编数字），步数也不报。
  const time = !known || durationMs === undefined || !Number.isFinite(durationMs)
    ? ''
    : formatSeconds(durationMs)
  const stepsText = !known || steps === undefined ? '' : `· ${Math.max(0, Math.round(steps.done))} 步 / ${Math.max(0, Math.round(steps.total))} 步`
  const stripLabel = !known || steps === undefined ? STRIP_WORD[kind] : `${STRIP_WORD[kind]} · ${Math.max(0, Math.round(steps.done))} 步`

  const meta: string[] = []
  if (changedFiles !== undefined && changedFiles > 0) meta.push(`改 ${countText(changedFiles)} 个文件`)
  if (testsPassed !== undefined && testsPassed > 0) meta.push(`${countText(testsPassed)} 测试通过`)
  if (model !== undefined && model !== '') meta.push(model)

  return (
    <div className="palm-turn-head" data-kind={kind}>
      <div className="palm-turn-top">
        <span className="palm-turn-dot" aria-hidden="true" />
        <span className="palm-turn-state">{word}</span>
        {stepsText === '' ? null : <span className="palm-turn-steps">{stepsText}</span>}
        {time === '' ? null : <span className="palm-turn-time">{time}</span>}
      </div>
      {goal === undefined || goal.trim() === '' ? null : <p className="palm-turn-goal">{goal}</p>}
      <StatusStrip
        kind={kind}
        label={stripLabel}
        {...(progress === undefined || !known ? {} : { progress })}
        {...(!known || steps === undefined ? {} : { steps })}
        {...(time === '' ? {} : { right: time })}
        {...(onOpen === undefined ? {} : { onOpen })}
      />
      {meta.length === 0 ? null : <div className="palm-turn-meta">{meta.join(' · ')}</div>}
    </div>
  )
}

/**
 * 未水合时的首块占位（替代旧的「加载中…」文案）：复用任务头同一套类名与子元素
 * 顺序，高度由构造保证相同，真实内容落地时不会跳一下。
 */
export function TurnHeadSkeleton() {
  return (
    <div className="palm-turn-head" data-kind="unknown" data-skeleton aria-busy="true" aria-label="正在读取会话">
      <div className="palm-turn-top">
        <span className="palm-turn-dot" aria-hidden="true" />
        <span className="palm-turn-state">—</span>
      </div>
      <Skeleton lines={2} />
      <StatusStrip kind="unknown" label="—" />
    </div>
  )
}
