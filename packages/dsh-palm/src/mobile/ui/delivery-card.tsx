/**
 * 交付卡：一页里**唯一的一张卡**（会话正文流的收尾块）。
 *
 * 版式真源（唯一）：
 * - `docs/prototype/delivery-card.html` A 图：卡头（✓ 交付完成 + 步数；计时只在任务头状态条）→
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
import { hasMeaningfulDelivery, isNoiseArtifact } from './delivery-noise.ts'

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

/**
 * 结论卡的**四态**（P4）：运行中 / 交付完成 / 没做成 / 结局未知。
 *
 * 为什么要有第四态：宿主没给结论字段时（断线、快照缺 turn、老宿主），原来的实现
 * 要么画一张「交付完成」，要么什么都不画 —— 两种都是在替宿主猜。现在未知就写未知，
 * 不猜成功。
 */
export type DeliveryState = 'running' | 'success' | 'failure' | 'unknown'

/** 每态一句标题 + 一个字形（字形只是冗余线索，文案本身要读得出来）。 */
const STATE_FACE: Record<DeliveryState, { title: string; glyph: string }> = {
  running: { title: '进行中', glyph: '◐' },
  success: { title: '交付完成', glyph: '✓' },
  failure: { title: '没做成', glyph: '!' },
  unknown: { title: '结局未知', glyph: '—' },
}

/** 交付卡的 props：全部来自现有回合数据，缺哪项就不画哪项。 */
export interface DeliveryCardProps {
  /**
   * 这一轮的结局（P4 四态）。省略等于 `success`（既有调用方都是"正常收工"）。
   * 失败/中断传 `failure`，拿不到结论传 `unknown`。
   */
  state?: DeliveryState
  /** 计划步数（卡头「交付完成 · 7 步」里的那一半；计时只在任务头状态条）。 */
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
  /** 失败/未知时的一句原因（拿不到就不画）。 */
  reason?: string
  /** 失败态的重试入口（不传就不画按钮）。 */
  onRetry?: () => void
  /** 点文件行打开预览。 */
  onOpenFile?: (path: string) => void
  /** 「看全部改动 ›」：交给既有的全部改动页。 */
  onOpenChanges?: () => void
}

/** 卡面只放两条明细（原型：交付物 1 条 + 改动 2 条；超出走「看全部改动」）。 */
const DETAIL_MAX = 2

/** 计数按千分位分组（`2,923`）。 */
export function countText(value: number): string {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)).toLocaleString('zh-CN') : ''
}

/** 路径最后一段（交付物行显示「文件名」而不是整条路径）。 */
export function baseName(path: string): string {
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
 * 渲染结论/交付卡（四态一骨架）。
 *
 * @param props - 结局状态、步数、交付物、改动、汇总与回调
 * @returns 卡片；`success` 且没有任何产物时为 `null`（不画空壳），其余三态总是画
 */
export function DeliveryCard({
  state = 'success',
  steps,
  deliverables = [],
  changes = [],
  testsPassed,
  commit,
  pushed,
  reason,
  onRetry,
  onOpenFile,
  onOpenChanges,
}: DeliveryCardProps) {
  const face = STATE_FACE[state]
  // 判据（2026-11-13）：噪声产物（日志/缓存/工具脚本）不进明细 —— 一场会话 106 行里
  // 30 张卡就是被这类文件撑出来的（手机一屏只有 589px）。
  const usableDeliverables = deliverables.filter(file => !isNoiseArtifact(file.path))
  const usableChanges = changes.filter(change => !isNoiseArtifact(change.path))
  const declared = new Set(deliverables.map(file => file.path))
  // 卡片明细：交付物去掉已经声明过的路径，再按增删总量从大到小取前 2 条。
  const changed = usableChanges
    .filter(change => !declared.has(change.path))
    .slice()
    .sort((left, right) => weightOf(right) - weightOf(left) || left.path.localeCompare(right.path))
    .slice(0, DETAIL_MAX)
  const shownDeliverables = usableDeliverables.slice(0, DETAIL_MAX)
  // 汇总口径与明细同源：文件数 = 交付物 ∪ 改动；增删只累加拿得到 tally 的那些。
  const files = new Set<string>([...declared, ...usableChanges.map(change => change.path)]).size
  const adds = usableChanges.reduce((sum, change) => sum + (change.adds ?? 0), 0)
  const dels = usableChanges.reduce((sum, change) => sum + (change.dels ?? 0), 0)
  const hasTallyTotals = usableChanges.some(change => hasTally(change))

  // 只有"正常收工且什么都没交回"才不画卡；失败/未知即使没有文件也是这一轮的结论。
  // 判据：成功收尾时，只有**还有真实产出**才出卡（全是日志/缓存/补丁脚本就不画）。
  if (state === 'success' && !hasMeaningfulDelivery([
    ...deliverables.map(file => file.path),
    ...changes.map(change => change.path),
  ])) return null

  // 卡头只报「N 步」：这一轮用了多久只在任务头状态条里说一次（卡面再报一遍就是两只表）。
  const headMeta: string[] = []
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
    <div className="chat-turn-tail palm-delivery" data-state={state}>
      <div className="palm-delivery-head">
        <span className="palm-delivery-check" aria-hidden="true">{face.glyph}</span>
        <span className="palm-delivery-title">{face.title}</span>
        {headMeta.length === 0 ? null : <span className="palm-delivery-meta">{headMeta.join(' · ')}</span>}
        {state !== 'failure' || onRetry === undefined ? null : (
          <Button type="button" className="palm-delivery-more palm-delivery-retry" onClick={onRetry}>
            重试
          </Button>
        )}
      </div>
        {reason === undefined || reason === '' ? null : (
          <p className="palm-delivery-reason">{reason}</p>
        )}
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
          /* 卡只有 288px：显示文件名就够认，完整路径在交付详情页（两行式）看。 */
          baseName(change.path),
          change,
          hasTally(change) && change.dels === 0 && change.adds !== undefined
            ? { text: '新增' }
            : { text: '修改', kind: 'edit' },
          change.path,
        ))}
        {/*
          卡尾一行：左边「N 个文件 +A −D」汇总，右边「看全部改动 ›」。
          2026-11-10 实机：这一块原来先占一行汇总、再占一行文字按钮，按钮还顶到卡片
          最右边（等于用整行宽度强调卡有多宽）。现在合成一行、按钮只占文字宽度。
        */}
        <div className="palm-delivery-foot">
          <span className="palm-delivery-sum">
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
            {commit === undefined ? null : (
              <span className="palm-delivery-commit">提交 {commit}{pushed === true ? ' · 已推送' : ''}</span>
            )}
          </span>
          {onOpenChanges === undefined ? null : (
            <Button type="button" className="palm-delivery-more" onClick={onOpenChanges}>
              看全部改动 ›
            </Button>
          )}
        </div>
    </div>
  )
}
