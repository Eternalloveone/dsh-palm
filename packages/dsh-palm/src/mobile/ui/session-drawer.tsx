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
import { ChevronDownIcon, ChevronRightIcon, GaugeIcon, RowsIcon, SearchIcon, SlidersIcon } from '../components/icons.tsx'
import { Button, ListRow } from './primitives.tsx'
import { SKIN_LABEL, getSkin } from '../platform/skin.ts'
import { Overlay } from './overlay.tsx'
import { StatusStrip, type StatusStripKind } from './status-strip.tsx'
import { drawerWhenLabel } from './drawer-when.ts'
import { useLongPress } from './use-long-press.ts'

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
  /** 用户主动置顶的会话 id：这些行排在分组最前，标题前带一枚图钉。 */
  pinnedSessions?: ReadonlySet<string>
  /** 长按一行切换它的置顶状态（未传则长按无效）。 */
  onTogglePin?: ((sessionId: string) => void) | undefined
  currentSessionId?: string
  /** 工作区数量：>1 时身份区画切换箭头（单工作区不画）。 */
  workspaceCount?: number
  onSwitchWorkspace?: (() => void) | undefined
  onClose(): void
  onNew(): void
  onSearch(): void
  onPick(session: SessionView): void
  /** 进行中 + 刚完成的条数：>0 才画「任务」入口。 */
  taskCount?: number
  onOpenTasks?: (() => void) | undefined
  onOpenSettings(): void
  onOpenUsage(): void
  /** 正在播退出动画：遮罩与面板一起往左滑，播完由 App 卸载（约 240ms）。 */
  closing?: boolean
}

/**
 * 渲染会话抽屉。
 *
 * @param props - 工作区、会话行与动作
 * @returns 抽屉（Overlay 自带 Esc / 焦点陷阱 / 遮罩关闭）
 */
/**
 * 一条可「长按置顶」的抽屉行。
 *
 * 抽成组件而不是内联在 `map` 里的原因：`useLongPress` 是 hook，不能按行调用。
 * 长按切换置顶而不是「点击右侧图标」，是因为右侧已经被「什么时候」占了 ——
 * 再塞一个按钮会把标题挤到更窄（360px 上标题折行是真机问过的问题）。
 */
function PinnableRow({
  sessionId,
  current,
  pinned,
  onPick,
  onTogglePin,
  children,
}: {
  sessionId: string
  current: boolean
  pinned: boolean
  onPick(): void
  onTogglePin: ((sessionId: string) => void) | undefined
  children: React.ReactNode
}): React.ReactElement {
  const handlers = useLongPress(
    onTogglePin === undefined ? undefined : () => { onTogglePin(sessionId) },
  )
  const pinProps = onTogglePin === undefined
    ? {}
    : {
      onPointerDown: handlers.onPointerDown,
      onPointerMove: handlers.onPointerMove,
      onPointerUp: handlers.onPointerUp,
      onPointerLeave: handlers.onPointerLeave,
      onPointerCancel: handlers.onPointerCancel,
      onClickCapture: handlers.onClickCapture,
    }
  return (
    <li {...pinProps}>
      <ListRow
        className={`palm-drawer-row${current ? ' palm-drawer-row-current' : ''}${pinned ? ' palm-drawer-row-pinned' : ''}`}
        onClick={onPick}
      >
        {pinned ? <PinGlyph /> : null}
        {children}
      </ListRow>
    </li>
  )
}

