/**
 * 会话抽屉（`docs/prototype/overview.html`「1 · 会话抽屉」）：工作区身份 + 新建/搜索 +
 * 按今天/昨天/更早分组的会话 + 底部三入口。只吃 props，不碰数据层；行右侧只在
 * 「正在跑 / 已完成」时画 mini 状态条，普通会话保持干净。
 *
 * @module dsh-palm/mobile/ui/session-drawer
 */
import type { SessionView } from '../shared/session-view.ts'
import { FolderIcon, GaugeIcon, PlusIcon, SearchIcon, SlidersIcon } from '../components/icons.tsx'
import { Button, ListRow } from './primitives.tsx'
import { Overlay } from './overlay.tsx'
import { StatusStrip, type StatusStripKind } from './status-strip.tsx'

/** 一天（毫秒）：今天/昨天分界。 */
const DAY_MS = 86_400_000
/** 分组顺序（空的整组不画）。 */
const BUCKETS = ['今天', '昨天', '更早'] as const

/** 行状态：只画「正在跑 / 已完成」两种，普通会话返回 undefined。 */
function statusOf(row: SessionView, finishedIds: ReadonlySet<string>): { kind: StatusStripKind; label: string } | undefined {
  if (row.running) return { kind: 'test', label: '运行中' }
  if (finishedIds.has(row.sessionId)) return { kind: 'done', label: '完成' }
  return undefined
}

/**
 * 会话落在哪一桶（按本地午夜切）。
 *
 * @param updatedAt - 会话更新时间（毫秒）
 * @param now - 当前时间（毫秒）
 * @returns 今天 / 昨天 / 更早
 */
export function drawerBucketOf(updatedAt: number, now: number): (typeof BUCKETS)[number] {
  const midnight = new Date(now).setHours(0, 0, 0, 0)
  if (updatedAt >= midnight) return '今天'
  return updatedAt >= midnight - DAY_MS ? '昨天' : '更早'
}

export interface SessionDrawerProps {
  workspace: { title: string; path: string }
  rows: readonly SessionView[]
  /** 刚跑完的会话 id：这些行画「完成」mini 条。 */
  finishedIds: ReadonlySet<string>
  currentSessionId?: string
  /** 「产物与文档」右侧小字：当前会话的产物轮数（拿不到就不画）。 */
  artifactCount?: number
  onClose(): void
  onNew(): void
  onSearch(): void
  onPick(session: SessionView): void
  onOpenSettings(): void
  onOpenArtifacts(): void
  onOpenUsage(): void
}

/**
 * 渲染会话抽屉。
 *
 * @param props - 工作区、会话行与动作
 * @returns 抽屉（Overlay 自带 Esc / 焦点陷阱 / 遮罩关闭）
 */
export function SessionDrawer(props: SessionDrawerProps) {
  const now = Date.now()
  const groups = BUCKETS
    .map(title => ({ title, rows: props.rows.filter(row => drawerBucketOf(row.updatedAt, now) === title) }))
    .filter(group => group.rows.length > 0)
  const name = props.workspace.title === '' ? '本机工作区' : props.workspace.title
  return (
    <Overlay title="会话与工作区" onClose={props.onClose} scrimClassName="palm-drawer-scrim" panelClassName="palm-drawer">
      <div className="palm-drawer-head">
        <span className="palm-drawer-avatar" aria-hidden="true">{name.slice(0, 1)}</span>
        <span className="palm-drawer-ws"><b>{name}</b><small>{props.workspace.path}</small></span>
      </div>
      <Button type="button" className="palm-drawer-new" onClick={props.onNew}><PlusIcon /> 新建会话</Button>
      <Button type="button" className="palm-drawer-search" onClick={props.onSearch}><SearchIcon /> 搜索会话</Button>
      <div className="palm-drawer-list">
        {groups.map(group => (
          <section className="palm-drawer-group" key={group.title}>
            <h2 className="palm-drawer-bucket">{group.title}</h2>
            <ul className="palm-drawer-rows">
              {group.rows.map((row) => {
                const status = statusOf(row, props.finishedIds)
                return (
                  <li key={row.sessionId}>
                    <ListRow
                      className={'palm-drawer-row' + (row.sessionId === props.currentSessionId ? ' palm-drawer-row-current' : '')}
                      onClick={() => { props.onPick(row) }}
                    >
                      <span className="palm-drawer-title">{row.title}</span>
                      {status === undefined ? null : <StatusStrip kind={status.kind} label={status.label} size="mini" />}
                    </ListRow>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
      <nav className="palm-drawer-foot" aria-label="抽屉入口">
        <Button type="button" className="palm-drawer-entry" onClick={props.onOpenSettings}><SlidersIcon /> 设置</Button>
        <Button type="button" className="palm-drawer-entry" onClick={props.onOpenArtifacts}>
          <FolderIcon /> 产物与文档{props.artifactCount === undefined ? null : <small>{props.artifactCount}</small>}
        </Button>
        <Button type="button" className="palm-drawer-entry" onClick={props.onOpenUsage}><GaugeIcon /> 用量<small>本机</small></Button>
      </nav>
    </Overlay>
  )
}
