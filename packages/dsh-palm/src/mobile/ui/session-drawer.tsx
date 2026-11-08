/**
 * 会话抽屉（`docs/prototype/single-surface.html` C 图）：工作区身份 + 新建/搜索 +
 * 按今天/昨天/更早分组的会话 + 底部三入口。只吃 props，不碰数据层。
 *
 * 2026-11-08 架构收敛后，抽屉是**唯一导航**：会话列表页、工作区页都删掉了，
 * 换会话 / 新建 / 搜索 / 设置 / 产物 / 用量全从这里进。
 *
 * 行右侧只在三种有据可查的状态下画 132×22 迷你条：等审批（宿主 pending 镜像）、
 * 运行中（宿主运行集合）、完成（刚结束账本）。普通会话保持干净。
 */
import type { SessionView } from '../shared/session-view.ts'
import { ChevronDownIcon, FolderIcon, GaugeIcon, PlusIcon, SearchIcon, SlidersIcon } from '../components/icons.tsx'
import { Button, ListRow } from './primitives.tsx'
import { Overlay } from './overlay.tsx'
import { StatusStrip, type StatusStripKind } from './status-strip.tsx'

/** 一天（毫秒）：今天/昨天分界。 */
const DAY_MS = 86_400_000
/** 分组顺序（空的整组不画）。 */
const BUCKETS = ['今天', '昨天', '更早'] as const

/**
 * 行状态：等审批 > 运行中 > 完成。
 *
 * 「等审批」优先：一个等用户点批准的会话，用户最该看到的不是"它还在跑"。
 */
function statusOf(
  row: SessionView,
  finishedIds: ReadonlySet<string>,
  pendingIds: ReadonlySet<string>,
): { kind: StatusStripKind; label: string } | undefined {
  if (pendingIds.has(row.sessionId)) return { kind: 'approve', label: '等审批' }
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
  /** 等用户批准的会话 id（mux pending 镜像）：画「等审批」mini 条。 */
  pendingIds?: ReadonlySet<string>
  currentSessionId?: string
  /** 「产物与文档」右侧小字：当前会话的产物文件数（拿不到就不画）。 */
  artifactCount?: number
  /** 工作区数量：>1 时身份区画切换箭头（单工作区不画）。 */
  workspaceCount?: number
  onSwitchWorkspace?: (() => void) | undefined
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
  const pending = props.pendingIds ?? new Set<string>()
  const groups = BUCKETS
    .map(title => ({ title, rows: props.rows.filter(row => drawerBucketOf(row.updatedAt, now) === title) }))
    .filter(group => group.rows.length > 0)
  const name = props.workspace.title === '' ? '本机工作区' : props.workspace.title
  const showSwitch = (props.workspaceCount ?? 1) > 1 && props.onSwitchWorkspace !== undefined
  return (
    <Overlay title="会话与工作区" onClose={props.onClose} scrimClassName="palm-drawer-scrim" panelClassName="palm-drawer">
      <div className="palm-drawer-head">
        <span className="palm-drawer-avatar" aria-hidden="true">{name.slice(0, 1)}</span>
        <span className="palm-drawer-ws"><b>{name}</b><small>{props.workspace.path}</small></span>
        {showSwitch ? (
          <Button type="button" className="mobile-iconbtn" aria-label="切换工作区" onClick={props.onSwitchWorkspace}>
            <ChevronDownIcon />
          </Button>
        ) : null}
      </div>
      {/* 文案一律包一层 span：图标固定 16px 之后，折行的唯一来源就是文案本身，
          而 text-overflow 只对外层盒子生效 —— 裸文本节点在 flex 行里是匿名项，
          省略号挂不上去（实机就是「新建会话」被压成两行）。 */}
      <Button type="button" className="palm-drawer-new" onClick={props.onNew}><PlusIcon /><span>新建会话</span></Button>
      <Button type="button" className="palm-drawer-search" onClick={props.onSearch}><SearchIcon /><span>搜索会话和消息</span></Button>
      <div className="palm-drawer-list">
        {groups.map(group => (
          <section className="palm-drawer-group" key={group.title}>
            <h2 className="palm-drawer-bucket">{group.title}</h2>
            <ul className="palm-drawer-rows">
              {group.rows.map((row) => {
                const status = statusOf(row, props.finishedIds, pending)
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
      {/* 底部三入口：左 16px 图标 + 主文案单行 + 右侧小字（小字永不被挤掉）。 */}
      <nav className="palm-drawer-foot" aria-label="抽屉入口">
        <Button type="button" className="palm-drawer-entry" onClick={props.onOpenSettings}><SlidersIcon /><span>设置</span></Button>
        <Button type="button" className="palm-drawer-entry" onClick={props.onOpenArtifacts}>
          <FolderIcon /><span>产物与文档</span>{props.artifactCount === undefined ? null : <small>{props.artifactCount}</small>}
        </Button>
        <Button type="button" className="palm-drawer-entry" onClick={props.onOpenUsage}><GaugeIcon /><span>用量</span><small>本机</small></Button>
      </nav>
    </Overlay>
  )
}
