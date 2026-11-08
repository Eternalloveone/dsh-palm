/**
 * 交付卡：一页里**唯一的一张卡**（会话正文流的收尾块）。
 *
 * 版式真源（唯一）：
 * - `docs/prototype/delivery-card.html` A 图：卡头（✓ 交付完成 + 耗时·步数）→
 *   交付物行 → 改动行（+N −D +「修改」标签）→ 汇总行 → 卡尾（提交 · 已推送 + 看全部改动）；
 * - `docs/prototype/overview.html`「2 · 会话正文」：卡上只留 2 行明细；
 * - `docs/screenshots/prototype-delivery.png`：肉眼基线。
 *
 * 三条产品约束：
 * 1. **只在回合正常完成且真有产物/改动时出现**：`completed === false`（失败/中断）
 *    或一件东西都没交回时返回 `null` —— 终态由状态条表达，不再叠一张空壳卡。
 * 2. **明细只给两条**：全量清单属于「看全部改动」那一页；卡上按增删总量取前 2 个。
 * 3. **数字都能对上**：行内的 `+A −D` 与汇总行的 `+A −D` 共用同一份 tally；
 *    测试数、提交号拿不到就不画（绝不补 0 或占位）。
 *
 * @module dsh-palm/mobile/ui/delivery-card
 */
import type { ReactElement } from 'react'
import { Button } from './primitives.tsx'
import { formatSeconds } from './turn-header.tsx'

/** 一条改动：路径 + 可选增删行数（拿不到行数时行内不显示 tally）。 */
export interface DeliveryFileChange {
  readonly path: string
  readonly adds?: number
  readonly dels?: number
}

/** 卡里的交付物行（`present` 声明的文件）。 */
export interface DeliveryDeliverable {
  readonly path: string
  readonly description?: string
}

/** 交付卡的 props：全部来自现有回合数据，缺哪项就不画哪项。 */
export interface DeliveryCardProps {
  /** 回合是否正常收工：失败/中断传 false（整张卡不渲染）。 */
  completed: boolean
  /** 这一轮用了多久（毫秒）。 */
  durationMs?: number
  /** 计划步数（卡头 `12.4s · 7 步` 里的那一半）。 */
  steps?: number
  /** 交付物（`present` 声明），按出现顺序；卡上最多列 2 条。 */
  deliverables?: readonly DeliveryDeliverable[]
  /** 本轮改动/产出的文件；带增删行数的排前面（取前 2 条上卡）。 */
  changes?: readonly DeliveryFileChange[]
  /** 通过的测试条数；拿不到就不画。 */
  testsPassed?: number
  /** 提交短 hash；拿不到就不画卡尾。 */
  commit?: string
  /** 已推送（只与 `commit` 一起出现）。 */
  pushed?: boolean
  /** 点文件行打开预览。 */
  onOpenFile?: (path: string) => void
  /** 「看全部改动 ›」：交给既有的全部改动页。 */
  onOpenChanges?: () => void
}

/** 卡面只放两条明细（原型：交付物 1 条 + 改动 2 条；超出走「看全部改动」）。 */
const DETAIL_MAX = 2

/** 计数按千分位分组（`2,923`）。 */
function countText(value: number): string {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)).toLocaleString('zh-CN') : ''
}

/** 路径最后一段（交付物行显示「文件名」而不是整条路径）。 */
function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

/** 这条改动有没有可显示的增删行数。 */
function hasTally(change: DeliveryFileChange): boolean {
  return change.adds !== undefined || change.dels !== undefined
}

/** 增删总量（排序用）。 */
function weightOf(change: DeliveryFileChange): number {
  return (change.adds ?? 0) + (change.dels ?? 0)
}

/**
 * 渲染交付卡。
 *
 * @param props - 完成状态、耗时步数、交付物、改动、汇总与回调
 * @returns 卡片；失败/中断或没有任何产物时为 `null`
 */
