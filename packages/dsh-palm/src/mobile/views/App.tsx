/**
 * Mobile surface root: the view state machine (workspaces → sessions →
 * chat) and the top-level data flows. Deliberately plain React state — no
 * router, no state library: the surface is three fixed levels with a back
 * affordance, and every piece of data is fetched on demand.
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { WorkspaceView as WorkspaceRow } from '../../api-proxy-types'
import type { MuxFrame } from '../../api-proxy-types'
import { logTail, reportError } from '../data/diag.ts'
import { archiveSession, createSession, listSessions, observeSession, prompt, renameSession, runningSessions, sendCommand } from '../data/session.ts'
import { fetchMobilePreferences, readSettings } from '../data/settings.ts'
import { listWorkspaces } from '../data/workspace.ts'
import { fetchFinishedRuns } from '../data/usage.ts'
import { handleAppFrame } from '../kernels/app-frame-slice.ts'
import { canGoBack, createPageStack, currentOf, popPage, pushPage } from '../kernels/page-stack.ts'
import { transitionOf, TRANSITION_MS } from '../kernels/transition.ts'
import { createHostBridge } from '../kernels/host-bridge.ts'
import type { HostBridge } from '../kernels/host-bridge.ts'
import { MuxClient } from '../stream/mux.ts'
import { startNotify, stopNotify } from '../platform/notify.ts'
import { usePageVisible } from '../stream/foreground.ts'
import { RpcTransportError } from '../platform/rpc.ts'
import { runPairingTeardown } from '../platform/teardown.ts'
import { installErrorCapture } from '../platform/errors.ts'
import { watchBuildRefresh } from '../platform/build-refresh.ts'
import { installErrorReporter } from '../platform/errors-report.ts'
import { installPerfWindowHook, startPerfSampler } from '../platform/perf.ts'
import { toSessionView, type SessionView } from '../shared/session-view.ts'
import { errorText } from '../shared/error-text.ts'
import { ToastHost, toast } from '../components/toast.tsx'
// 聊天页仍是独立 chunk（首包少 ~124KB），首屏后 idle 预取；设置等次级页同步 import：
// 单一会话页之后它们总量很小，点进去必须同步可渲染（正常路径不经过骨架）。
const loadChatView = async (): Promise<{ default: typeof import('./ChatView.tsx')['ChatView'] }> => ({
  default: (await import('./ChatView.tsx')).ChatView,
})
const { View: ChatView, warm: warmChatView } = createLazyView(loadChatView)
/**
 * 聊天页的渲染边界。
 *
 * 抽屉开关、运行状态轮询、finished-elsewhere 卡这类 App 级状态，都不该让 4000 行的
 * 聊天页重跑一遍。前提是传给它的 props 引用稳定 —— 见下面 `chatCallbacks`。
 */
const ChatViewMemo = memo(ChatView)
import { durationFromPage, summaryFromPage } from '../session/run-detail.ts'
import { recordFinishedRun, finishedRuns, shortSessionId, type FinishedRun } from '../session/recent-finished.ts'
import { PairRequiredView } from '../components/PairRequiredView.tsx'
import { hasAnyChatCache } from '../session/chat-cache.ts'
import { loadChatCache } from '../session/chat-cache.ts'
import { dropSessionFromCaches, isArchivedSessionId, loadPersistedList, queuePersistedList } from '../session/list-persist.ts'

/** 已经为哪个工作区预取过会话页（模块级：跨页面切换只拉一次）。 */
const PREFETCHED_WORKSPACES = new Set<string>()
import { createLazyView, prefetchOnIdle } from '../lazy-view.tsx'
import { markSessionStale, refreshPage } from '../page-cache.ts'
import { SessionDrawer } from '../ui/session-drawer.tsx'
import { AppearanceSheet } from './settings/AppearanceSheet.tsx'
import { applyRunningState, finishedIdSet, mergeDrawerRows, orderDrawerRows, paintDrawerRows, promoteRunning, sameDrawerRows, sameIdSet, scopedToWorkspace, taskLabelOf } from './drawer-rows.ts'
import { loadPinnedSessions, loadPinnedWorkspaces, togglePinnedSession, togglePinnedWorkspace } from '../session/pins.ts'
import { Button } from '../ui/primitives.tsx'
import { WorkspacePicker } from './chat/components/workspace-picker.tsx'
import { useWorkspaceActions } from './chat/hooks/use-workspace-actions.ts'
import { useSessionPrefetch } from './chat/hooks/use-session-prefetch.ts'
import { ApprovalRoute } from './approval-route.tsx'
import type { ChatViewProps } from './ChatView.tsx'
import { DiffView } from './DiffView.tsx'
import { FilePreviewSheet } from '../components/file-preview-sheet.tsx'
import { rememberLocateIntent } from '../session/locate-intent.ts'
import { AppearanceView } from './AppearanceView.tsx'
import { OutlineView } from './OutlineView.tsx'
import { ArtifactsView } from './ArtifactsView.tsx'
import { ArtifactSummaryView } from './ArtifactSummaryView.tsx'
import { DeliveryDetailView } from './DeliveryDetailView.tsx'
import { ContextView } from './ContextView.tsx'
import { ApprovalModeView } from './ApprovalModeView.tsx'
import { SearchView, type SearchHit } from './SearchView.tsx'
import { SettingsView } from './SettingsView.tsx'
import { UsageView } from './UsageView.tsx'
import { SubagentView } from './SubagentView.tsx'
import type { SubagentFlatNode } from '../session/subagent-tree.ts'
import { TasksView } from './TasksView.tsx'
import { searchPageFor } from './search-request.ts'
import type { ArtifactTurn as ArtifactTurnPayload } from '../session/artifacts.ts'
import type { TurnEntry as TurnOutlineEntry } from '../session/turn-outline.ts'
import type { TurnDeliveryFacts } from '../render/message-row.tsx'
import { resolveWorkspace, workspaceIdForCwd } from '../session/workspace-directory.ts'
import { useUsageChip } from './use-usage-chip.ts'

/** One navigation level. */
/**
 * 移动端路由：**会话页是唯一的根**（2026-11-08「单一会话页 + 抽屉」）。
 *
 * 没有工作区页、没有会话列表页：换会话/新建/搜索/设置全部走抽屉。
 * 其余 kind 都是会话上叠的子页，返回键留在它们自己的页头里。
 */
type Route =
  | {
    kind: 'chat'
    session: SessionView
    workspaceId: string
    /** 空会话首屏：没有会话可开，但页面形状不变。 */
    empty?: boolean
    focusSeq?: number
    focusMessageId?: string
    focusPartId?: string
    /** 结构坐标（图谱寻址）：命中在第几轮 / 第几步。 */
    focusTurn?: number
    focusStep?: number
    focusQuery?: string
  }
  /** ② 搜索：抽屉进来，返回回会话页。 */
  | { kind: 'search'; session: SessionView; workspaceId: string }
  | { kind: 'settings'; session: SessionView; workspaceId: string }
  | { kind: 'usage'; session: SessionView; workspaceId: string }
  /** ⑯ 子代理详情：顶栏运行状态 → 子代理列表点一行进来；返回即弹栈回会话。 */
  | {
    kind: 'subagent'
    session: SessionView
    workspaceId: string
    node: SubagentFlatNode
  }
  /** 任务：进行中 / 刚完成的总览（2026-11-11）。 */
  | { kind: 'tasks'; session: SessionView; workspaceId: string }
  /** ⑭ 外观：设置页「外观」进去；返回即弹栈回设置。 */
  | { kind: 'appearance'; session: SessionView; workspaceId: string }
  /** ⑥ 批准方式：对话页权限芯片进来，返回即弹栈回对话。 */
  | {
    kind: 'approval-mode'
    session: SessionView
    workspaceId: string
    permissions: { currentValue: string; options: readonly { value: string; name: string; description?: string }[] }
  }
  /** ⑦ 上下文占用：对话页点占用环进来，返回即弹栈回对话。 */
  | {
    kind: 'context'
    session: SessionView
    workspaceId: string
    usage: { contextWindow?: number; pressureTokens?: number; projectedTokens?: number }
  }
  /** ⑧ 产物列表：抽屉 / ⋯ 菜单进来，返回即弹栈回对话。 */
  | {
    kind: 'artifacts'
    session: SessionView
    workspaceId: string
    turns: readonly ArtifactTurnPayload[]
  }
  /** ⑨ 产物摘要：产物页每轮分组标题进来，`turn` 为 undefined 表示缺轮号的「更早」组；返回即弹栈回产物列表。 */
  | {
    kind: 'artifact-summary'
    session: SessionView
    workspaceId: string
    turn: number | undefined
    turns: readonly ArtifactTurnPayload[]
  }
  /** ⑫ 回合大纲：对话页「轮次」进来，返回即弹栈回对话。 */
  | {
    kind: 'outline'
    session: SessionView
    workspaceId: string
    turns: readonly TurnOutlineEntry[]
    currentTurn: number
  }
  /** ⑩ 单文件 diff：从对话里的文件行点进来，返回即弹栈回对话。 */
  | {
    kind: 'diff'
    session: SessionView
    workspaceId: string
    path: string
  }
  /**
   * ⑩′ 文件预览：正文里的路径、产物列表、交付详情点文件进来。
   *
   * 2026-11-11 用户：「正文链接里/交付物里的 markdown 文件打开之后是源格式」。
   * 原来这些入口全都 `navigate({ kind: 'diff' })` —— 打开的是一个逐行源码页，
   * 对 markdown 等于把文档当代码看。点文件的本意是"看这个文件"，所以改走预览：
   * markdown 有渲染/源码两档（`FilePreviewSheet` 里的切换按钮）。
   */
  | {
    kind: 'preview'
    session: SessionView
    workspaceId: string
    path: string
  }
  /** ⑮ 交付详情（`/m/s/<sessionId>/delivery/<turn>`）：交付卡「看全部改动」进来，返回即弹栈回对话。 */
  | {
    kind: 'delivery'
    session: SessionView
    workspaceId: string
    facts: TurnDeliveryFacts
  }
  /** ④ 审批详情：从对话正文的审批面板点"详情"进来，返回即弹栈回对话。 */
  | {
    kind: 'approval'
    session: SessionView
    workspaceId: string
    /**
     * 只存**导航身份**。审批内容属于会话账本（runtime/chat/pending-store.ts），
     * 不在这里抄一份快照：抄一份就会在别处答完之后继续摆着一个不存在的请求。
     */
    approvalId: string
    preview?: string
    argsText?: string
  }

