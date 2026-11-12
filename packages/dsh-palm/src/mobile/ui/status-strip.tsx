/**
 * 状态栏：回合头下面那一行平铺的状态（2026-11-10 重设计第三版）。
 *
 * 用户口径：「做成桌面端 DSH 那种 —— 不要状态条、不要滑动条，只有一个状态栏，平铺显示。」
 * 于是这一版**没有胶囊、没有填充、没有刻度轨**：只有一行
 * `[鲸尾] 深度求索中 · 改 delivery-card.tsx            02:14`
 * 与正文之间靠留白分开；进度只由过程条的点阵表达，不再有第二种。
 *
 * 三条硬规则：
 * 1. ** whale 是纯内联 SVG**：禁 emoji、禁图片资源。11 种状态共用一枚尾鳍，
 *    识别交给底色（运行靛 / 完成绿 / 失败红 / 等待琥珀 / 未知灰）与文案。
 *    当前是手绘简化尾鳍，拿到官方素材只需替换 `WHALE_TAIL`。
 * 2. **平铺、不抢注意力**：没有底色块与描边；一屏里最亮的东西应该是正文。
 * 3. **触控 ≥44px**：行本身只有 22px 视觉高度；给了 `onOpen` 时外层由 `ListRow`
 *    撑到 `--palm-hit`。
 *
 * 迷你版（`size='mini'`，132×22 圆角）保留给抽屉列表行：那里空间小，一块底色
 * 能帮它从整列文字里跳出来。
 *
 * @module dsh-palm/mobile/ui/status-strip
 */
import type { ReactNode } from 'react'
import { ListRow } from './primitives.tsx'

/**
 * 状态栏的 12 种任务状态（状态机 `session/task-status.ts` 产出同一套值）。
 *
 * 2026-11-10 拆出 `idle`：以前「宿主说没在跑」也落到 `unknown`，界面就是一个破折号，
 * 用户看到的是「空闲 = —」。现在两者分开：`idle` = 明确空闲（可以发话），
 * `unknown` = 手里确实没有权威数据（快照没到）。
 */
export type StatusStripKind =
  | 'think'
  | 'read'
  | 'edit'
  | 'test'
  | 'approve'
  | 'stuck'
  | 'idle'
  | 'unknown'
  | 'done'
  | 'failed'
  | 'stopped'
  | 'queued'

/**
 * 步数计数（`done` 已完成 / `total` 总步数）。
 *
 * 2026-11-10 起**只作为数据存在**：状态栏不再画刻度轨（用户要求平铺一行），
 * 进度只由过程条的点阵表达。类型留着是因为状态机（`session/task-status.ts`）
 * 仍要向下传它，去掉会让"这一轮几步"在数据层断掉。
 */
export interface StatusStripSteps {
  readonly done: number
  readonly total: number
}
/** 状态栏的 props。 */
export interface StatusStripProps {
  /** 状态种类：决定鲸尾底色。 */
  kind: StatusStripKind
  /** 主文案（如「深度求索中」「完成 · 7 步」）。 */
  label: string
  /** 副文案：小灰字（如文件名、命令），可省。 */
  detail?: string
  /** 右侧文字（耗时、`等你 42s`），可省。 */
  right?: string
  /** `main` = 平铺一行（默认）；`mini` = 132×22 抽屉行版本。 */
  size?: 'main' | 'mini'
  /** 有它整行才可点：外层撑到 44px 触控区并带键盘激活。 */
  onOpen?: () => void
}

/**
 * 鲸尾的**静止**轮廓（16×16 描边路径），只在两处出现：
 * 浏览器不支持 `mask-mode`，或系统开了「减弱动态效果」。
 *
 * 活的版本是 `/m/running-whale.png` —— v1.7.1 起就是桌面端在放的那张逐帧动画
 * PNG，用 `currentColor` 当底色做 alpha 蒙版染成状态色。手写路径动画到不了这个
 * 质感（v1.7.0 试过整体旋转、拆两片叶子、SMIL 改路径，都还是"两片叶子在转"），
 * 所以这次直接把 1.7.1 的实现搬回来。
 */
const WHALE_REST_PATH =
  'M8.844 13.742C8.967 12.328 8.45 10.4 8.45 9.65C8.45 8.94 8.88 8.43 9.6 8.43C11.285 8.43 12.106 8.281 12.685 8.104C13.71 7.791 14.585 6.768 15.055 5.945C15.137 5.803 14.99 5.641 14.829 5.671C13.829 5.86 12.828 5.376 11.827 4.978C10.659 4.514 9.491 4.707 8.935 4.876C8.805 4.915 8.658 4.819 8.636 4.686C8.468 3.643 7.405 2.615 5.498 2.238C4.54 2.048 3.748 1.574 3.347 1.202C3.252 1.113 3.088 1.125 3.03 1.242C2.628 2.059 2.168 3.82 5.248 6.115C5.82 6.494 6.31 6.785 6.574 7.637C6.72 8.104 6.157 9.168 6.061 9.368C5.157 11.27 5.089 12.19 4.926 13.742'

/**
 * 渲染鲸尾标记。
 *
 * @param props.kind - 决定底色（样式表按 `data-kind` 分派）
 * @returns 内联 SVG（`aria-hidden`：状态含义由主文案与 `aria-label` 承担）
 */
function WhaleMark({ kind }: { kind: StatusStripKind }) {
  return (
    <span className="palm-strip-mark" data-kind={kind} aria-hidden="true">
      <span className="palm-strip-pet" data-mark="whale" data-kind={kind}>
        {/* 动态层：1.7.1 的逐帧 PNG，以 currentColor 蒙版染色（见样式表）。 */}
        <span className="palm-strip-whale-loop" />
        {/* 静止层：不支持蒙版 / 开了减弱动效时唯一可见的一层。 */}
        <svg className="palm-strip-whale-still" viewBox="0 0 16 16" fill="none" focusable="false">
          <path d={WHALE_REST_PATH} stroke="currentColor" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </span>
  )
}

/**
 * 渲染一行状态栏。
 *
 * @param props - 状态、文案与尺寸
 * @returns 一行平铺的状态（`main`）或抽屉里的小胶囊（`mini`）；给了 `onOpen` 时可点
 */
export function StatusStrip({ kind, label, detail, right, size = 'main', onOpen }: StatusStripProps): ReactNode {
  const mini = size === 'mini'
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
      <span className="palm-strip-body">
        <WhaleMark kind={kind} />
        <span data-part="main">
          {label === '' ? null : <b data-part="label">{label}</b>}
          {mini || detail === undefined ? null : <span data-part="detail">{detail}</span>}
        </span>
        {mini || right === undefined ? null : <span data-part="right" data-role="strip-time">{right}</span>}
      </span>
    </div>
  )

  if (onOpen === undefined) {
    return <div className="palm-strip-wrap" data-size={size}>{strip}</div>
  }

  return (
    <ListRow className="palm-strip-wrap" onClick={onOpen}>
      {strip}
    </ListRow>
  )
}
