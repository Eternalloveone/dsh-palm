/**
 * 状态条：任务头那条 28px 胶囊 + 方案 A 刻度轨（新设计方案的第一个组件）。
 *
 * 版式真源（唯一）：
 * - `docs/prototype/pet-strip-v5.html` ①：28px 主条、圆角 10、渐变填充、
 *   18px 内联宠物、11px 白色文字 + 1px 暗阴影、右侧等宽数字；
 * - `docs/prototype/overview.html`「2 · 会话正文」：成品态（`完成 · 7 步` +
 *   7 格刻度轨）；
 * - `docs/screenshots/prototype-overview.png`：同上，肉眼基线。
 *
 * 三条硬规则：
 * 1. **宠物是纯内联 SVG**：禁 emoji、禁图片资源；11 种状态各一张简单表情
 *    （思考=圆眼 / 读=大眼 / 改·跑=眯眼 / 等审批=举牌 / 卡住=闭眼 /
 *    完成=笑+举双手 / 失败=× 眼 / 停止=横眼 / 排队=无表情 / 未知=圆眼）。
 * 2. **进度不写行内样式**：CSP 与 `inlineStyles` 预算都拦行内 style；
 *    这里把 0..1 折成 5% 一档的 `data-fill`，宽度由样式表按档位给。
 *    进度未知时落 `unknown` 档 —— 样式表给「游走块」，`prefers-reduced-motion`
 *    下退回静止块。
 * 3. **触控 ≥44px**：28px 只是视觉高度；给了 `onOpen` 时外层是可点行
 *    （`ListRow`：role=button + 键盘激活），最小高度吃 `--palm-hit`。
 *
 * 迷你版（132×22 / 圆角 8）是同一个组件的 `size='mini'`：抽屉列表行里只留
 * 宠物 + 主文案，去掉副文案、右侧与刻度轨。
 *
 * @module dsh-palm/mobile/ui/status-strip
 */
import type { ReactNode } from 'react'
import { ListRow } from './primitives.tsx'

/** 状态条的 11 种任务状态（状态机 `session/task-status.ts` 产出同一套值）。 */
export type StatusStripKind =
  | 'think'
  | 'read'
  | 'edit'
  | 'test'
  | 'approve'
  | 'stuck'
  | 'unknown'
  | 'done'
  | 'failed'
  | 'stopped'
  | 'queued'

/** 刻度轨的一步计数（`done` 已完成、`total` 总步数）。 */
export interface StatusStripSteps {
  readonly done: number
  readonly total: number
}

/** 状态条的 props。 */
export interface StatusStripProps {
  /** 状态种类：决定渐变与宠物表情。 */
  kind: StatusStripKind
  /** 主文案（如「完成 · 7 步」「读文件」「等你就绪」）。 */
  label: string
  /** 副文案：小灰字（如文件名、命令、`没拆出计划`），可省。 */
  detail?: string
  /** 右侧文字（耗时、`等你 42s`），可省。 */
  right?: string
  /** 0..1 的进度；`undefined` = 不知道（走游走块）。 */
  progress?: number
  /** 有它才画刻度轨；拿不到计划就别传（不要编步数）。 */
  steps?: StatusStripSteps
  /** `main` = 28px 主条（默认）；`mini` = 132×22 抽屉行版本。 */
  size?: 'main' | 'mini'
  /** 有它整条才可点：外层撑到 44px 触控区并带键盘激活。 */
  onOpen?: () => void
}

/** 终态：刻度轨不再有「当前」格。 */
const TERMINAL_KINDS: ReadonlySet<StatusStripKind> = new Set<StatusStripKind>(['done', 'failed', 'stopped'])

/** 一张表情的零件（坐标按 viewBox 0 0 30 30，和原型同一套）。 */
const FACES: Record<StatusStripKind, ReactNode> = {
  // 思考：圆眼。
  think: (
    <>
      <circle data-pet="eye" cx="11.6" cy="15" r="1.9" />
      <circle data-pet="eye" cx="18.4" cy="15" r="1.9" />
    </>
  ),
  // 读：大眼。
  read: (
    <>
      <circle data-pet="eye" cx="11.4" cy="15" r="2.4" />
      <circle data-pet="eye" cx="18.6" cy="15" r="2.4" />
    </>
  ),
  // 改文件：眯眼（两道短弧，留出间距才看得成两只眼）。
  edit: (
    <>
      <path data-pet="line" d="M10.1 15.3 q1.7 -1.9 3.4 0" />
      <path data-pet="line" d="M16.5 15.3 q1.7 -1.9 3.4 0" />
    </>
  ),
  // 跑测试：眯眼（和「改」同一张脸，区别在渐变与文案）。
  test: (
    <>
      <path data-pet="line" d="M10.1 15.3 q1.7 -1.9 3.4 0" />
      <path data-pet="line" d="M16.5 15.3 q1.7 -1.9 3.4 0" />
    </>
  ),
  // 等审批：举牌（头顶一块宽牌子，两只手向两侧举着）。
  approve: (
    <>
      <rect data-pet="line" x="6.2" y="1.2" width="17.6" height="5.4" rx="1.6" />
      <path data-pet="line" d="M8.8 10.6 L7.6 6.6" />
      <path data-pet="line" d="M21.2 10.6 L22.4 6.6" />
      <circle data-pet="eye" cx="11.8" cy="15.4" r="1.8" />
      <circle data-pet="eye" cx="18.2" cy="15.4" r="1.8" />
    </>
  ),
  // 卡住：闭眼（向下垂的弧）。
  stuck: (
    <>
      <path data-pet="line" d="M10.1 15 q1.9 1.9 3.8 0" />
      <path data-pet="line" d="M16.1 15 q1.9 1.9 3.8 0" />
    </>
  ),
  // 未知：圆眼（还没拆出计划，但确实在动）。
  unknown: (
    <>
      <circle data-pet="eye" cx="11.6" cy="15" r="1.9" />
      <circle data-pet="eye" cx="18.4" cy="15" r="1.9" />
    </>
  ),
  // 完成：笑眼 + 举双手 + 一张笑嘴。
  done: (
    <>
      <path data-pet="line" d="M10.1 15.2 q1.7 -2 3.4 0" />
      <path data-pet="line" d="M16.5 15.2 q1.7 -2 3.4 0" />
      <path data-pet="line" d="M4.6 11.4 L2.3 8.4" />
      <path data-pet="line" d="M25.4 11.4 L27.7 8.4" />
      <path data-pet="line" d="M12.4 19.6 q2.6 2.4 5.2 0" />
    </>
  ),
  // 失败：× 眼。
  failed: (
    <>
      <path data-pet="line" d="M10.4 13.4 l2.6 2.6" />
      <path data-pet="line" d="M13 13.4 l-2.6 2.6" />
      <path data-pet="line" d="M17 13.4 l2.6 2.6" />
      <path data-pet="line" d="M19.6 13.4 l-2.6 2.6" />
    </>
  ),
  // 停止：横眼 + 一条平嘴。
  stopped: (
    <>
      <path data-pet="line" d="M10.4 15 h4" />
      <path data-pet="line" d="M15.6 15 h4" />
      <path data-pet="line" d="M12.8 20 h4.4" />
    </>
  ),
  // 排队：无表情（只有身体，什么都不画）。
  queued: null,
}