/** 路由的稳定 key：同 key 视为"同一页"（用于页面栈去重）。 */
export function routeKeyOf(route: Route): string {
  if (route.kind === 'chat') return `chat:${route.session.sessionId}`
  if (route.kind === 'approval') return `approval:${route.approvalId}`
  if (route.kind === 'diff') return `diff:${route.session.sessionId}:${route.path}`
  if (route.kind === 'delivery') return `delivery:${route.session.sessionId}:${route.facts.turn}`
  if (route.kind === 'appearance') return 'appearance'
  if (route.kind === 'outline') return `outline:${route.session.sessionId}`
  if (route.kind === 'artifacts') return `artifacts:${route.session.sessionId}`
  if (route.kind === 'artifact-summary') {
    return `artifact-summary:${route.session.sessionId}:${route.turn === undefined ? 'earlier' : String(route.turn)}`
  }
  if (route.kind === 'context') return `context:${route.session.sessionId}`
  if (route.kind === 'approval-mode') return `approval-mode:${route.session.sessionId}`
  if (route.kind === 'search') return `search:${String(route.workspaceId)}`
  if (route.kind === 'settings') return `settings:${String(route.workspaceId)}`
  if (route.kind === 'usage') return `usage:${String(route.workspaceId)}`
  // 每个子代理是不同的一页：key 带上它的会话 id。
  if (route.kind === 'subagent') return `subagent:${route.node.id}`
  if (route.kind === 'tasks') return 'tasks'
  // 同一会话里点不同文件是不同的页面（key 带上路径，别让预览互相顶掉）。
  if (route.kind === 'preview') return `preview:${route.session.sessionId}:${route.path}`
  // 穷尽检查：新增 kind 而忘了写 key 时，这里会编译失败而不是默默共用 key。
  const exhaustive: never = route
  return String(exhaustive)
}
/** 抽屉滑出动画时长（与 280-sheets.css 的 .palm-drawer-out 对齐）。 */
const DRAWER_OUT_MS = 160

/** Placeholder workspace for standalone search hits (no attach relation). */
const STANDALONE_WORKSPACE: WorkspaceRow = {
  workspaceId: 'standalone' as never,
  path: '',
  title: '未分组',
  sessionIds: [] as never,
  createdAt: '',
  updatedAt: '',
}

/** 一个会话都没有时的占位：ChatView 只拿它画空态，不跑任何会话逻辑。 */
export /** 抽屉打开期间对账运行状态的间隔：够快看到"开跑"，又不至于每帧打一次 RPC。 */
const DRAWER_RUNNING_POLL_MS = 4_000

const EMPTY_SESSION: SessionView = {
  sessionId: '',
  title: '新会话',
  updatedAt: 0,
  running: false,
  blank: true,
}

/** 没有任何工作区时的占位（抽屉显示「本机工作区」）。 */
export const EMPTY_WORKSPACE: WorkspaceRow = {
  workspaceId: '' as never,
  path: '',
  title: '',
  sessionIds: [] as never,
  createdAt: '',
  updatedAt: '',
}

/** 根会话页；会话 id 为空时自动带空态标记。 */
export function chatRouteOf(session: SessionView, workspaceId: string): Route {
  return {
    kind: 'chat',
    session,
    workspaceId,
    ...(session.sessionId === '' ? { empty: true } : {}),
  }
}

/**
 * 冷启动时 URL 指名了会话（刷新 / PWA 重开 / 通知深链）：第一帧就直接落会话页。
 *
 * 以前刷新要先走 首页 →（拉工作区列表）→ 会话列表 →（拉第一页）→ 会话，两跳
 * 网络之后才挂上聊天页 —— 本地缓存住的行根本没机会出现在首帧里（渲染审计的
 * 「聊天 warm 0/0」）。URL 里已经指名了会话，就直接开这一页：ChatView 自己会
 * 先画缓存、再向宿主校准；标题优先取会话列表的本地缓存，取不到就写「新会话」
 * （以前是 `会话 + id 后 6 位`，冷启动时一直挂着假标题）；工作区信息由后台补数据填回来。
 */
export function chatRouteFromUrl(workspaceId: string, sessionId: string, seq?: number, title?: string): Route {
  return {
    kind: 'chat',
    session: {
      sessionId,
      title: title !== undefined && title !== '' ? title : '新会话',
      updatedAt: 0,
      running: false,
      blank: false,
    },
    workspaceId,
    ...(seq === undefined ? {} : { focusSeq: seq }),
  }
}

/**
 * 「返回」该落到哪一页。
 *
 * 会话页是根：它自己返回自己（系统返回退出）。子页一律退回它们所属的会话；
 * 外观属于设置。正常情况下 `back()` 先弹页面栈，这里只在栈里没有上一页时兜底。
 */
export function backTargetOf(route: Route): Route {
  switch (route.kind) {
    case 'chat':
      // 根页：没有"上一页"。
      return route
    case 'search':
    case 'settings': case 'usage': case 'subagent':
      // 兜底（栈里只有它）：抽屉里的入口都属于当前会话。
      return chatRouteOf(route.session, route.workspaceId)
    case 'appearance':
      return { kind: 'settings', session: route.session, workspaceId: route.workspaceId }
    case 'approval-mode':
    case 'context':
    case 'artifacts':
    case 'outline':
    case 'diff':
    case 'preview':
    case 'delivery':
    case 'approval':
      return chatRouteOf(route.session, route.workspaceId)
    case 'artifact-summary':
      // 兜底（栈里只有它）：摘要属于产物列表，退回那一页（轮次清单随路由带回去）。
      return { kind: 'artifacts', session: route.session, workspaceId: route.workspaceId, turns: route.turns }
    case 'tasks':
      // 任务页是"总览"，不属于某一轮：退回它的会话页。
      return { kind: 'chat', session: route.session, workspaceId: route.workspaceId }
  }
}

/** Read the optional workspace target carried from the pairing QR flow. */
export function mobileWorkspaceTarget(search: string): string | undefined {
  const value = new URLSearchParams(search).get('workspace')
  return value === null || value === '' ? undefined : value
}

/** Read the optional session target carried from a notification deep link. */
export function mobileSessionTarget(search: string): string | undefined {
  const value = new URLSearchParams(search).get('session')
  return value === null || value === '' ? undefined : value
}

/** Read the optional message-seq target carried from a search locate link. */
export function mobileFocusSeqTarget(search: string): number | undefined {
  const value = new URLSearchParams(search).get('seq')
  if (value === null || value === '') return undefined
  const seq = Number(value)
  return Number.isFinite(seq) && seq >= 0 ? seq : undefined
}

/**
 * 「当前所在位置」对应的查询串。
 *
 * 刷新 / PWA 重启必须回到原来那一页：会话页是根，所以任何子页都带着它所属的
 * 会话；写回 `workspace` + `session` 后，刷新至少能落回那个会话（子页本身是
 * 会话内的一层，不需要也不应该单独占 URL）。
 *
 * `debug`、`perf` 这类与位置无关的参数一律原样保留。
 */
export function routeUrlSearch(search: string, route: Route): string {
  const params = new URLSearchParams(search)
  // 离线深链造出来的占位工作区没有 workspaceId：这时不要覆盖 URL 里原有的值。
  const workspaceId = String(route.workspaceId ?? '')
  if (workspaceId !== '') params.set('workspace', workspaceId)
  if (route.session.sessionId !== '') params.set('session', route.session.sessionId)
  else params.delete('session')
  params.delete('seq')
  const query = params.toString()
  return query === '' ? '' : `?${query}`
}

/** Props accepted by the mobile root before it begins paired-device RPC calls. */
export interface AppProps {
  initialPairError?: string
}

/** Navigation depth of each route kind (drives the slide direction). */
const ROUTE_DEPTH = { chat: 0, search: 1, settings: 1, usage: 1, tasks: 1, artifacts: 1, appearance: 2, approval: 2, diff: 2, preview: 2, delivery: 2, outline: 2, 'artifact-summary': 2, subagent: 2, context: 2, 'approval-mode': 2 } as const

/** `turn/end` 帧里我们关心的那点内容。 */
interface TurnEndEvent {
  time?: number
  data?: { reason?: { kind?: string } }
}

/** 宿主把"为什么收工"写在 reason.kind 上：正常结束 / 出错 / 被中断。 */
const TURN_END_ERROR = new Set(['error', 'failed', 'failure', 'tool-error', 'exception'])
const TURN_END_STOPPED = new Set(['aborted', 'cancelled', 'canceled', 'interrupted', 'stopped', 'killed'])

/** 收工类型 → 刚结束清单/浮层上的状态色。 */
function turnEndStatus(event: TurnEndEvent): FinishedRun['status'] {
  const kind = event.data?.reason?.kind?.toLowerCase()
  if (kind === undefined) return 'done'
  if (TURN_END_ERROR.has(kind)) return 'error'
  if (TURN_END_STOPPED.has(kind)) return 'stopped'
  return 'done'
}

/**
 * A stable, non-interactive device label for automatic error reports. The
 * perf flow asks the user for a label (android-lan / ios-lan / …) at button
 * time, but reporting on an error CANNOT prompt — a render crash may have
 * taken the UI with it. So this derives the same device/environment tag from
 * the platform instead, falling back to `device` like perf does when the
 * prompt is dismissed.
 */
function deviceLabelForError(): string {
  if (typeof navigator === 'undefined') return 'device'
  const ua = typeof navigator.userAgent === 'string' ? navigator.userAgent : ''
  if (/android/i.test(ua)) return 'android'
  if (/ipad|iphone|ipod/i.test(ua)) return 'ios'
  return 'device'
}

/** Whether the mobile gateway rejected this browser for lack of a paired cookie. */
export function isUnpairedMobileError(error: unknown): boolean {
  return error instanceof RpcTransportError && error.message === 'HTTP 403'
}

/** The result of probing the paired-device-only mobile preference endpoint. */
export type MobilePairState = 'checking' | 'paired' | 'unpaired' | 'unavailable'

/** Classify an initial mobile preference failure without treating outage as authorization. */
export function mobilePairStateForError(error: unknown): Extract<MobilePairState, 'unpaired' | 'unavailable'> {
  return isUnpairedMobileError(error) ? 'unpaired' : 'unavailable'
}