/** 置顶图钉。12px 线性，与抽屉里其它图标同一套笔画。 */
function PinGlyph(): React.ReactElement {
  return (
    <svg className="palm-drawer-pin" width="12" height="12" viewBox="0 0 16 16" aria-label="已置顶" role="img">
      <path
        d="M6 1.5h4l-.6 3.2 2.1 2.1-1 1-2.1-2.1H7.6L5.5 7.8l-1-1 2.1-2.1L6 1.5Zm2 7.2v5.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function SessionDrawer(props: SessionDrawerProps) {
  const now = Date.now()
  const pending = props.pendingIds ?? new Set<string>()
  /*
   * 置顶的行单独成组放最前（2026-11-12）。
   *
   * 只把置顶项排到数组最前是**不够的** —— 抽屉下面又按 `drawerBucketOf` 分「今天/昨天/
   * 更早」三组重画，置顶那条照样落回它原来的时间组里（真机实测：图钉出来了、
   * localStorage 也写了，但那一行还在原位）。所以这里先把它抽出来，
   * 原时间组里要排除掉，否则同一行会出现两次。
   */
  const pinnedIds = props.pinnedSessions ?? new Set<string>()
  const pinnedRows = props.rows.filter(row => pinnedIds.has(row.sessionId))
  const restRows = props.rows.filter(row => !pinnedIds.has(row.sessionId))
  const groups = [
    ...(pinnedRows.length === 0 ? [] : [{ title: '置顶', rows: pinnedRows }]),
    ...BUCKETS
      .map(title => ({ title, rows: restRows.filter(row => drawerBucketOf(row.updatedAt, now) === title) }))
      .filter(group => group.rows.length > 0),
  ]
  /**
   * 工作区名。
   *
   * 名字由 `session/workspace-directory.ts` 的 `resolveWorkspace` 统一解析后传进来
   * （2026-11-12 用户：「怎么有时候显示本机工作区」→「这是补丁吗，要系统解决」）。
   * 抽屉这里不再自己按路径猜 —— 以前每处各猜一次，三处三种结果。空串只是最后一道防线。
   */
  const name = props.workspace.title !== '' ? props.workspace.title : '工作区'
  const showSwitch = (props.workspaceCount ?? 1) > 1 && props.onSwitchWorkspace !== undefined
  return (
    <Overlay
      title="会话与工作区"
      onClose={props.onClose}
      scrimClassName={'palm-drawer-scrim' + (props.closing === true ? ' is-closing' : '')}
      panelClassName={'palm-drawer' + (props.closing === true ? ' is-closing' : '')}
    >
      <div className="palm-drawer-head">
        {showSwitch ? (
          /*
           * 整块可点：头像 + 工作区名 + 路径 + 右侧「切换 ⌄」。
           * 2026-11-11 用户：「切换工作区是纯图标，看不出是在这切」—— 原来只有一枚
           * 16px 的箭头能点，左边写着工作区名的那块反倒点不动，两个信号都是错的。
           */
          <Button
            type="button"
            className="palm-drawer-ws-btn"
            aria-label="切换工作区"
            onClick={props.onSwitchWorkspace}
          >
            <span className="palm-drawer-avatar" aria-hidden="true">{name.slice(0, 1)}</span>
            <span className="palm-drawer-ws"><b>{name}</b><small>{props.workspace.path}</small></span>
            <span className="palm-drawer-ws-switch">切换<ChevronDownIcon /></span>
          </Button>
        ) : (
          <>
            <span className="palm-drawer-avatar" aria-hidden="true">{name.slice(0, 1)}</span>
            <span className="palm-drawer-ws"><b>{name}</b><small>{props.workspace.path}</small></span>
          </>
        )}
      </div>
      {/* 文案一律包一层 span：图标固定 16px 之后，折行的唯一来源就是文案本身，
          而 text-overflow 只对外层盒子生效 —— 裸文本节点在 flex 行里是匿名项，
          省略号挂不上去（实机就是「新建会话」被压成两行）。 */}
      <Button type="button" className="palm-drawer-new" onClick={props.onNew}><span>新建会话</span></Button>
      <Button type="button" className="palm-drawer-search" onClick={props.onSearch}><SearchIcon /><span>搜索会话和消息</span></Button>
      <div className="palm-drawer-list">
        {groups.length === 0 ? (
          /* 空列表要说清楚"是真的没有"，而不是留一块空白让人以为界面坏了
             （2026-11-10「会话列表显示失效」的观感就是从这里来的）。 */
          <p className="palm-drawer-empty">这个工作区还没有会话</p>
        ) : null}
        {groups.map(group => (
          <section className="palm-drawer-group" key={group.title}>
            <h2 className="palm-drawer-bucket">
              {group.title}
              {/* 条数只做视觉补充；读屏仍读「今天」这一句（aria-hidden）。 */}
              <span className="palm-drawer-bucket-count" aria-hidden="true">{group.rows.length}</span>
            </h2>
            <ul className="palm-drawer-rows">
              {group.rows.map((row) => {
                const status = statusOf(row, props.finishedIds, pending)
                const when = drawerWhenLabel(row.updatedAt, now)
                return (
                  <PinnableRow
                    key={row.sessionId}
                    sessionId={row.sessionId}
                    current={row.sessionId === props.currentSessionId}
                    pinned={props.pinnedSessions?.has(row.sessionId) === true}
                    onPick={() => { props.onPick(row) }}
                    onTogglePin={props.onTogglePin}
                  >
                    <span className="palm-drawer-title">{row.title}</span>
                    {status === undefined ? null : <StatusStrip kind={status.kind} label={status.label} size="mini" />}
                    {/* 右侧那句「什么时候」：2026-11-11 用户「侧边栏的右边有点空」。 */}
                    {when === '' ? null : <small className="palm-drawer-when">{when}</small>}
                  </PinnableRow>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
      {/* 底部入口（2026-11-11 C 版）：一块带底色的圆角卡片：小标题「工具」+
          两行 46px（图标 / 文案 / 右侧补充 / 箭头），与上面的列表明确分层。
          「产物与文档」已从这里删掉（同日用户要求）：右上角「⋯ → 这一轮的产物」就是
          同一个入口，而且那里带「N 个文件」，比抽屉里再放一条更近。 */}
      <div className="palm-drawer-foot" aria-label="抽屉入口">
        <div className="palm-drawer-tools">
          {/*
           * 顺序：任务 → 用量 → 设置（2026-11-12 用户：「设置和用量要不要调换」）。
           *
           * 理由：任务是"有什么在跑"，用量是"还剩多少钱"，两者都是**看一眼就走的信息**；
           * 设置是**改东西**，而且是三个里最不常点、改完很久不回来的那种。
           * 信息类聚在上面、配置沉到最底下，也是大部分 App 的通用心智（设置永远在最后一行）。
           * 任务行只在有任务时才画（2026-11-11 决定），所以不会白占位置。
           */}
          {(props.taskCount ?? 0) > 0 && props.onOpenTasks !== undefined ? (
            <Button type="button" className="palm-drawer-tool" onClick={props.onOpenTasks}>
              <RowsIcon /><span>任务</span><small>{props.taskCount} 条</small><ChevronRightIcon />
            </Button>
          ) : null}
          <Button type="button" className="palm-drawer-tool" onClick={props.onOpenUsage}>
            {/* 2026-11-12 用户：「用量」底下显示「本机」是什么意思？
                它原来是写死的两个字，本意是"这台机器上配的提供方用量"，但用量页里的数字
                其实是宿主去各家查回来的余额，标「本机」容易被读成"手机自己的用量"。
                换成「余额」—— 页面里每一行就是某家的账户余额/累计已花，对得上。 */}
            <GaugeIcon /><span>用量</span><small>余额</small><ChevronRightIcon />
          </Button>
          <Button type="button" className="palm-drawer-tool" onClick={props.onOpenSettings}>
            <SlidersIcon /><span>设置</span><small>{SKIN_LABEL[getSkin()]}</small><ChevronRightIcon />
          </Button>
        </div>
      </div>
    </Overlay>
  )
}