/** 一只宠物：身体 + 该状态的表情零件。 */
function PetFace({ kind }: { kind: StatusStripKind }) {
  return (
    <svg className="palm-strip-pet" viewBox="0 0 30 30" aria-hidden="true" focusable="false">
      <ellipse data-pet="body" cx="15" cy="17" rx="10" ry="9.2" />
      {FACES[kind]}
    </svg>
  )
}

/**
 * 进度 → `data-fill` 档位。
 *
 * - 已知进度：夹到 0..1，按 5% 取整（`p0`…`p100`）；
 * - 未知进度：终态与排队默认铺满（终态不该一直游走），其余走 `unknown`
 *   → 样式表的游走块。
 *
 * @param progress - 0..1 或 undefined
 * @param kind - 当前状态（决定未知时的落点）
 * @returns `data-fill` 的取值
 */
function fillBucketOf(progress: number | undefined, kind: StatusStripKind): string {
  if (progress === undefined || !Number.isFinite(progress)) {
    return TERMINAL_KINDS.has(kind) || kind === 'queued' ? 'p100' : 'unknown'
  }
  const clamped = Math.min(1, Math.max(0, progress))
  return `p${Math.round(clamped * 20) * 5}`
}

/**
 * 步数 → 刻度轨每一格的状态。
 *
 * 已做 = `done` 格；当前 = 第 `done + 1` 格（仅进行中的状态才有）；
 * 其余 = 未做。终态没有「当前」格 —— 全做完就是全绿，没做完也不再假装在做。
 *
 * @param steps - 步数（可省）
 * @param kind - 当前状态
 * @returns 每格状态（`done` / `now` / `todo`）；拿不到步数时是空数组（整条轨不渲染）
 */
function railCellsOf(steps: StatusStripSteps | undefined, kind: StatusStripKind): Array<'done' | 'now' | 'todo'> {
  if (steps === undefined) return []
  const total = Math.floor(steps.total)
  if (!Number.isFinite(total) || total <= 0) return []
  const done = Math.min(Math.max(0, Math.floor(steps.done)), total)
  const active = !TERMINAL_KINDS.has(kind) && kind !== 'queued'
  return Array.from({ length: total }, (_, index) => {
    if (index < done) return 'done'
    if (active && index === done) return 'now'
    return 'todo'
  })
}

/**
 * 渲染一条状态条。
 *
 * @param props - 状态、文案、进度、步数与尺寸
 * @returns 状态条（含可选刻度轨）；给了 `onOpen` 时外层是可点行
 */
export function StatusStrip({
  kind,
  label,
  detail,
  right,
  progress,
  steps,
  size = 'main',
  onOpen,
}: StatusStripProps) {
  const mini = size === 'mini'
  const fill = fillBucketOf(progress, kind)
  const cells = mini ? [] : railCellsOf(steps, kind)
  // 读屏念一条完整的话：只念画出来的部分（迷你版没有副文案/右侧）。
  const spoken = [label, mini ? undefined : detail, mini ? undefined : right]
    .filter((part): part is string => part !== undefined && part !== '')
    .join('，')

  const strip = (
    <div
      className="palm-strip"
      data-kind={kind}
      data-size={size}
      role="status"
      aria-label={spoken === '' ? undefined : spoken}
    >
      <span className="palm-strip-fill" data-fill={fill} aria-hidden="true" />
      <span className="palm-strip-body">
        <PetFace kind={kind} />
        <span data-part="main">
          <b data-part="label">{label}</b>
          {mini || detail === undefined ? null : <span data-part="detail">{detail}</span>}
        </span>
        {mini || right === undefined ? null : <span data-part="right" data-role="strip-time">{right}</span>}
      </span>
    </div>
  )

  const rail = cells.length === 0 ? null : (
    <div className="palm-strip-rail" aria-hidden="true">
      {cells.map((state, index) => <i key={index} data-state={state} />)}
    </div>
  )

  if (onOpen === undefined) {
    return (
      <div className="palm-strip-wrap" data-size={size}>
        {strip}
        {rail}
      </div>
    )
  }

  return (
    <ListRow className="palm-strip-wrap" onClick={onOpen}>
      {strip}
      {rail}
    </ListRow>
  )
}