/** Gate the independent mobile bundle until its own browser context is paired. */
export function App({ initialPairError }: AppProps) {
  const [pairState, setPairState] = useState<MobilePairState>('checking')

  // Opt-in perf instrumentation bootstraps with the app: rAF frame sampler,
  // Long Task observer and the window.__dshPalmPerf export. All of those are
  // no-ops unless the perf switch is on (localStorage dsh.palm.perf=1 or ?perf=1).
  // Error capture is NOT opt-in: a runtime throw on the phone has to be visible
  // without anyone having armed a measurement first (see mobile/errors.ts).
  /**
   * 自动换新构建：宿主重新构建后，手机上的页面会一直跑着打开那一刻的旧包（PWA 尤其如此）。
   *
   * build-refresh.ts 里 `watchBuildRefresh` 早写好了，但此前**没有任何地方调用它** ——
   * 于是「代码已经修好、手机上还是老行为」，看起来像需要重启宿主，其实只是旧包没换。
   * 这里在 App 启动时接上：可见时每 5 分钟比对一次构建哈希，变了就自动重载一次
   * （sessionStorage 里记着「这个哈希已经重载过」，避免半成品构建造成重载循环）。
   */
  useEffect(() => watchBuildRefresh(), [])

  useEffect(() => {
    installPerfWindowHook()
    startPerfSampler()
    installErrorCapture()
    // The automatic error outbox rides the same boot: it subscribes to the
    // always-on error ring and hands each newly-seen, debounced record to the
    // host as `mobile.error`. Best-effort by contract — a failed send is
    // swallowed and the record stays in the ring for the manual paths.
    const stopReporter = installErrorReporter({
      send: (record) => {
        void reportError({
          kind: record.kind,
          message: record.message,
          ...(record.source === undefined ? {} : { source: record.source }),
          ...(record.frames === undefined ? {} : { frames: record.frames }),
          count: record.count,
          clientAt: record.at,
        }, deviceLabelForError())
      },
    })
    return stopReporter
  }, [])

  useEffect(() => {
    let current = true
    void fetchMobilePreferences().then(
      () => { if (current) setPairState('paired') },
      (error: unknown) => { if (current) setPairState(mobilePairStateForError(error)) },
    )
    return () => { current = false }
  }, [])

  // Pairing eviction (v3.3): a revoked/unpaired device must not keep
  // another device's persisted sessions — clear every identity-scoped store the
  // moment the pair state turns out to be broken. One registry owns the list
  // (`teardown.ts`); this effect only fires it.
  useEffect(() => {
    if (pairState === 'unpaired') {
      void runPairingTeardown().then(({ failed }) => {
        if (failed.length > 0) console.warn('dsh-palm: pairing teardown left data behind', failed)
      })
    }
  }, [pairState])

  if (pairState === 'checking') {
    return (
      <main className="mobile mobile-empty" role="status">
        <span className="boot-dot" aria-hidden />
        <p className="mobile-muted">正在连接...</p>
      </main>
    )
  }
  if (pairState === 'unpaired') {
    return (
      <PairRequiredView
        initialError={initialPairError}
        onPaired={(path) => {
          // A fresh pairing is a new device identity: drop the previous
          // identity's persisted sessions before the reload lands. Wait for the
          // teardown (bounded) so the outbox is gone before navigation, not
          // merely scheduled: an IndexedDB clear racing `location.replace`
          // would leave the previous owner's queued text behind.
          void Promise.race([
            runPairingTeardown(),
            new Promise(resolve => { setTimeout(resolve, 800) }),
          ]).finally(() => { window.location.replace(path) })
        }}
      />
    )
  }
  if (pairState === 'unavailable') {
    // 连不上宿主 ≠ 什么都看不到：本地有上次的正文缓存就照常进主界面，
    // 顶部挂一条离线提示（用户原则："所见即所得，稳定可靠呈现每一项内容"）。
    // 只有"确实没有任何缓存"时才退回那句错误 —— 否则空白页比旧内容更糟。
    if (hasAnyChatCache()) {
      return (
        <>
          <div className="mobile-offline-bar" role="status">
            离线：显示的是上次缓存的，连上后会更新
            <Button type="button" className="mobile-offline-retry" onClick={() => { window.location.reload() }}>
              重试
            </Button>
          </div>
          <PairedApp onUnpaired={() => { setPairState('unpaired') }} offline />
        </>
      )
    }
    return (
      <main className="mobile mobile-empty">
        <p className="mobile-error" role="alert">无法连接到运行中的 DSH host。</p>
        <Button className="mobile-new" type="button" onClick={() => { window.location.reload() }}>重试</Button>
      </main>
    )
  }

  return <PairedApp onUnpaired={() => setPairState('unpaired')} />
}

/** The paired surface's route + slide direction (parallax push/pop). */
interface RoutedState {
  route: Route
  forward: boolean
}

/** One page transition: the leaving route renders under an exit class for
 * the 250ms animation window, then drops. */
interface TransitionState {
  current: RoutedState
  leaving: RoutedState | undefined
}

/** How long the parallax transition runs (matches the CSS animation; 时长只有内核一份)。 */
const PAGE_TRANSITION_MS = TRANSITION_MS.forward

/** How often the open chat re-asserts its host-side observation (v3.4). */
const OBSERVE_REFRESH_MS = 30_000