export function DeliveryCard({
  completed,
  durationMs,
  steps,
  deliverables = [],
  changes = [],
  testsPassed,
  commit,
  pushed,
  onOpenFile,
  onOpenChanges,
}: DeliveryCardProps) {
  // 失败/中断不画卡：状态条的终态就是结论，再挂一张「交付完成」会自相矛盾。
  if (!completed) return null

  const declared = new Set(deliverables.map(file => file.path))
  // 卡片明细：交付物去掉已经声明过的路径，再按增删总量从大到小取前 2 条。
  const changed = changes
    .filter(change => !declared.has(change.path))
    .slice()
    .sort((left, right) => weightOf(right) - weightOf(left) || left.path.localeCompare(right.path))
    .slice(0, DETAIL_MAX)
  const shownDeliverables = deliverables.slice(0, DETAIL_MAX)
  // 汇总口径与明细同源：文件数 = 交付物 ∪ 改动；增删只累加拿得到 tally 的那些。
  const files = new Set<string>([...declared, ...changes.map(change => change.path)]).size
  const adds = changes.reduce((sum, change) => sum + (change.adds ?? 0), 0)
  const dels = changes.reduce((sum, change) => sum + (change.dels ?? 0), 0)
  const hasTallyTotals = changes.some(change => hasTally(change))

  if (files === 0 && shownDeliverables.length === 0 && changed.length === 0) return null

  const headMeta: string[] = []
  if (durationMs !== undefined && Number.isFinite(durationMs)) headMeta.push(formatSeconds(durationMs))
  if (steps !== undefined && steps > 0) headMeta.push(`${Math.round(steps)} 步`)

  const row = (
    key: string,
    icon: string,
    name: string,
    tally: DeliveryFileChange | undefined,
    tag: { text: string; kind?: 'add' | 'edit' },
    path: string,
    title?: string,
  ): ReactElement => {
    const body = (
      <>
        <span className="palm-delivery-icon" aria-hidden="true">{icon}</span>
        <span className="palm-delivery-name">{name}</span>
        {tally === undefined || !hasTally(tally) ? null : (
          <span className="palm-delivery-tally">
            {tally.adds === undefined ? null : <span className="palm-delivery-add">+{countText(tally.adds)}</span>}
            {tally.dels === undefined ? null : <> <span className="palm-delivery-del">−{countText(tally.dels)}</span></>}
          </span>
        )}
        <span className="palm-delivery-tag" data-kind={tag.kind ?? 'add'}>{tag.text}</span>
      </>
    )
    if (onOpenFile === undefined) {
      return <div className="palm-delivery-row" key={key} title={title ?? path}>{body}</div>
    }
    return (
      <Button
        type="button"
        key={key}
        className="palm-delivery-row"
        title={title ?? path}
        aria-label={`打开 ${title ?? path}`}
        onClick={() => { onOpenFile(path) }}
      >
        {body}
      </Button>
    )
  }

  return (
    // chat-turn-tail 是历史钩子（卡片诊断探针 + 既有行身份）：卡面由 palm-delivery-* 重画。
    <div className="chat-turn-tail palm-delivery">
      <div className="palm-delivery-head">
        <span className="palm-delivery-check" aria-hidden="true">✓</span>
        <span className="palm-delivery-title">交付完成</span>
        {headMeta.length === 0 ? null : <span className="palm-delivery-meta">{headMeta.join(' · ')}</span>}
      </div>
      {shownDeliverables.map(file => row(
        `deliver:${file.path}`,
        '▤',
        file.description ?? baseName(file.path),
        undefined,
        { text: '交付物' },
        file.path,
        file.description === undefined ? file.path : `${file.description} · ${file.path}`,
      ))}
      {changed.map(change => row(
        `change:${change.path}`,
        '✎',
        change.path,
        change,
        hasTally(change) && change.dels === 0 && change.adds !== undefined
          ? { text: '新增' }
          : { text: '修改', kind: 'edit' },
        change.path,
      ))}
      <div className="palm-delivery-sum">
        <span className="palm-delivery-count"><b>{countText(files)}</b> 个文件</span>
        {hasTallyTotals ? (
          <span className="palm-delivery-count">
            <b className="palm-delivery-add">+{countText(adds)}</b>
            {' '}
            <b className="palm-delivery-del">−{countText(dels)}</b>
          </span>
        ) : null}
        {testsPassed === undefined || testsPassed <= 0 ? null : (
          <span className="palm-delivery-count"><b>{countText(testsPassed)}</b> 测试通过</span>
        )}
      </div>
      {commit === undefined && onOpenChanges === undefined ? null : (
        <div className="palm-delivery-foot">
          {commit === undefined ? <span /> : <span>提交 {commit}{pushed === true ? ' · 已推送' : ''}</span>}
          {onOpenChanges === undefined ? null : (
            <Button type="button" className="palm-delivery-more" onClick={onOpenChanges}>
              看全部改动 ›
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