/** The existing remote mobile surface, mounted only after device pairing succeeds. */
function PairedApp({ onUnpaired, offline = false}: { onUnpaired: () => void; offline?: boolean}) {
  // Foreground gate: every polling effect on this surface reads it, so a
  // backgrounded (frozen) PWA schedules nothing and the host is told to stop
  // streaming to it (see the observe effect below).
  const foreground = usePageVisible()
  /**
   * URL 指名了会话（刷新 / PWA 重开 / 通知深链）：首帧直接进会话页。
   *
   * 只在**在线**时这么走：离线那条深链捷径（见下面的 offlineDeepLink 效果）已经在
   * 处理"连不上宿主但有缓存"的情形，两条同时出手会重复 navigate 同一页。
   */
  const [bootedChat] = useState(() => {
    if (offline || typeof window === 'undefined') return undefined
    const workspaceId = mobileWorkspaceTarget(window.location.search)
    const sessionId = mobileSessionTarget(window.location.search)
    if (workspaceId === undefined || sessionId === undefined) return undefined
    // 标题能同步取到就先用缓存标题；取不到也**照样进这个会话** —— URL 指名了
    // 会话，就不能被"最近一个会话"的启动探针顶掉（刷新/深链会跳错会话）。
    // ChatView 打开后会自己从宿主把真标题取回来。
    const persisted = loadPersistedList(workspaceId)
    const cachedTitle = persisted?.rows.find(row => String(row.sessionId) === sessionId)?.title
    return {
      workspaceId,
      sessionId,
      seq: mobileFocusSeqTarget(window.location.search),
      title: cachedTitle ?? '',
    }
  })
  /** 冷启动首帧：URL 指名了会话就直接进；否则先落空会话，启动探针再换真会话。 */
  const [transition, setTransition] = useState<TransitionState>({
    current: {
      route: bootedChat === undefined
        ? { kind: 'chat', session: EMPTY_SESSION, workspaceId: '', empty: true }
        : chatRouteFromUrl(bootedChat.workspaceId, bootedChat.sessionId, bootedChat.seq, bootedChat.title),
      forward: true,
    },
    leaving: undefined,
  })
  const route = transition.current.route
  /** 当前页面（给异步回调读：收工事件要知道该弹底部浮层还是走聊天页顶部条）。 */
  const routeRef = useRef<Route>(route)
  routeRef.current = route
  /** P6 页面栈：真实记录「我来过哪几页」，返回 = 弹栈（不再是猜）。 */
  const stackRef = useRef(createPageStack(routeKeyOf(route), route))
  const forward = transition.current.forward
  const exitTimerRef = useRef<number | undefined>(undefined)
  /** 启动探针：有会话就进最近一个，没有就停在空会话首屏。 */
  const [booted, setBooted] = useState(bootedChat !== undefined)
  const [bootError, setBootError] = useState<string | undefined>(undefined)
  /** 工作区花名册：抽屉的身份区与切换面板共用。 */
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceRow[]>([])
  /**
   * 用户主动置顶的会话 / 工作区（2026-11-12 用户：「没有实现这个工作区和会话的置顶」）。
   *
   * 存在 localStorage（`session/pins.ts`）：置顶是**本机偏好**，桌面端没有这个概念，
   * 写进宿主会让「手机上钉的」跑到别的设备上。两个 Set 只用于渲染判断，
   * 真正的读写都走 pins 模块（它负责坏数据兜底）。
   */
  const [pinnedSessions, setPinnedSessions] = useState<ReadonlySet<string>>(() => loadPinnedSessions())
  const [pinnedWorkspaces, setPinnedWorkspaces] = useState<ReadonlySet<string>>(() => loadPinnedWorkspaces())
  /** 长按一行切换置顶：写盘 → 同步 state → 就地重排（不重排的话图钉亮了下一次打开才生效）。 */
  const toggleSessionPin = useCallback((sessionId: string) => {
    const pinned = togglePinnedSession(sessionId)
    const next = loadPinnedSessions()
    setPinnedSessions(next)
    toast(pinned ? '已置顶，长按可取消' : '已取消置顶')
    setDrawer(previous => previous === undefined
      ? previous
      : { ...previous, rows: orderDrawerRows(previous.rows, previous.session.sessionId, next) })
  }, [])
  /** 长按工作区切换里的一行切换工作区置顶（key 与 drawer-rows.pathKey 同口径）。 */
  const toggleWorkspacePin = useCallback((key: string) => {
    const pinned = togglePinnedWorkspace(key)
    setPinnedWorkspaces(loadPinnedWorkspaces())
    toast(pinned ? '工作区已置顶' : '已取消置顶')
  }, [])
  /**
   * 删除一条会话（2026-11-12 用户：「会话删除功能，能做吗？」）。
   *
   * 底层是宿主的 `workspace.archiveSession` —— 它的语义是**归档**：宿主不再把它列进
   * 会话表，手机端的 roster 也被 `host/session-list.ts` 过滤掉（那里的注释写着
   * 「桌面删掉的会话不能从手机 roster 里冒出来」）。也就是说对用户而言就是删除，
   * 但**不可撤销** —— 手机上恢复不了一条被归档的会话，所以抽屉里要连点两次才执行。
   *
   * 删的是**当前正打开的那场**时不改路由：页面里已有的历史仍然可读，用户返回后它
   * 就不在列表里了。硬跳转（回空会话/回工作区）会打断用户正在看的内容，而这条操作
   * 本来就不高频 —— 宁可少做一步，也别把人正在读的东西抽走。
   */
  /**
   * 重命名一条会话（2026-11-13 用户：「会话需要增加重命名的功能」）。
   *
   * 底层是宿主的 `session.rename`（插件侧 `renameSession` 早已封装并放行，一直没有入口）。
   * 成功后**只改抽屉里这一行的标题**，不重新拉列表：宿主那边改名可能有延迟，
   * 重拉会让旧名字短暂"跳回来"。
   *
   * 当前正打开的那场改了名，顶栏标题不会立刻跟着变 —— 那条走的是路由里的会话快照。
   * 为这一下改名去重建路由会触发一次转场动画（applyRoute 会重置页面栈），
   * 比标题晚一会儿更难看，所以宁可留给下次进入时刷新。
   */
  const renameSessionTitle = useCallback((sessionId: string, title: string) => {
    void renameSession(sessionId, title).then(
      () => {
        setDrawer(previous => previous === undefined
          ? previous
          : { ...previous, rows: previous.rows.map(row => (row.sessionId === sessionId ? { ...row, title } : row)) })
        toast('已重命名')
      },
      (reason: unknown) => { toast(`重命名失败：${errorText(reason)}`) },
    )
  }, [])
  const deleteSession = useCallback((sessionId: string) => {
    void archiveSession(sessionId).then(
      () => {
        // 落盘页 + 跨挂载缓存也要摘掉这一行（2026-11-15 真机：「已删除的会话还会
        // 在列表里出现」）：抽屉下次打开是**先画落盘行**、宿主那一页再走并集合并，
        // 只在内存里滤掉这一行，下一帧就会被缓存原样画回来。
        dropSessionFromCaches(sessionId)
        setDrawer(previous => previous === undefined
          ? previous
          : { ...previous, rows: previous.rows.filter(row => row.sessionId !== sessionId) })
        const isCurrent = routeRef.current.kind === 'chat'
          && String(routeRef.current.session.sessionId) === String(sessionId)
        toast(isCurrent ? '已删除，返回后不再列出' : '已删除这个会话')
      },
      (reason: unknown) => { toast(`删除失败：${errorText(reason)}`) },
    )
  }, [])
  /**
   * 工作区名字的唯一出口（`session/workspace-directory.ts`）。
   *
   * 路由上的 workspace 在首帧 / 深链 / 跨工作区搜索时可能只有 id、标题是空串，
   * 以前抽屉和会话页顶栏各自兜底（还兜得不一样）。现在两处都调这一个函数，
   * 列表一到就一起变准 —— 不再有"一处显示路径、一处空白"的情况。
   */
  const workspaceView = useCallback(
    (workspace: string | Parameters<typeof resolveWorkspace>[0]) => resolveWorkspace(
      typeof workspace === 'string' ? { workspaceId: workspace } : workspace,
      workspaces,
    ),
    [workspaces],
  )
  /** 切换工作区面板（从抽屉身份区打开）。 */
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false)
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const muxRef = useRef<MuxClient | undefined>(undefined)
  /** 上一次已"钉"进 SSE 地址的会话（切会话要重建连接，见 observe effect）。 */
  const observedSessionRef = useRef<string | undefined>(undefined)
  const [bridge, setBridge] = useState<HostBridge<MuxFrame> | undefined>(undefined)

  /** 大纲页点了哪一轮：回到对话后由 ChatView 消费并落位。 */
  const [pendingTurn, setPendingTurn] = useState<{ turn: number; seq: number } | undefined>(undefined)
  /** 聊天页顶部的「别的会话跑完了」条：聊天页不弹底部浮层（会盖住输入框）。 */
  const [chatFinished, setChatFinished] = useState<FinishedRun | undefined>(undefined)
  /** 会话抽屉：打开时把会话行、收工集合与产物轮次一起快照下来（关掉即丢弃）。 */
  const [drawer, setDrawer] = useState<{
    session: SessionView; workspaceId: string; rows: readonly SessionView[]
    finished: ReadonlySet<string>; pending: ReadonlySet<string>; turns: readonly ArtifactTurnPayload[]
    /** 「任务」入口的小字（「3 在跑 · 1 刚完成」）：与任务页同口径；undefined = 空闲（行照画）。 */
    taskLabel?: string
    /** 会话列表还在路上（本地没有缓存时首帧为 true）：抽屉据此画"正在读取"而不是"还没有会话"。 */
    listing: boolean
  } | undefined>(undefined)
  /**
   * 「用量」行的小字：当前模型那家的余额/配额数字（`本周 32%` / `¥23.05`）。
   *
   * 抽屉关着时不做正事查询，只允许**预热**那一次（挂载后 3 秒，用当前会话当上下文）；
   * 打开时按抽屉里那个会话再查一次 —— 抽屉是导航，不能为这个字干等宿主的 3.8 秒，
   * 所以内部先用上次存下的、后台再刷新。
   */
  const usageChip = useUsageChip(
    drawer === undefined ? undefined : drawer.session.sessionId,
    route.session.sessionId === '' ? undefined : route.session.sessionId,
  )
  const chatFinishedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /**
   * 抽屉的退出动画（2026-11-12 用户：「动效不高级，要 iPhone 那种」）。
   *
   * 卸载即消失会"啪"地一下没了；这里先挂 `closing` 播 240ms 滑出，再真正卸载。
   * 只有「关掉抽屉」走这条路 —— 点某一行是页面转场，抽屉该立刻让位。
   */
  const [drawerClosing, setDrawerClosing] = useState(false)
  const drawerCloseTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const closeDrawer = useCallback((): void => {
    setDrawerClosing(true)
    if (drawerCloseTimerRef.current !== undefined) clearTimeout(drawerCloseTimerRef.current)
    drawerCloseTimerRef.current = setTimeout(() => {
      setDrawerClosing(false)
      setDrawer(undefined)
    }, DRAWER_OUT_MS)
  }, [])
  useEffect(() => () => {
    if (drawerCloseTimerRef.current !== undefined) clearTimeout(drawerCloseTimerRef.current)
  }, [])
  /** 同一会话 10 秒内只记一次：重连重放会重复送同一个 turn/end。 */
  const collectSeenRef = useRef(new Map<string, number>())
  /** 当前正开着的会话：它跑完不用弹 HUD（人就在眼前看着）。 */
  const openSessionRef = useRef<string | undefined>(undefined)

  /**
   * 一个回合收工：记进"刚结束"账本，并在别的页面弹一条浮层。
   *
   * 这就是"跑完了不知道是哪一个"的答案 —— 以前 turn/end 只是把卡片从列表里删掉。
   * 用时和摘要来自同一页尾页（`logTail`）：收工后那一轮的真起点已经在日志里，
   * 所以这里算出来的时长和过程条定格是同一个数。
   */
  const collectFinished = useCallback((sessionId: string, event: TurnEndEvent): void => {
    const at = typeof event.time === 'number' ? event.time : Date.now()
    const seen = collectSeenRef.current.get(sessionId)
    if (seen !== undefined && at - seen < 10_000) return
    collectSeenRef.current.set(sessionId, at)
    const status = turnEndStatus(event)
    const push = (title: string, durationMs?: number, summary?: string): void => {
      const entry: FinishedRun = {
        sessionId,
        title,
        finishedAt: at,
        status,
        ...(durationMs === undefined ? {} : { durationMs }),
        ...(summary === undefined ? {} : { summary }),
      }
      recordFinishedRun(entry)
      if (openSessionRef.current === sessionId) return
      // 会话页是唯一的页面：收工提示只走顶部 HUD（底部浮层会盖住输入框）。
      setChatFinished(entry)
      if (chatFinishedTimerRef.current !== undefined) clearTimeout(chatFinishedTimerRef.current)
      chatFinishedTimerRef.current = setTimeout(() => {
        chatFinishedTimerRef.current = undefined
        setChatFinished(undefined)
      }, 8_000)
    }
    void logTail(sessionId, 25).then(
      (page) => {
        const projected = page.projections?.values?.title
        const title = typeof projected === 'string' && projected !== ''
          ? projected
          : `会话 ${shortSessionId(sessionId)}`
        const duration = durationFromPage(page)
        const summary = summaryFromPage(page)
        push(title, duration, summary)
      },
      () => { push(`会话 ${shortSessionId(sessionId)}`) },
    )
  }, [])

  useEffect(() => () => {
    if (chatFinishedTimerRef.current !== undefined) clearTimeout(chatFinishedTimerRef.current)
  }, [])
  /** The current observe re-assertion, so the visibility handler can fire it
   *  the moment the page returns instead of waiting out the 30 s cadence. */
  const assertObserveRef = useRef<() => void>(() => {})
  // Message visibility is pinned to desktop parity: tool calls always render,
  // injected system messages never do. No setting can flip either one.
  const showToolCalls = true
  const showSystemMessages = false

  useEffect(() => () => {
    if (exitTimerRef.current !== undefined) clearTimeout(exitTimerRef.current)
  }, [])
  // 首屏一出来就把聊天 chunk 与设置数据预取到本地：用户点入口时目标页已经同步可渲染，
  // 舞台不会再先闪骨架、也不会卡在「点了没反应」。idle 执行，失败不影响功能。
  useEffect(() => prefetchOnIdle([warmChatView, () => refreshPage('settings', readSettings)]), [])

  /** Drop the leaving page once its exit animation has played. */
  const scheduleExitCleanup = useCallback(() => {
    if (exitTimerRef.current !== undefined) clearTimeout(exitTimerRef.current)
    exitTimerRef.current = window.setTimeout(() => {
      setTransition(state => ({ current: state.current, leaving: undefined }))
    }, PAGE_TRANSITION_MS)
  }, [])

  /** 落到根页（启动探针 / 切会话）：栈重置为只有这一页。 */
  const showRoot = useCallback((next: Route) => {
    stackRef.current = createPageStack(routeKeyOf(next), next)
    setTransition({ current: { route: next, forward: true }, leaving: undefined })
  }, [])

  /** Set the route: current page plays the exit animation, next one slides in. */
  const applyRoute = useCallback((next: Route) => {
    // 会话切换：上一会话的页面快照立即失效（换回来必须重新拉，不拿旧数据充数）。
    const previousRoute = currentOf(stackRef.current)?.value
    if (previousRoute !== undefined && previousRoute.session.sessionId !== next.session.sessionId) markSessionStale(previousRoute.session.sessionId)
    // 会话页是**根**：换会话 = 换根，不压栈（否则栈里会堆一串再也退不回去的会话）。
    // 子页照旧压栈：返回 = 弹栈，"从哪进来的"不需要任何标记去猜。
    if (next.kind === 'chat') {
      stackRef.current = createPageStack(routeKeyOf(next), next)
    } else {
      const top = currentOf(stackRef.current)
      if (top === undefined || top.key !== routeKeyOf(next)) {
        stackRef.current = pushPage(stackRef.current, routeKeyOf(next), next)
      }
    }
    setTransition(previous => {
      const nextForward = transitionOf(ROUTE_DEPTH[previous.current.route.kind], ROUTE_DEPTH[next.kind]) !== 'back'
      return {
        current: { route: next, forward: nextForward },
        leaving: previous.current,
      }
    })
    scheduleExitCleanup()
  }, [scheduleExitCleanup])

  /** Set the route, but never onto a page whose chunk is still downloading:
   *  the stage would go blank for a frame (the "闪一下" users report).
   *  其余页面都是同步 import，直接切；只有聊天 chunk 需要先 await。 */
  const navigate = useCallback((next: Route) => {
    if (next.kind !== 'chat') { applyRoute(next); return }
    void warmChatView().then(() => { applyRoute(next) }, () => { applyRoute(next) })
  }, [applyRoute])

  /**
   * 启动落点（2026-11-08）：**直接进会话正文页**。
   *
   * 规则只有一条：取最近一个会话 —— 宿主 `session.list` 本来就按最近排序，这里
   * 不再自己造排序；一个都没有就停在同一个 ChatView 的空态。工作区只用来给顶栏
   * 副标题与抽屉身份区取名字，不参与"进哪一页"的判断。
   */
  useEffect(() => {
    if (bootedChat !== undefined) return
    let cancelled = false
    void (async () => {
      let rows: readonly WorkspaceRow[] = []
      try {
        rows = (await listWorkspaces()) ?? []
      } catch {
        rows = []
      }
      if (cancelled) return
      setWorkspaces(rows)
      let landing: Route
      try {
        const page = await listSessions(undefined)
        const items = page?.items ?? []
        if (cancelled) return
        // 只认真正挂在工作区上的会话：子代理 / 未归属的散会话不属于"最近一个会话"，
        // 否则启动会落进一个从抽屉里根本找不到的会话。
        const latest = items.find(item => rows.some(row => row.sessionIds.includes(item.sessionId)))
          ?? items.find(item => item.cwd !== undefined && rows.some(row => row.path === item.cwd))
        if (latest === undefined) {
          landing = chatRouteOf(EMPTY_SESSION, (rows[0] ?? EMPTY_WORKSPACE).workspaceId)
        } else {
          const workspace = rows.find(row => row.sessionIds.includes(latest.sessionId))
            ?? rows.find(row => latest.cwd !== undefined && row.path === latest.cwd)
            ?? STANDALONE_WORKSPACE
          landing = chatRouteOf(toSessionView(latest), workspace.workspaceId)
        }
      } catch (reason) {
        if (cancelled) return
        setBootError(errorText(reason))
        landing = chatRouteOf(EMPTY_SESSION, (rows[0] ?? EMPTY_WORKSPACE).workspaceId)
        toast(`打开会话失败：${errorText(reason)}`)
      }
      if (cancelled) return
      showRoot(landing)
      setBooted(true)
    })()
    return () => { cancelled = true }
  }, [bootedChat, showRoot])

  /**
   * 宿主运行集合 → **镜像口径**的集合（抽屉的运行状态只认这一个）。
   *
   * 宿主 `mobile.runningSessions` 背后是帧镜像：漏一条 turn/end 要等五分钟静默上限
   * 才会掉；直接拿它覆盖界面，就会把已经收工的会话重新点亮（真机：侧边栏从「完成」
   * 跳回「运行中」，每 4 秒跳一次）。这里先交给 mux 的镜像（与聊天页同一个
   * `turnState` 复核、turn/end 帧即时删除），再读它的快照。
   */
  const verifiedRunning = useCallback(async (sessionIds: readonly string[]): Promise<readonly string[]> => {
    const client = muxRef.current
    // 可选调用：测试/降级形态的 mux 替身没有这两个方法，缺了就当"没有更准的答案"。
    if (client?.syncRunningFromProbe === undefined) return sessionIds
    await client.syncRunningFromProbe(sessionIds).catch(() => undefined)
    return client.runningSnapshot?.() ?? sessionIds
  }, [])

  /**
   * 抽屉里的「运行中」徽标随回合边界即时纠正（2026-11-11 用户：「任务都结束了，
   * 侧边栏还显示进行中」）。花名册是 60 秒快照，行上的 `running` 会滞留一个 TTL；
   * 手机自己收到了 turn/start / turn/end，就没有理由再等那一次枚举。
   */
  const patchDrawerRunning = useCallback((frame: MuxFrame): void => {
    const typed = frame as { type?: string; sessionId?: unknown; event?: { type?: string } }
    if (typed.type !== 'session/event') return
    const eventType = typed.event?.type
    if (eventType !== 'turn/start' && eventType !== 'turn/end') return
    const sessionId = String(typed.sessionId ?? '')
    if (sessionId === '') return
    const running = eventType === 'turn/start'
    setDrawer(current => {
      if (current === undefined) return current
      if (!current.rows.some(row => String(row.sessionId) === sessionId)) return current
      /*
       * 收工那一帧顺手把「完成」也点亮（2026-11-16 真机：「会话结束了，侧边栏没显示
       * 完成」）。以前这里只把 running 置 false，而「完成」集合是**打开抽屉那一刻**
       * 从账本拷的一份快照 —— 抽屉正开着时结束的那一轮，永远等不到自己进集合：
       * 运行中消失、完成也不出现，徽标整块空白，得关掉重开。
       */
      const finished = new Set(current.finished)
      if (running) finished.delete(sessionId)
      else finished.add(sessionId)
      return {
        ...current,
        rows: current.rows.map(row => (String(row.sessionId) === sessionId ? { ...row, running } : row)),
        finished,
      }
    })
  }, [])

  // The mux stream lives for the page lifetime: session events keep the
  // open chat live, and reconnect is automatic. If the polling fallback hits a
  // terminal (unpaired) error — the device was revoked or remote control
  // stopped — the client stops itself and we drop back to the pairing screen
  // instead of polling forever into a 60 s backoff.

  useEffect(() => {
    const mux = new MuxClient(undefined, {
      onUnpaired,
      // 每次 SSE 连上（**含浏览器自己的重连**）都重申"手机在看哪个会话"：宿主那份
      // 按设备过滤的登记在内存里，宿主重启/流被释放后新连接上没有任何登记，于是
      // `session/event` 一条都不到、界面完全不动，而 `mux/ping` 照常来让客户端以为
      // 流是活的（2026-11-15 受控实验 P2：0 条对话帧；P3：补登记当场恢复）。
      onConnect: () => { assertObserveRef.current() },
    })
    muxRef.current = mux
    // P3：全站唯一订阅点。App 持有 mux，其它视图/切片都经 bridge 订阅，
    // 于是同一帧只派发一次，重连（新 generation）也只通知一处。
    const bridge = createHostBridge<MuxFrame>(mux)
    setBridge(bridge)
    bridge.start()
    const unsubscribe = bridge.onFrame(frame => {
      handleAppFrame(frame, {
        // 运行中徽标随工作区页一起下线；这里保留空实现，收工账本照常写。
        recomputeActive: () => { /* 单一会话页没有跨页徽标 */ },
        collectFinished: (sessionId, event) => collectFinished(sessionId, event as TurnEndEvent),
      })
      // 抽屉里那枚「运行中」：收到回合边界就即时改，不等花名册的 60 秒快照。
      patchDrawerRunning(frame)
    })

    return () => { unsubscribe(); bridge.stop() }
  }, [onUnpaired, patchDrawerRunning])

  // The L1 completion-notify channel: starts once the page is paired and the
  // browser granted notification permission (the settings page asks). The
  // server decides what to notify; this only delivers — and delivery is
  // suppressed while the page is visible, so the channel is only kept open
  // while the page is hidden. Exactly one live stream exists in each state:
  // the mux while the page is on screen, notify while it is in the background
  // (the visibility effect below releases the mux socket on the way out).
  useEffect(() => {
    if (!foreground) startNotify()
    return () => { stopNotify() }
  }, [foreground])

  // Keep the live-event client pointed at the session currently on screen so
  // its polling fallback can keep that chat fresh over SSE-impairing tunnels
  // (quick tunnel / Tailscale Serve do not forward Server-Sent Events).
  useEffect(() => {
    const sessionId = route.kind === 'chat' && route.session.sessionId !== '' ? route.session.sessionId : undefined
    muxRef.current?.observe(sessionId)
    // 切会话要重建连接：宿主的过滤依据是地址里的 `?session=`。不重连就只剩登记表那条
    // 路，而 `mobile.observe` 落地前的几十~几百毫秒里新会话的帧会被整段丢掉（真机：
    // 切进一个正在跑的会话，界面显示已完成、正文缺一块）。
    if (observedSessionRef.current !== sessionId) {
      observedSessionRef.current = sessionId
      muxRef.current?.reconnect?.()
    }
  }, [route])

  /**
   * 把「当前所在位置」写回 URL（见 {@link routeUrlSearch}）：刷新 / PWA 重启
   * 回到原页面，会话缓存（IndexedDB 里的 history）才真正用得上。
   *
   * 用 `replaceState` 而不是 `pushState`：这不是一次用户导航，多出来的历史条目
   * 会让手机上的「返回」要多按一次才退出一页。首帧跳过：冷启动 URL 里的
   * `?workspace=&session=` 就是深链本身，先让上面那条导航链路把它消费掉，
   * 免得抢跑把还没被读到的目标删了。
   */
  const urlSyncedRef = useRef(false)
  useEffect(() => {
    if (!urlSyncedRef.current) {
      urlSyncedRef.current = true
      return
    }
    if (typeof window === 'undefined') return
    const next = window.location.pathname + routeUrlSearch(window.location.search, route) + window.location.hash
    const current = window.location.pathname + window.location.search + window.location.hash
    if (next === current) return
    window.history.replaceState(null, '', next)
  }, [route])

  /**
   * 首帧直接落进会话页时，把工作区信息补回来（标题来自会话列表的本地缓存，
   * 见 bootedChat 的初始值）。
   *
   * 只改 `transition.current.route` 的字段、不写 `leaving`：这不是一次切页，
   * 聊天页实例原地更新（routeKey 没变），不会出现「同一个会话两份」。
   */
  useEffect(() => {
    if (bootedChat === undefined) return
    let cancelled = false
    void listWorkspaces().then(
      (rows) => {
        if (cancelled) return
        setWorkspaces(rows)
        const fresh = rows.find(row => String(row.workspaceId) === bootedChat.workspaceId)
        if (fresh === undefined) return
        setTransition((previous) => {
          const current = previous.current.route
          if (current.kind !== 'chat' || current.session.sessionId !== bootedChat.sessionId) return previous
          return { ...previous, current: { ...previous.current, route: { ...current, workspace: fresh } } }
        })
      },
      () => { /* 非致命：抽屉里会显示「本机工作区」 */ },
    )
    return () => { cancelled = true }
  }, [bootedChat])

  // Tell the HOST which session is on screen (v3.4): it opens exactly one
  // assistant-stream follow for it, and that is what makes the phone stream
  // token-by-token like the desktop. Re-asserted on a slow cadence because the
  // host releases the registration when the SSE stream ends (device gone), so
  // a tunnel blip must not silently cost the chat its streaming.
  useEffect(() => {
    const sessionId = route.kind === 'chat' && route.session.sessionId !== '' ? route.session.sessionId : undefined
    const assert = (): void => {
      void observeSession(sessionId).catch(() => {
        // Non-fatal: message-level live updates (the durable bus) still work.
      })
    }
    assertObserveRef.current = assert
    if (!foreground) {
      // Hidden: hand the session back. The host releases its per-session
      // assistant-stream follow when the device stops observing, so a phone in
      // a pocket no longer makes the host fold and push every frame to it
      // (measured 2.4 KB/s while a turn streams). The visibility effect below
      // re-asserts this the moment the page comes back.
      void observeSession(undefined).catch(() => { /* non-fatal */ })
      return
    }
    assert()
    if (sessionId === undefined) return
    const timer = setInterval(assert, OBSERVE_REFRESH_MS)
    return () => { clearInterval(timer) }
  }, [route, foreground])

  // A backgrounded PWA is frozen by the browser: timers stop, and the SSE
  // socket can die without the page ever seeing an error — the phone would
  // then sit on a stale transcript until something else forced a refresh.
  // Returning to the foreground therefore resyncs the stream (reconnect +
  // replay the gap) and re-asserts the host-side observation at once, instead
  // of waiting out the 30 s cadence.
  useEffect(() => {
    const onVisibilityChange = (): void => {
      const mux = muxRef.current
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') {
        // Hidden: the transport goes with the screen. The observation above is
        // handed back (the host stops folding and pushing the turn), and this
        // releases the socket itself, so a pocketed page holds exactly one
        // live stream — the notify channel — instead of idling two.
        mux?.pause()
        return
      }
      mux?.resync()
      assertObserveRef.current()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => { document.removeEventListener('visibilitychange', onVisibilityChange) }
  }, [])

  const back = useCallback(() => {
    // P6：页面栈是返回的**唯一真源**——上一页是事实，不是猜的。
    // 只有"栈里就一页"（冷启动 / 深链直达 / 首屏就在会话页）时没有事实可用，
    // 才退回 backTargetOf 的启发式；会话页是根，兜底永远有落点。
    const popped = popPage(stackRef.current)
    stackRef.current = popped
    const restored = currentOf(popped)?.value
    setTransition(previous => ({
      current: {
        route: restored ?? backTargetOf(previous.current.route),
        forward: false,
      },
      leaving: previous.current,
    }))
    scheduleExitCleanup()
  }, [scheduleExitCleanup])

  /** 打开一个会话（换会话 = 换根）：工作区按会话的 `cwd` 认领 —— 别的工作区的会话不能在当前工作区里打开（2026-11-16 真机：从「任务」进去，侧边栏就把它排进了当前工作区第一行），认不出才用传进来的那个。 */
  const openChat = useCallback((session: SessionView, workspaceId: string) => {
    navigate(chatRouteOf(session, workspaceIdForCwd(session.cwd, workspaces) ?? workspaceId))
  }, [navigate, workspaces])

  /*
   * 抽屉打开时先取回列表前几条的首屏：用户拉开抽屉找会话的那一两秒，就是切会话时要等的
   * 那 500~900ms。取回来的落在 chat-page 的本地缓存里，点下去直接出内容。
   */
  useSessionPrefetch(drawer?.rows, drawer?.session.sessionId, drawer !== undefined)

  /**
   * 离线深链：`?session=` 指向的会话在本机有正文缓存时，**直接进聊天页**。
   *
   * 宿主连不上时，深链原本要靠会话列表确认这条会话存在才敢进 —— 断网就永远停在
   * 工作区首页，缓存里的正文根本没机会画出来（2026-11-01 实测）。
   * 只要有本地缓存就直接进；连上之后各视图会自己校准归属与状态。
   */
  const offlineDeepLinkRef = useRef(false)
  useEffect(() => {
    if (!offline) return
    if (offlineDeepLinkRef.current) return
    if (typeof window === 'undefined') return
    const target = mobileSessionTarget(window.location.search)
    if (target === undefined) return
    if (loadChatCache(target).length === 0) return
    offlineDeepLinkRef.current = true
    // 摘掉 ?session=：免得这一页重新挂载时又跳一次
    const url = new URL(window.location.href)
    url.searchParams.delete('session')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    showRoot(chatRouteOf({
      sessionId: target,
      title: `会话 ${target.slice(-6)}`,
      running: false,
      updatedAt: Date.now(),
      blank: false,
    }, EMPTY_WORKSPACE.workspaceId))
    setBooted(true)
  }, [offline, showRoot])

  /**
   * 点搜索命中：直接开对话并带上定位信息。
   *
   * 命中可能属于别的工作区；抽屉里的搜索是叠在会话页上的子页，所以这里直接
   * 换根到那个会话，返回时系统退出（子页的返回键仍会弹回它自己的上一层）。
   */
  const openSearchHit = useCallback((hit: SearchHit, term: string, currentWorkspaceId: string) => {
    /*
     * 把这次点击记成「一次定位意图」（2026-11-11 真机：搜到点进去，落在会话底部、
     * 一个字没高亮、搜索框也没开）。
     *
     * `session/locate-intent.ts` 那套意图表写得很细（TTL、续命、转场双挂载、消费后再复用），
     * 但**写入口从来没接上**：`rememberLocateIntent` 只有测试在调。于是
     * - 聊天页里 `locateIntentFor()` 永远 undefined，`useSearchPrefill` 永远不弹搜索框；
     * - props 那条路在「同一路由重挂载」时一丢，就只剩"滚到附近、一个字不高亮"。
     * 在这里写一次：谁挂载谁读到，两条路就都有兜底了。
     */
    rememberLocateIntent({
      sessionId: hit.sessionId,
      ...(hit.seq === undefined ? {} : { seq: hit.seq }),
      ...(hit.messageId === undefined ? {} : { messageId: hit.messageId }),
      ...(hit.partId === undefined ? {} : { partId: hit.partId }),
      // 结构坐标（图谱寻址）：seq 会被跨页合并打乱、messageId 可能不在窗口里，
      // 「第几轮第几步」是第三个稳定锚点。
      ...(hit.turn === undefined ? {} : { turn: hit.turn }),
      ...(hit.step === undefined ? {} : { step: hit.step }),
      ...(term.trim() === '' ? {} : { query: term }),
    })
    const sameWorkspace = hit.workspaceId === undefined
      || String(hit.workspaceId) === String(currentWorkspaceId)
    // 只带身份：名字由 `workspaceView`（resolveWorkspace）统一解析，
    // 搜索结果回执有没有 workspaceTitle 都不影响显示（2026-11-12 结构收敛）。
    const nextWorkspaceId: string = sameWorkspace
      ? currentWorkspaceId
      : String(hit.workspaceId ?? '')
    const session: SessionView = {
      sessionId: hit.sessionId,
      title: hit.title !== undefined && hit.title !== '' ? hit.title : '匹配会话',
      ...(hit.snippet !== undefined && hit.snippet !== '' ? { preview: hit.snippet } : {}),
      updatedAt: typeof hit.updatedAt === 'number' ? hit.updatedAt : 0,
      running: false,
      blank: false,
    }
    navigate({
      kind: 'chat',
      session,
      workspaceId: nextWorkspaceId,
      ...(hit.seq === undefined ? {} : { focusSeq: hit.seq }),
      ...(hit.messageId === undefined ? {} : { focusMessageId: hit.messageId }),
      ...(hit.partId === undefined ? {} : { focusPartId: hit.partId }),
      ...(hit.turn === undefined ? {} : { focusTurn: hit.turn }),
      ...(hit.step === undefined ? {} : { focusStep: hit.step }),
      ...(term === '' ? {} : { focusQuery: term }),
    })
  }, [navigate])

  /** HUD 里点"别的会话跑完了"：换根到那个会话（它可能属于任何工作区）。 */
  const openFinishedChat = useCallback((hit: { sessionId: string; title?: string }) => {
    navigate(chatRouteOf({
      sessionId: hit.sessionId,
      title: hit.title ?? '会话',
      updatedAt: 0,
      running: false,
      blank: false,
    }, STANDALONE_WORKSPACE.workspaceId))
  }, [navigate])

  // 正开着的会话：它收工时不弹 HUD（人已经在看那一页了）。
  openSessionRef.current = route.kind === 'chat' && route.empty !== true ? route.session.sessionId : undefined

  /**
   * 从抽屉「新建会话」/ 空会话首屏发送：建会话，切到会话页；带了文字就投递第一句。
   * 建会话失败直接抛给调用方（空态会显示原因，抽屉入口用 toast）。
   */
  const startSession = useCallback(async (text?: string): Promise<void> => {
    const current = routeRef.current
    const workspaceId = String(current.workspaceId ?? '')
    const created = await createSession(workspaceId === '' ? {} : { workspaceId })
    const session: SessionView = {
      sessionId: created.sessionId,
      title: '新会话',
      updatedAt: Date.now(),
      running: false,
      blank: true,
    }
    showRoot(chatRouteOf(session, workspaceId))
    if (text === undefined || text.trim() === '') return
    try {
      await prompt(created.sessionId, [{ type: 'text', text: text.trim() }])
    } catch (reason) {
      toast(`发送失败：${errorText(reason)}`)
    }
  }, [showRoot])

  /** 抽屉身份区切工作区：落到那个工作区最近的一个会话（没有就空会话）。 */
  const pickWorkspace = useCallback((workspaceId: string) => {
    setWorkspacePickerOpen(false)
    /*
     * 先切、再查（2026-11-10 实机"点切换工作区也切不动"）：
     * 原来这里 `await` 一次网络往返才动页面，弱网/隧道慢的时候点下去界面一动不动，
     * 用户只能理解成"切不动"。现在先用本地缓存（没有就空会话）**立刻**落页 ——
     * 标题马上变成新工作区；随后拿到宿主最新一页再替换成真正的最近会话。
     */
    const cached = workspaceId === '' ? [] : (loadPersistedList(workspaceId)?.rows ?? [])
    const quick = cached[0]
    showRoot(chatRouteOf(quick ?? EMPTY_SESSION, workspaceId))
    /*
     * 先把"谁在跑"问准：`mobile.runningSessions` 是轻量 RPC，比列表快得多。
     * 列表行自带的 running 会撒谎（见 drawer-rows 里 applyRunningState 的注释）。
     */
    const applyRunning = (): void => {
      void runningSessions().then(async ({ sessionIds }) => {
        // 与抽屉同一口径：先复核再入镜像，避免"宿主说在跑"被直接当真。
        const running = await verifiedRunning(sessionIds)
        setDrawer(previous => previous === undefined || String(previous.workspaceId) !== workspaceId
          ? previous
          : { ...previous, rows: applyRunningState(previous.rows, running) })
      }).catch(() => undefined)
    }
    applyRunning()
    if (workspaceId === '') return
    /**
     * 只在用户**还停在我们刚放的那一页**时才替换：中途自己点去别处了就不能抢回导航。
     *
     * @param next - 要落的会话（已按工作区认领）
     */
    const refine = (next: SessionView | undefined): void => {
      const current = routeRef.current
      if (current.kind !== 'chat') return
      if (String(current.workspaceId ?? '') !== workspaceId) return
      if (current.session.sessionId !== (quick?.sessionId ?? EMPTY_SESSION.sessionId)) return
      if (next === undefined || next.sessionId === quick?.sessionId) return
      showRoot(chatRouteOf(next, workspaceId))
    }
    /**
     * 兜底：宿主按工作区过滤只回了一条（归属表落后）或直接失败时，翻不带工作区的
     * 分页列表，由客户端按 `cwd` 认领 —— 否则会把用户丢进一个"最近会话"其实不属于
     * 这个工作区的会话里。
     *
     * @param reason - 首次请求的失败原因（翻页也失败时提示它）
     */
    const recover = async (reason?: unknown): Promise<void> => {
      let cursor: string | undefined
      for (let round = 0; round < 3; round += 1) {
        const page = await listSessions(cursor).catch(() => undefined)
        if (page === undefined) {
          if (round === 0 && reason !== undefined) toast(`切换工作区失败：${errorText(reason)}`)
          return
        }
        const rows = scopedToWorkspace(page.items ?? [], workspaceView(workspaceId))
        if (rows.length > 0) {
          const latest = [...rows].sort((a, b) => b.updatedAt - a.updatedAt)[0]
          refine(latest === undefined ? undefined : toSessionView(latest))
          return
        }
        if (page.hasMore !== true || page.nextCursor === undefined) break
        cursor = page.nextCursor
      }
    }
    void listSessions(undefined, workspaceId).then(
      (page) => {
        const scoped = scopedToWorkspace(page?.items ?? [], workspaceView(workspaceId))
        if (scoped.length <= 1) { void recover(); return }
        const latest = [...scoped].sort((a, b) => b.updatedAt - a.updatedAt)[0]
        refine(latest === undefined ? undefined : toSessionView(latest))
      },
      (reason: unknown) => { void recover(reason) },
    )
  }, [showRoot])

  /** 工作区的三个写操作（新建/改名/删除）都在这个 hook 里：写完重新拉列表，需要时落页。 */
  const workspaceActions = useWorkspaceActions({
    setWorkspaces,
    // hook 回传的是解析后的工作区视图；落页只需要身份。
    pickWorkspace: (workspace: { workspaceId: string }) => { pickWorkspace(workspace.workspaceId) },
    currentWorkspaceId: routeRef.current.kind === 'chat' ? String(routeRef.current.workspaceId ?? '') : '',
  })
  /**
   * 打开抽屉：先用本地缓存行立刻画，再后台拉一页宿主列表覆盖。
   * 等审批来自 mux 的 pending 镜像（与聊天页审批面板同一份数据）。
   */
  const openDrawer = useCallback((turns: readonly ArtifactTurnPayload[]) => {
    const current = routeRef.current
    if (current.kind !== 'chat') return
    const workspaceId = String(current.workspaceId ?? '')
    const persisted = workspaceId === '' ? undefined : loadPersistedList(workspaceId)
    const cachedRows = persisted?.rows ?? []
    // 第一帧与刷新后同一个排序（用户置顶的在前，其后当前会话，其余按时间倒序）。
    const painted = paintDrawerRows(current.empty === true ? undefined : current.session, cachedRows, Date.now(), loadPinnedSessions(), workspaceView(workspaceId).path)
      // 落盘行可能还留着别人已删的会话：首帧就别画（否则要闪一下才被宿主那页挡掉）。
      .filter(row => !isArchivedSessionId(row.sessionId))
    /*
     * 首帧就把镜像里"确实在跑"的行点亮：缓存行带的是上次落盘时的旧状态，它可能把
     * 正在跑的会话画成「已完成」，而等一次往返再改就是一次可见的跳变。
     * 只升不降：撤销交给 turn/end 帧与复核后的集合。
     */
    const rows = promoteRunning(painted, muxRef.current?.runningSnapshot?.() ?? [])
    const pendingEntries = muxRef.current?.pendingSnapshot() ?? []
    setDrawer({
      session: current.session,
      workspaceId: current.workspaceId,
      rows,
      finished: new Set(finishedRuns().map(run => run.sessionId)),
      pending: new Set(pendingEntries.map(entry => entry.sessionId)),
      // 有本地缓存就直接画；没有才需要等宿主那一页（等的时候不画"还没有会话"）。
      listing: cachedRows.length === 0,
      turns,
    })
    if (workspaceId === '') return
    /* 谁在跑 + 刚跑完多少（与「任务」页同一口径）：入口小字「N 在跑 · M 刚完成」靠这一问。 */
    void Promise.all([runningSessions(), fetchFinishedRuns().catch(() => [] as Awaited<ReturnType<typeof fetchFinishedRuns>>)]).then(async ([{ sessionIds }, finished]) => {
      // 走镜像：宿主那份集合会为漏掉的 turn/end 继续挂满五分钟，原样覆盖就是
      // 「完成 → 运行中」的跳变来源。
      const running = await verifiedRunning(sessionIds)
      setDrawer(previous => {
        if (previous === undefined || String(previous.workspaceId) !== workspaceId) return previous
        const rows = applyRunningState(previous.rows, running)
        // 「完成」集合同样要刷新：抽屉开着时结束的那一轮不会自己进集合（见 patchDrawerRunning）。
        const finishedIds = finishedIdSet([...finishedRuns(), ...finished])
        const taskLabel = taskLabelOf(running, finished)
        if (rows === previous.rows && taskLabel === previous.taskLabel && sameIdSet(finishedIds, previous.finished)) return previous
        return { ...previous, rows, taskLabel, finished: finishedIds }
      })
    }).catch(() => undefined)
    /**
     * 把一页结果并进抽屉（只认同一个工作区，避免切走后回来的旧页覆盖新抽屉）。
     *
     * @param fresh - 已按工作区过滤的行
     */
    const applyFresh = (fresh: readonly SessionView[]): void => {
      setDrawer(currentDrawer => {
        if (currentDrawer === undefined || String(currentDrawer.workspaceId) !== workspaceId) return currentDrawer
        // 合并是并集（宿主没翻到的行保留）；宿主明确说已归档的直接挡掉（别的设备删的）。
        const rows = orderDrawerRows(
          mergeDrawerRows(fresh, currentDrawer.rows, currentDrawer.session.sessionId)
            .filter(row => !isArchivedSessionId(row.sessionId)),
          currentDrawer.session.sessionId,
          loadPinnedSessions(),
        )
        /* 内容没变就别造新对象。抽屉是「先用本地缓存画、再被这一页覆盖」，以前无条件
           {...} 会让它滑上来之后再整块重渲染一次 —— 真机上就是"点一下卡两下"。 */
        if (currentDrawer.listing === false && sameDrawerRows(rows, currentDrawer.rows)) return currentDrawer
        return { ...currentDrawer, rows, listing: false }
      })
    }
    /**
     * 兜底：宿主按工作区过滤只回了「当前这一条」（归属表落后时的样子），或者这次请求
     * 直接失败 —— 都改走**不带工作区**的分页列表，由客户端按 `cwd` 认领。
     *
     * 2026-11-10 实机「打开侧边栏只剩当前会话」就是这一种：按工作区过滤的结果被归属
     * 表压成了一条。一页 40 条，翻到拿到本工作区的行（最多 3 页）为止；翻不到就保持
     * 缓存行，抽屉仍然可用，不会变成空白。
     */
    const recover = async (): Promise<void> => {
      let cursor: string | undefined
      for (let round = 0; round < 3; round += 1) {
        const page = await listSessions(cursor).catch(() => undefined)
        if (page === undefined) return
        const scoped = scopedToWorkspace(page.items ?? [], workspaceView(current.workspaceId)).map(toSessionView)
        if (scoped.length > 0) applyFresh(scoped)
        if (scoped.length > 1 || page.hasMore !== true || page.nextCursor === undefined) return
        cursor = page.nextCursor
      }
    }
    void listSessions(undefined, workspaceId).then(
      (page) => {
        const fresh = scopedToWorkspace(page?.items ?? [], workspaceView(current.workspaceId))
        applyFresh(fresh.map(toSessionView))
        // 落盘：这一页就是下次打开抽屉时的首屏（本地读，0 网络等待）。
        if (fresh.length > 0) {
          queuePersistedList(workspaceId, { rows: fresh.map(toSessionView), hasMore: page?.hasMore === true })
        }
        if (fresh.length <= 1) void recover()
      },
      () => { void recover() },
    )
  }, [workspaceView]) // 归属判断要用**已加载**的工作区表（原来 `[]` 拿到的是首帧那份空表）

  /**
   * 抽屉开着的时候，定时对一次"谁在跑"。
   *
   * 2026-11-12 用户：「运行状态更新太慢，有时从完成跳成运行中，有时跑了好久才出现运行中」。
   * 原来只在打开那一刻拉一次列表，之后**再也不刷新** —— 那一帧说什么就是什么。现在开着就每
   * DRAWER_RUNNING_POLL_MS 毫秒问一次（轻量 RPC，顺带刷新入口小字），关掉立刻停；列表行只负责标题和时间，运行状态以这个集合为准。
   */
  useEffect(() => {
    if (drawer === undefined) return undefined
    const workspaceId = drawer.workspaceId
    const timer = setInterval(() => {
      void Promise.all([runningSessions(), fetchFinishedRuns().catch(() => [] as Awaited<ReturnType<typeof fetchFinishedRuns>>)]).then(async ([{ sessionIds }, finished]) => {
        // 走镜像：4 秒缓存 + 未复核的宿主集合会和客户端轮询同频，把已收工的会话
        // 反复点亮（真机 2026-11-15「完成 → 运行中」每 4 秒跳一次）。
        const running = await verifiedRunning(sessionIds)
        setDrawer((previous) => {
          if (previous === undefined || String(previous.workspaceId) !== workspaceId) return previous
          const rows = applyRunningState(previous.rows, running)
          // 「完成」集合每次轮询都刷新（本地账本 ∪ 宿主账本）：抽屉开着的这段时间里
          // 结束的会话也能亮起「完成」，不用关掉重开（2026-11-16 真机反馈）。
          const finishedIds = finishedIdSet([...finishedRuns(), ...finished])
          const taskLabel = taskLabelOf(running, finished)
          // 运行集合没变就返回**同一个对象**：React 据此直接 bail out，不进重渲染。
          // 否则每 4 秒一次 setState 会把整个 App 重算一遍 —— 而 `<ChatView>` 没有
          // 渲染边界，等于抽屉开着时每 4 秒连聊天页那 4000 行函数体一起重跑
          // （2026-11-12 实测：这就是"点什么都卡一下"的来源之一）。
          if (rows === previous.rows && taskLabel === previous.taskLabel && sameIdSet(finishedIds, previous.finished)) return previous
          return { ...previous, rows, taskLabel, finished: finishedIds }
        })
      }).catch(() => undefined)
    }, DRAWER_RUNNING_POLL_MS)
    return () => { clearInterval(timer) }
  }, [drawer === undefined, drawer?.workspaceId])

  /** 抽屉 / 空会话菜单里的「设置」：叠在会话页上，返回回会话。 */
  const openSettings = useCallback(() => {
    const current = routeRef.current
    navigate({ kind: 'settings', session: current.session, workspaceId: current.workspaceId })
  }, [navigate])

  /**
   * 预取当前工作区的会话页（抽屉首屏的数据源）。
   *
   * 2026-11-10 实机：第一次点开抽屉要等 6 秒 —— 抽屉先读本地缓存，而缓存从来没写过
   * （queuePersistedList 没人调），只能干等宿主那一次冷启动的 session.list（约 6.3 s）。
   * 现在进了会话就后台拉一页并落盘：下次开抽屉直接读本地，0 网络等待。
   */
  useEffect(() => {
    if (route.kind !== 'chat') return
    const workspaceId = String(route.workspaceId ?? '')
    if (workspaceId === '' || PREFETCHED_WORKSPACES.has(workspaceId)) return
    const cached = loadPersistedList(workspaceId)
    if (cached !== undefined && Date.now() - cached.savedAt < 60_000) return
    PREFETCHED_WORKSPACES.add(workspaceId)
    void listSessions(undefined, workspaceId).then(
      (page) => {
        const fresh = scopedToWorkspace(page?.items ?? [], workspaceView(route.workspaceId))
        if (fresh.length === 0) return
        queuePersistedList(workspaceId, { rows: fresh.map(toSessionView), hasMore: page?.hasMore === true })
      },
      () => { PREFETCHED_WORKSPACES.delete(workspaceId) },
    )
  }, [route])

  /**
   * 交给 `<ChatView>` 的回调必须**引用稳定**，否则它连 `memo` 都挂不住。
   *
   * 这些原来全是 `case 'chat'` 里现造的箭头函数：App 任何一次状态变化（开关抽屉、
   * 运行状态轮询、finished-elsewhere 卡冒出来）都会换一批新引用，于是聊天页那
   * 4000 行函数体跟着重跑 —— 手机上就是"点什么都卡一下"。
   *
   * 依赖只放真正会被读到的值：`route` 变了（换会话/换页）才换一批，其余一律沿用。
   */
  const chatCallbacks = useMemo((): Partial<Pick<ChatViewProps,
    'finishedElsewhere' | 'onOpenFinished' | 'onDismissFinished' | 'onOpenSubagent' | 'onOpenDiff'
    | 'onOpenDelivery' | 'onPendingTurnConsumed' | 'onOpenOutline' | 'onOpenArtifacts'
    | 'onOpenTasks' | 'onOpenContext' | 'onOpenApprovalMode' | 'onOpenApproval'>> => {
    if (route.kind !== 'chat') return {}
    const session = route.session
    const workspaceId = route.workspaceId
    return {
      ...(chatFinished === undefined ? {} : {
        finishedElsewhere: {
          sessionId: chatFinished.sessionId,
          title: chatFinished.title,
          status: chatFinished.status,
          ...(chatFinished.durationMs === undefined ? {} : { durationMs: chatFinished.durationMs }),
        },
      }),
      onOpenFinished: () => {
        const hit = chatFinished
        setChatFinished(undefined)
        if (hit !== undefined) openFinishedChat({ sessionId: hit.sessionId, title: hit.title })
      },
      onDismissFinished: () => { setChatFinished(undefined) },
      onOpenSubagent: (node) => { navigate({ kind: 'subagent', session, workspaceId, node }) },
      onOpenDiff: (path) => { navigate({ kind: 'preview', session, workspaceId, path }) },
      onOpenDelivery: (facts) => { navigate({ kind: 'delivery', session, workspaceId, facts }) },
      onPendingTurnConsumed: () => { setPendingTurn(undefined) },
      onOpenOutline: (turns, currentTurn) => { navigate({ kind: 'outline', session, workspaceId, turns, currentTurn }) },
      onOpenArtifacts: (turns) => { navigate({ kind: 'artifacts', session, workspaceId, turns }) },
      onOpenTasks: () => { navigate({ kind: 'tasks', session, workspaceId }) },
      onOpenContext: (usage) => { navigate({ kind: 'context', session, workspaceId, usage }) },
      onOpenApprovalMode: (permissions) => { navigate({ kind: 'approval-mode', session, workspaceId, permissions }) },
      onOpenApproval: (approval, preview, argsText) => {
        navigate({
          kind: 'approval',
          session,
          workspaceId,
          approvalId: approval.approvalId,
          ...(preview === undefined ? {} : { preview }),
          ...(argsText === undefined ? {} : { argsText }),
        })
      },
    }
  }, [route, navigate, chatFinished, openFinishedChat, setChatFinished, setPendingTurn])

  const routeKey = routeKeyOf(route)
  /**
   * 切会话在栈里是换根（`chat:<sid>`），但**渲染容器的 key 不跟着会话走**（恒为 `chat`）：
   * 换 key 就是整页卸载重挂 —— 22 个 useState、全部消息行、滚动状态一起重建，实测一次
   * 切换要 190ms 级。会话相关状态由 ChatView 自己按 `sessionId` 重置（见
   * `use-session-scope.ts`），容器这一层不需要知道会话。
   *
   * 离场层用同一个映射：否则旧会话会在离场槽里再挂一个 ChatView（两个实例同时订阅 mux）。
   */
  const pageKey = route.kind === 'chat' ? 'chat' : routeKey
  /** 会话→会话：旧页就是新页，没有"离场"可言，离场层不画（同 key 也会互相顶掉）。 */
  const chatSwap = route.kind === 'chat' && transition.leaving?.route.kind === 'chat'
  const leavingKey = transition.leaving === undefined ? ''
    : (transition.leaving.route.kind === 'chat' ? 'chat' : routeKeyOf(transition.leaving.route))
  const dirClass = forward ? 'fwd' : 'back'

  /**
   * 会话就地切换时，进场动画得自己再放一次：元素没重挂，CSS 的 `.page-enter-*` 不会重播。
   *
   * 用 WAAPI 而不是"删类 → 读 offsetWidth → 加类"：后者会强制一次同步布局，正好把
   * 这次省下来的钱又花回去（P3 采样里那次 126ms 的 `get offsetHeight` 就是这笔账）。
   */
  const pageElRef = useRef<HTMLDivElement | null>(null)
  const lastChatKeyRef = useRef<string | undefined>(undefined)
  const chatKind = route.kind
  useLayoutEffect(() => {
    if (chatKind !== 'chat') return
    const previous = lastChatKeyRef.current
    lastChatKeyRef.current = routeKey
    const element = pageElRef.current
    if (element === null || previous === undefined || previous === routeKey) return
    // 老内核与 jsdom 都没有 WAAPI：没有动画而已，绝不能因此抛在提交阶段（会把整页卸掉）。
    if (typeof element.animate !== 'function') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true) return
    element.animate(
      [{ transform: 'translateX(100%)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: PAGE_TRANSITION_MS, easing: 'ease-out' },
    )
  }, [chatKind, routeKey])

  const renderRoute = (target: Route): ReactNode => {
    switch (target.kind) {
      case 'search':
        return (
          <SearchView
            search={searchPageFor}
            onBack={back}
            onPick={(hit, term) => { openSearchHit(hit, term, target.workspaceId) }}
          />
        )
      case 'settings':
        return (
          <SettingsView
            onBack={back}
            onOpenAppearance={() => { navigate({ kind: 'appearance', session: target.session, workspaceId: target.workspaceId }) }}
          />
        )
      case 'usage': return <UsageView onBack={back} />
      case 'subagent': return <SubagentView node={target.node} onBack={back} />
      case 'tasks':
        return (
          <TasksView
            onBack={back}
            onOpen={(session) => { openChat(session, target.workspaceId) }}
          />
        )
      case 'appearance':
        return <AppearanceView onBack={back} />
      case 'approval-mode':
        return (
          <ApprovalModeView
            currentValue={target.permissions.currentValue}
            options={target.permissions.options}
            onBack={back}
            onApply={(value) => {
              void sendCommand(target.session.sessionId, `/permission ${value}`).then(
                (outcome) => { if (outcome.matched) back() },
                () => {},
              )
            }}
          />
        )
      case 'context':
        return <ContextView {...target.usage} onBack={back} />
      case 'artifacts':
        return (
          <ArtifactsView
            turns={target.turns}
            onBack={back}
            onOpenFile={(path) => { navigate({ kind: 'preview', session: target.session, workspaceId: target.workspaceId, path }) }}
            onOpenTurn={(turn) => { navigate({ kind: 'artifact-summary', session: target.session, workspaceId: target.workspaceId, turn, turns: target.turns }) }}
          />
        )
      case 'artifact-summary':
        return (
          <ArtifactSummaryView
            turns={target.turns}
            turn={target.turn}
            onBack={back}
            onOpenFile={(path) => { navigate({ kind: 'preview', session: target.session, workspaceId: target.workspaceId, path }) }}
          />
        )
      case 'outline':
        return (
          <OutlineView
            entries={target.turns}
            currentTurn={target.currentTurn}
            onBack={back}
            onPick={(entry) => {
              setPendingTurn({ turn: entry.turn, seq: entry.seq })
              back()
            }}
          />
        )
      case 'diff':
        return <DiffView path={target.path} sessionId={target.session.sessionId} onBack={back} />
      case 'preview':
        // 手机端点文件的落点：渲染稿优先（markdown），sheet 自带「源码」切换。
        return (
          <FilePreviewSheet
            path={target.path}
            sessionId={target.session.sessionId}
            onClose={back}
          />
        )
      case 'delivery':
        return (
          <DeliveryDetailView
            facts={target.facts}
            onBack={back}
            onOpenFile={(path) => { navigate({ kind: 'preview', session: target.session, workspaceId: target.workspaceId, path }) }}
          />
        )
      case 'approval':
        return (
          <ApprovalRoute
            sessionId={target.session.sessionId}
            sessionTitle={target.session.title}
            approvalId={target.approvalId}
            {...(target.preview === undefined ? {} : { preview: target.preview })}
            {...(target.argsText === undefined ? {} : { argsText: target.argsText })}
            onBack={back}
          />
        )
      case 'chat':
        return (
          <ChatViewMemo
            session={target.session}
            empty={target.empty === true}
            workspaceName={workspaceView(target.workspaceId).name}
            initialFocusSeq={target.focusSeq}
            initialFocusMessageId={target.focusMessageId}
            initialFocusPartId={target.focusPartId}
            initialFocusTurn={target.focusTurn}
            initialFocusStep={target.focusStep}
            initialFocusQuery={target.focusQuery}
            mux={muxRef.current}
            bridge={bridge}
            onBack={canGoBack(stackRef.current) ? back : undefined}
            showToolCalls={showToolCalls}
            showSystemMessages={showSystemMessages}
            {...chatCallbacks}
            onOpenDrawer={openDrawer}
            onOpenSettings={openSettings}
            onStartSession={startSession}
            pendingTurn={pendingTurn}
          />
        )
    }
  }

  // 启动探针还没回来：先给一个明确的"正在打开"，而不是空白舞台。
  if (!booted) {
    return (
      <main className="mobile mobile-empty" role="status">
        <span className="boot-dot" aria-hidden />
        <p className="mobile-muted">正在打开会话...</p>
      </main>
    )
  }

  return (
    <div className="mobile">
      <div className="page-stage" data-drawer={drawer === undefined ? undefined : (drawerClosing ? undefined : 'open')}>
        {/* Same key as the current slot: React's keyed reconciliation moves the
            existing instance into the leaving slot instead of re-mounting it.
            A remount would re-run ChatView's tail load (a duplicate history
            fetch + mux resubscribe) on every back-from-chat. */}
        {/* B（拆包）：聊天页与设置页是懒加载的独立 chunk —— 首屏只需要工作区
            和会话列表，这两块（约 150KB 未压缩）不再进入首包。这里不再用
            Suspense：它的 fallback 会把整块舞台换成空背景，切页时闪一下；两个
            懒视图改为"点之前就 warm + 切之前 await"，冷启动才渲染骨架。 */}
        {transition.leaving !== undefined && !chatSwap && (
          <div key={leavingKey} className={`page page-exit-${dirClass}`} aria-hidden="true">
            {renderRoute(transition.leaving.route)}
          </div>
        )}
        <div key={pageKey} ref={pageElRef} className={`page page-enter-${dirClass}`}>
          {renderRoute(route)}
        </div>
      </div>
      {drawer === undefined ? null : (
        <SessionDrawer
          /* 名字走唯一出口 `workspaceView`（与会话页顶栏同一个函数），抽屉不再自己兜底。 */
          workspace={{
            title: workspaceView(drawer.workspaceId).name,
            path: workspaceView(drawer.workspaceId).path,
          }}
          rows={drawer.rows}
          listing={drawer.listing}
          finishedIds={drawer.finished}
          pendingIds={drawer.pending}
          pinnedSessions={pinnedSessions}
          onTogglePin={toggleSessionPin}
          onDelete={deleteSession}
          onRename={renameSessionTitle}
          currentSessionId={drawer.session.sessionId === '' ? undefined : drawer.session.sessionId}
          workspaceCount={workspaces.length}
          onSwitchWorkspace={() => { setDrawer(undefined); setWorkspacePickerOpen(true) }}
          onOpenAppearance={() => { setAppearanceOpen(true) }}
          /* 只有「关掉抽屉」这一种才播退出动画（240ms 后卸载）：
             点行/进设置是页面转场，抽屉该立刻让位，不该等它滑完。 */
          closing={drawerClosing}
          onClose={closeDrawer}
          onNew={() => {
            setDrawer(undefined)
            void startSession().catch((reason: unknown) => { toast(`新建会话失败：${errorText(reason)}`) })
          }}
          onSearch={() => { setDrawer(undefined); navigate({ kind: 'search', session: drawer.session, workspaceId: drawer.workspaceId }) }}
          onPick={(session) => { setDrawer(undefined); openChat(session, drawer.workspaceId) }}
          onOpenSettings={() => { setDrawer(undefined); navigate({ kind: 'settings', session: drawer.session, workspaceId: drawer.workspaceId }) }}
          onOpenUsage={() => { setDrawer(undefined); navigate({ kind: 'usage', session: drawer.session, workspaceId: drawer.workspaceId }) }}
          /* 入口小字 =「N 在跑 · M 刚完成」，与「任务」页同一口径（在跑取全局权威集合、
             刚完成取宿主 24 小时账本且不含仍在跑的）；都没有时入口仍在、小字写「空闲」
             （2026-11-14 用户：任务这一栏要固定显示）。 */
          taskLabel={drawer.taskLabel}
          /* 当前模型那家的余额/配额（undefined = 查不到，抽屉退回「余额」两个字）。 */
          usageLabel={usageChip}
          onOpenTasks={() => { setDrawer(undefined); navigate({ kind: 'tasks', session: drawer.session, workspaceId: drawer.workspaceId }) }}
        />
      )}
      {appearanceOpen ? (
        <AppearanceSheet onClose={() => { setAppearanceOpen(false) }} />
      ) : null}
      {workspacePickerOpen ? (
        <WorkspacePicker
          workspaces={workspaces}
          currentWorkspaceId={routeRef.current.kind === "chat" ? String(routeRef.current.workspaceId ?? "") : ""}
          currentPath={routeRef.current.kind === "chat" ? workspaceView(routeRef.current.workspaceId).path : ""}
          onPick={(workspace) => { pickWorkspace(workspace.workspaceId) }}
          pinnedWorkspaces={pinnedWorkspaces}
          onTogglePin={toggleWorkspacePin}
          onClose={() => { setWorkspacePickerOpen(false) }}
          onCreate={workspaceActions.create}
          onRename={workspaceActions.rename}
          onDelete={workspaceActions.remove}
        />
      ) : null}
      <ToastHost />
    </div>
  )
}
