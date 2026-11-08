/**
 * Mobile surface root: the view state machine (workspaces → sessions →
 * chat) and the top-level data flows. Deliberately plain React state — no
 * router, no state library: the surface is three fixed levels with a back
 * affordance, and every piece of data is fetched on demand.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { WorkspaceView as WorkspaceRow } from '../../api-proxy-types'
import { logTail, reportError } from '../data/diag.ts'
import { createSession, listSessions, observeSession, prompt, sendCommand } from '../data/session.ts'
import { fetchMobilePreferences, readSettings } from '../data/settings.ts'
import { listWorkspaces } from '../data/workspace.ts'
import { handleAppFrame } from '../kernels/app-frame-slice.ts'
import { createPageStack, currentOf, popPage, pushPage } from '../kernels/page-stack.ts'
import { transitionOf, TRANSITION_MS } from '../kernels/transition.ts'
import { createHostBridge } from '../kernels/host-bridge.ts'
import { MuxClient } from '../stream/mux.ts'
import { startNotify, stopNotify } from '../platform/notify.ts'
import { usePageVisible } from '../stream/foreground.ts'
import { applyHostThemePreference } from '../mobile-theme.ts'
import { RpcTransportError } from '../platform/rpc.ts'
import { runPairingTeardown } from '../platform/teardown.ts'
import { installErrorCapture } from '../platform/errors.ts'
import { watchBuildRefresh } from '../platform/build-refresh.ts'
import { installErrorReporter } from '../platform/errors-report.ts'
import { installPerfWindowHook, startPerfSampler } from '../platform/perf.ts'
import { toSessionView, type SessionView } from '../shared/session-view.ts'
import { errorText } from '../shared/error-text.ts'
import { ToastHost, toast } from '../components/toast.tsx'
// B（拆包）：聊天页与设置页只在真正进入时才需要，改成独立 chunk，首包因此
// 不再带上它们的 150KB 未压缩代码。
const loadChatView = async (): Promise<{ default: typeof import('./ChatView.tsx')['ChatView'] }> => ({
  default: (await import('./ChatView.tsx')).ChatView,
})
const loadSettingsView = async (): Promise<{ default: typeof import('./SettingsView.tsx')['SettingsView'] }> => ({
  default: (await import('./SettingsView.tsx')).SettingsView,
})

const { View: ChatView, warm: warmChatView } = createLazyView(loadChatView)
const { View: SettingsView, warm: warmSettingsView } = createLazyView(loadSettingsView)
import { durationFromPage, summaryFromPage } from '../session/run-detail.ts'
import { recordFinishedRun, finishedRuns, shortSessionId, type FinishedRun } from '../session/recent-finished.ts'
import { PairRequiredView } from '../components/PairRequiredView.tsx'
import { hasAnyChatCache } from '../session/chat-cache.ts'
import { loadChatCache } from '../session/chat-cache.ts'
import { loadPersistedList } from '../session/list-persist.ts'
import { createLazyView } from '../lazy-view.tsx'
import { SessionDrawer } from '../ui/session-drawer.tsx'
import { Button } from '../ui/primitives.tsx'
import { Sheet } from '../ui/sheet.tsx'
import { ApprovalView } from './ApprovalView.tsx'
import { DiffView } from './DiffView.tsx'
import { AppearanceView } from './AppearanceView.tsx'
import { OutlineView } from './OutlineView.tsx'
import { ArtifactsView } from './ArtifactsView.tsx'
import { ArtifactSummaryView } from './ArtifactSummaryView.tsx'
import { DeliveryDetailView } from './DeliveryDetailView.tsx'
import { ContextView } from './ContextView.tsx'
import { ApprovalModeView } from './ApprovalModeView.tsx'
import { SearchView, type SearchHit } from './SearchView.tsx'
import { searchPageFor } from './search-request.ts'
import type { ArtifactTurn as ArtifactTurnPayload } from '../session/artifacts.ts'
import type { TurnEntry as TurnOutlineEntry } from '../session/turn-outline.ts'
import type { TurnDeliveryFacts } from '../render/message-row.tsx'


/** One navigation level. */
/** 审批载荷类型：从视图组件的 props 推导（视图/路由层都不直接依赖数据层）。 */
type ApprovalPayload = Parameters<typeof ApprovalView>[0]['approval']

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
    workspace: WorkspaceRow
    /** 空会话首屏：没有会话可开，但页面形状不变。 */
    empty?: boolean
    focusSeq?: number
    focusMessageId?: string
    focusPartId?: string
    focusQuery?: string
  }
  /** ② 搜索：抽屉进来，返回回会话页。 */
  | { kind: 'search'; session: SessionView; workspace: WorkspaceRow }
  | { kind: 'settings'; session: SessionView; workspace: WorkspaceRow }
  /** ⑭ 外观：设置页「外观」进去；返回即弹栈回设置。 */
  | { kind: 'appearance'; session: SessionView; workspace: WorkspaceRow }
  /** ⑥ 批准方式：对话页权限芯片进来，返回即弹栈回对话。 */
  | {
    kind: 'approval-mode'
    session: SessionView
    workspace: WorkspaceRow
    permissions: { currentValue: string; options: readonly { value: string; name: string; description?: string }[] }
  }
  /** ⑦ 上下文占用：对话页点占用环进来，返回即弹栈回对话。 */
  | {
    kind: 'context'
    session: SessionView
    workspace: WorkspaceRow
    usage: { contextWindow?: number; pressureTokens?: number; projectedTokens?: number }
  }
  /** ⑧ 产物列表：抽屉 / ⋯ 菜单进来，返回即弹栈回对话。 */
  | {
    kind: 'artifacts'
    session: SessionView
    workspace: WorkspaceRow
    turns: readonly ArtifactTurnPayload[]
  }
  /** ⑨ 产物摘要：产物页每轮分组标题进来，`turn` 为 undefined 表示缺轮号的「更早」组；返回即弹栈回产物列表。 */
  | {
    kind: 'artifact-summary'
    session: SessionView
    workspace: WorkspaceRow
    turn: number | undefined
    turns: readonly ArtifactTurnPayload[]
  }
  /** ⑫ 回合大纲：对话页「轮次」进来，返回即弹栈回对话。 */
  | {
    kind: 'outline'
    session: SessionView
    workspace: WorkspaceRow
    turns: readonly TurnOutlineEntry[]
    currentTurn: number
  }
  /** ⑩ 单文件 diff：从对话里的文件行点进来，返回即弹栈回对话。 */
  | {
    kind: 'diff'
    session: SessionView
    workspace: WorkspaceRow
    path: string
  }
  /** ⑮ 交付详情（`/m/s/<sessionId>/delivery/<turn>`）：交付卡「看全部改动」进来，返回即弹栈回对话。 */
  | {
    kind: 'delivery'
    session: SessionView
    workspace: WorkspaceRow
    facts: TurnDeliveryFacts
  }
  /** ④ 审批详情：从对话正文的审批面板点"详情"进来，返回即弹栈回对话。 */
  | {
    kind: 'approval'
    session: SessionView
    workspace: WorkspaceRow
    approval: ApprovalPayload
    preview?: string
    argsText?: string
  }

/** 路由的稳定 key：同 key 视为"同一页"（用于页面栈去重）。 */
export function routeKeyOf(route: Route): string {
  if (route.kind === 'chat') return `chat:${route.session.sessionId}`
  if (route.kind === 'approval') return `approval:${route.approval.approvalId}`
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
  if (route.kind === 'search') return `search:${String(route.workspace.workspaceId)}`
  if (route.kind === 'settings') return `settings:${String(route.workspace.workspaceId)}`
  // 穷尽检查：新增 kind 而忘了写 key 时，这里会编译失败而不是默默共用 key。
  const exhaustive: never = route
  return String(exhaustive)
}
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
export const EMPTY_SESSION: SessionView = {
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
export function chatRouteOf(session: SessionView, workspace: WorkspaceRow): Route {
  return {
    kind: 'chat',
    session,
    workspace,
    ...(session.sessionId === '' ? { empty: true } : {}),
  }
}

/**
 * 冷启动时 URL 指名了会话（刷新 / PWA 重开 / 通知深链）：第一帧就直接落会话页。
 *
 * 以前刷新要先走 首页 →（拉工作区列表）→ 会话列表 →（拉第一页）→ 会话，两跳
 * 网络之后才挂上聊天页 —— 本地缓存住的行根本没机会出现在首帧里（渲染审计的
 * 「聊天 warm 0/0」）。URL 里已经指名了会话，就直接开这一页：ChatView 自己会
 * 先画缓存、再向宿主校准；标题优先取会话列表的本地缓存，工作区信息由后台那条
 * 补数据的效果填回来。
 */
export function chatRouteFromUrl(workspaceId: string, sessionId: string, seq?: number, title?: string): Route {
  return {
    kind: 'chat',
    session: {
      sessionId,
      title: title !== undefined && title !== '' ? title : `会话 ${sessionId.slice(-6)}`,
      updatedAt: 0,
      running: false,
      blank: false,
    },
    workspace: {
      workspaceId: workspaceId as never,
      path: '',
      title: '',
      sessionIds: [] as never,
      createdAt: '',
      updatedAt: '',
    },
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
    case 'settings':
      // 兜底（栈里只有它）：抽屉里的入口都属于当前会话。
      return chatRouteOf(route.session, route.workspace)
    case 'appearance':
      return { kind: 'settings', session: route.session, workspace: route.workspace }
    case 'approval-mode':
    case 'context':
    case 'artifacts':
    case 'outline':
    case 'diff':
    case 'delivery':
    case 'approval':
      return chatRouteOf(route.session, route.workspace)
    case 'artifact-summary':
      // 兜底（栈里只有它）：摘要属于产物列表，退回那一页（轮次清单随路由带回去）。
      return { kind: 'artifacts', session: route.session, workspace: route.workspace, turns: route.turns }
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
  const workspaceId = String(route.workspace.workspaceId ?? '')
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
const ROUTE_DEPTH = { chat: 0, search: 1, settings: 1, artifacts: 1, appearance: 2, approval: 2, diff: 2, delivery: 2, outline: 2, 'artifact-summary': 2, context: 2, 'approval-mode': 2 } as const

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
        ? { kind: 'chat', session: EMPTY_SESSION, workspace: EMPTY_WORKSPACE, empty: true }
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
  /** 切换工作区面板（从抽屉身份区打开）。 */
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false)
  const muxRef = useRef<MuxClient | undefined>(undefined)
  const bridgeRef = useRef<ReturnType<typeof createHostBridge> | undefined>(undefined)

  /** 大纲页点了哪一轮：回到对话后由 ChatView 消费并落位。 */
  const [pendingTurn, setPendingTurn] = useState<{ turn: number; seq: number } | undefined>(undefined)
  /** 聊天页顶部的「别的会话跑完了」条：聊天页不弹底部浮层（会盖住输入框）。 */
  const [chatFinished, setChatFinished] = useState<FinishedRun | undefined>(undefined)
  /** 会话抽屉：打开时把会话行、收工集合与产物轮次一起快照下来（关掉即丢弃）。 */
  const [drawer, setDrawer] = useState<{
    session: SessionView; workspace: WorkspaceRow; rows: readonly SessionView[]
    finished: ReadonlySet<string>; pending: ReadonlySet<string>; turns: readonly ArtifactTurnPayload[]
  } | undefined>(undefined)
  const chatFinishedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
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
  // 首屏一出来就把聊天页、设置页的 chunk 抓到本地：用户点进去时才不需要等下载，
  // 舞台也就不会先闪一下空白再滑进来。放到定时器里，不影响首屏渲染。
  useEffect(() => {
    const timer = window.setTimeout(() => { void warmChatView(); void warmSettingsView() }, 350)
    return () => { window.clearTimeout(timer) }
  }, [])

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
   *  the stage would go blank for a frame (the "闪一下" users report). */
  const navigate = useCallback((next: Route) => {
    const warm = next.kind === 'chat' ? warmChatView : next.kind === 'settings' ? warmSettingsView : undefined
    if (warm === undefined) { applyRoute(next); return }
    void warm().then(() => { applyRoute(next) }, () => { applyRoute(next) })
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
          landing = chatRouteOf(EMPTY_SESSION, rows[0] ?? EMPTY_WORKSPACE)
        } else {
          const workspace = rows.find(row => row.sessionIds.includes(latest.sessionId))
            ?? rows.find(row => latest.cwd !== undefined && row.path === latest.cwd)
            ?? STANDALONE_WORKSPACE
          landing = chatRouteOf(toSessionView(latest), workspace)
        }
      } catch (reason) {
        if (cancelled) return
        setBootError(errorText(reason))
        landing = chatRouteOf(EMPTY_SESSION, rows[0] ?? EMPTY_WORKSPACE)
        toast(`打开会话失败：${errorText(reason)}`)
      }
      if (cancelled) return
      showRoot(landing)
      setBooted(true)
    })()
    return () => { cancelled = true }
  }, [bootedChat, showRoot])

  // The mux stream lives for the page lifetime: session events keep the
  // open chat live, and reconnect is automatic. If the polling fallback hits a
  // terminal (unpaired) error — the device was revoked or remote control
  // stopped — the client stops itself and we drop back to the pairing screen
  // instead of polling forever into a 60 s backoff.
  useEffect(() => {
    const mux = new MuxClient(undefined, { onUnpaired })
    muxRef.current = mux
    // P3：全站唯一订阅点。App 持有 mux，其它视图/切片都经 bridge 订阅，
    // 于是同一帧只派发一次，重连（新 generation）也只通知一处。
    const bridge = createHostBridge(mux)
    bridgeRef.current = bridge
    bridge.start()
    const unsubscribe = bridge.onFrame(frame => handleAppFrame(frame, {
      // 运行中徽标随工作区页一起下线；这里保留空实现，收工账本照常写。
      recomputeActive: () => { /* 单一会话页没有跨页徽标 */ },
      collectFinished: (sessionId, event) => collectFinished(sessionId, event as TurnEndEvent),
    }))

    return () => { unsubscribe(); bridge.stop() }
  }, [onUnpaired])

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
    muxRef.current?.observe(route.kind === 'chat' && route.session.sessionId !== '' ? route.session.sessionId : undefined)
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

  // The desktop theme preference wins on the phone too (one setting, both
  // surfaces); the local choice applies first at boot, then this lands.
  useEffect(() => {
    let cancelled = false
    void readSettings().then(
      (read) => {
        if (cancelled) return
        const uiTheme = (read.namespaces ?? []).find(entry => entry.ns === 'ui-theme')?.value
        const preference = typeof uiTheme === 'object' && uiTheme !== null
          ? (uiTheme as Record<string, unknown>).preference
          : undefined
        if (preference === 'light' || preference === 'dark' || preference === 'system') {
          applyHostThemePreference(preference)
        }
      },
      () => {
        // Offline/older-host: the local theme stands.
      },
    )
    return () => { cancelled = true }
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

  /** 打开一个会话（会话页是根：换会话 = 换根，不压栈）。 */
  const openChat = useCallback((session: SessionView, workspace: WorkspaceRow) => {
    navigate(chatRouteOf(session, workspace))
  }, [navigate])

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
    }, EMPTY_WORKSPACE))
    setBooted(true)
  }, [offline, showRoot])

  /**
   * 点搜索命中：直接开对话并带上定位信息。
   *
   * 命中可能属于别的工作区；抽屉里的搜索是叠在会话页上的子页，所以这里直接
   * 换根到那个会话，返回时系统退出（子页的返回键仍会弹回它自己的上一层）。
   */
  const openSearchHit = useCallback((hit: SearchHit, term: string, currentWorkspace: WorkspaceRow) => {
    const sameWorkspace = hit.workspaceId === undefined
      || String(hit.workspaceId) === String(currentWorkspace.workspaceId)
    const workspace: WorkspaceRow = sameWorkspace
      ? currentWorkspace
      : {
        workspaceId: hit.workspaceId as never,
        path: '',
        title: hit.workspaceTitle ?? '',
        sessionIds: [] as never,
        createdAt: '',
        updatedAt: '',
      }
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
      workspace,
      ...(hit.seq === undefined ? {} : { focusSeq: hit.seq }),
      ...(hit.messageId === undefined ? {} : { focusMessageId: hit.messageId }),
      ...(hit.partId === undefined ? {} : { focusPartId: hit.partId }),
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
    }, STANDALONE_WORKSPACE))
  }, [navigate])

  // 正开着的会话：它收工时不弹 HUD（人已经在看那一页了）。
  openSessionRef.current = route.kind === 'chat' && route.empty !== true ? route.session.sessionId : undefined

  /**
   * 从抽屉「新建会话」/ 空会话首屏发送：建会话，切到会话页；带了文字就投递第一句。
   * 建会话失败直接抛给调用方（空态会显示原因，抽屉入口用 toast）。
   */
  const startSession = useCallback(async (text?: string): Promise<void> => {
    const current = routeRef.current
    const workspace = current.workspace
    const workspaceId = String(workspace.workspaceId ?? '')
    const created = await createSession(workspaceId === '' ? {} : { workspaceId })
    const session: SessionView = {
      sessionId: created.sessionId,
      title: '新会话',
      updatedAt: Date.now(),
      running: false,
      blank: true,
    }
    showRoot(chatRouteOf(session, workspace))
    if (text === undefined || text.trim() === '') return
    try {
      await prompt(created.sessionId, [{ type: 'text', text: text.trim() }])
    } catch (reason) {
      toast(`发送失败：${errorText(reason)}`)
    }
  }, [showRoot])

  /** 抽屉身份区切工作区：落到那个工作区最近的一个会话（没有就空会话）。 */
  const pickWorkspace = useCallback((workspace: WorkspaceRow) => {
    setWorkspacePickerOpen(false)
    const workspaceId = String(workspace.workspaceId ?? '')
    if (workspaceId === '') { showRoot(chatRouteOf(EMPTY_SESSION, workspace)); return }
    void listSessions(undefined, workspaceId).then(
      (page) => {
        const latest = page?.items?.[0]
        showRoot(latest === undefined ? chatRouteOf(EMPTY_SESSION, workspace) : chatRouteOf(toSessionView(latest), workspace))
      },
      (reason: unknown) => { toast(`切换工作区失败：${errorText(reason)}`) },
    )
  }, [showRoot])

  /**
   * 打开抽屉：先用本地缓存行立刻画，再后台拉一页宿主列表覆盖。
   * 等审批来自 mux 的 pending 镜像（与聊天页审批面板同一份数据）。
   */
  const openDrawer = useCallback((turns: readonly ArtifactTurnPayload[]) => {
    const current = routeRef.current
    if (current.kind !== 'chat') return
    const workspaceId = String(current.workspace.workspaceId ?? '')
    const persisted = workspaceId === '' ? undefined : loadPersistedList(workspaceId)
    const cachedRows = persisted?.rows ?? []
    const rows = current.empty === true
      ? cachedRows
      : [current.session, ...cachedRows.filter(row => row.sessionId !== current.session.sessionId)]
    const pendingEntries = muxRef.current?.pendingSnapshot() ?? []
    setDrawer({
      session: current.session,
      workspace: current.workspace,
      rows,
      finished: new Set(finishedRuns().map(run => run.sessionId)),
      pending: new Set(pendingEntries.map(entry => entry.sessionId)),
      turns,
    })
    if (workspaceId === '') return
    void listSessions(undefined, workspaceId).then(
      (page) => {
        const fresh = (page?.items ?? []).map(toSessionView)
        setDrawer(currentDrawer => currentDrawer === undefined || String(currentDrawer.workspace.workspaceId) !== workspaceId
          ? currentDrawer
          : { ...currentDrawer, rows: fresh })
      },
      () => { /* 保持缓存行：弱网下抽屉仍然可用 */ },
    )
  }, [])

  /** 抽屉 / 空会话菜单里的「设置」：叠在会话页上，返回回会话。 */
  const openSettings = useCallback(() => {
    const current = routeRef.current
    navigate({ kind: 'settings', session: current.session, workspace: current.workspace })
  }, [navigate])

  const routeKey = routeKeyOf(route)
  const leavingKey = transition.leaving === undefined ? '' : routeKeyOf(transition.leaving.route)
  const dirClass = forward ? 'fwd' : 'back'

  const renderRoute = (target: Route): ReactNode => {
    switch (target.kind) {
      case 'search':
        return (
          <SearchView
            search={searchPageFor}
            onBack={back}
            onPick={(hit, term) => { openSearchHit(hit, term, target.workspace) }}
          />
        )
      case 'settings':
        return (
          <SettingsView
            onBack={back}
            onOpenAppearance={() => { navigate({ kind: 'appearance', session: target.session, workspace: target.workspace }) }}
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
            onOpenFile={(path) => { navigate({ kind: 'diff', session: target.session, workspace: target.workspace, path }) }}
            onOpenTurn={(turn) => { navigate({ kind: 'artifact-summary', session: target.session, workspace: target.workspace, turn, turns: target.turns }) }}
          />
        )
      case 'artifact-summary':
        return (
          <ArtifactSummaryView
            turns={target.turns}
            turn={target.turn}
            onBack={back}
            onOpenFile={(path) => { navigate({ kind: 'diff', session: target.session, workspace: target.workspace, path }) }}
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
      case 'delivery':
        return (
          <DeliveryDetailView
            facts={target.facts}
            onBack={back}
            onOpenFile={(path) => { navigate({ kind: 'diff', session: target.session, workspace: target.workspace, path }) }}
          />
        )
      case 'approval':
        return (
          <ApprovalView
            sessionId={target.session.sessionId}
            sessionTitle={target.session.title}
            approval={target.approval}
            {...(target.preview === undefined ? {} : { preview: target.preview })}
            {...(target.argsText === undefined ? {} : { argsText: target.argsText })}
            onBack={back}
            onResolved={() => { back() }}
          />
        )
      case 'chat':
        return (
          <ChatView
            session={target.session}
            empty={target.empty === true}
            workspaceName={target.workspace.title}
            initialFocusSeq={target.focusSeq}
            initialFocusMessageId={target.focusMessageId}
            initialFocusPartId={target.focusPartId}
            initialFocusQuery={target.focusQuery}
            mux={muxRef.current}
            onBack={back}
            showToolCalls={showToolCalls}
            showSystemMessages={showSystemMessages}
            finishedElsewhere={chatFinished === undefined ? undefined : {
              sessionId: chatFinished.sessionId,
              title: chatFinished.title,
              status: chatFinished.status,
              ...(chatFinished.durationMs === undefined ? {} : { durationMs: chatFinished.durationMs }),
            }}
            onOpenFinished={() => {
              const hit = chatFinished
              setChatFinished(undefined)
              if (hit !== undefined) openFinishedChat({ sessionId: hit.sessionId, title: hit.title })
            }}
            onDismissFinished={() => { setChatFinished(undefined) }}
            onOpenDrawer={openDrawer}
            onOpenSettings={openSettings}
            onStartSession={startSession}
            onOpenDiff={(path) => { navigate({ kind: 'diff', session: target.session, workspace: target.workspace, path }) }}
            onOpenDelivery={(facts) => { navigate({ kind: 'delivery', session: target.session, workspace: target.workspace, facts }) }}
            pendingTurn={pendingTurn}
            onPendingTurnConsumed={() => { setPendingTurn(undefined) }}
            onOpenOutline={(turns, currentTurn) => { navigate({ kind: 'outline', session: target.session, workspace: target.workspace, turns, currentTurn }) }}
            onOpenArtifacts={(turns) => { navigate({ kind: 'artifacts', session: target.session, workspace: target.workspace, turns }) }}
            onOpenContext={(usage) => { navigate({ kind: 'context', session: target.session, workspace: target.workspace, usage }) }}
            onOpenApprovalMode={(permissions) => { navigate({ kind: 'approval-mode', session: target.session, workspace: target.workspace, permissions }) }}
            onOpenApproval={(approval, preview, argsText) => {
              navigate({
                kind: 'approval',
                session: target.session,
                workspace: target.workspace,
                approval,
                ...(preview === undefined ? {} : { preview }),
                ...(argsText === undefined ? {} : { argsText }),
              })
            }}
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
      <div className="page-stage">
        {/* Same key as the current slot: React's keyed reconciliation moves the
            existing instance into the leaving slot instead of re-mounting it.
            A remount would re-run ChatView's tail load (a duplicate history
            fetch + mux resubscribe) on every back-from-chat. */}
        {/* B（拆包）：聊天页与设置页是懒加载的独立 chunk —— 首屏只需要工作区
            和会话列表，这两块（约 150KB 未压缩）不再进入首包。这里不再用
            Suspense：它的 fallback 会把整块舞台换成空背景，切页时闪一下；两个
            懒视图改为"点之前就 warm + 切之前 await"，冷启动才渲染骨架。 */}
        {transition.leaving !== undefined && (
          <div key={leavingKey} className={`page page-exit-${dirClass}`} aria-hidden="true">
            {renderRoute(transition.leaving.route)}
          </div>
        )}
        <div key={routeKey} className={`page page-enter-${dirClass}`}>
          {renderRoute(route)}
        </div>
      </div>
      {drawer === undefined ? null : (
        <SessionDrawer
          workspace={{ title: drawer.workspace.title, path: drawer.workspace.path }}
          rows={drawer.rows}
          finishedIds={drawer.finished}
          pendingIds={drawer.pending}
          currentSessionId={drawer.session.sessionId === '' ? undefined : drawer.session.sessionId}
          artifactCount={drawer.turns.length}
          workspaceCount={workspaces.length}
          onSwitchWorkspace={() => { setDrawer(undefined); setWorkspacePickerOpen(true) }}
          onClose={() => { setDrawer(undefined) }}
          onNew={() => {
            setDrawer(undefined)
            void startSession().catch((reason: unknown) => { toast(`新建会话失败：${errorText(reason)}`) })
          }}
          onSearch={() => { setDrawer(undefined); navigate({ kind: 'search', session: drawer.session, workspace: drawer.workspace }) }}
          onPick={(session) => { setDrawer(undefined); openChat(session, drawer.workspace) }}
          onOpenSettings={() => { setDrawer(undefined); navigate({ kind: 'settings', session: drawer.session, workspace: drawer.workspace }) }}
          onOpenArtifacts={() => { setDrawer(undefined); navigate({ kind: 'artifacts', session: drawer.session, workspace: drawer.workspace, turns: drawer.turns }) }}
          onOpenUsage={() => { setDrawer(undefined); navigate({ kind: 'settings', session: drawer.session, workspace: drawer.workspace }) }}
        />
      )}
      {workspacePickerOpen ? (
        <Sheet title="切换工作区" onClose={() => { setWorkspacePickerOpen(false) }}>
          <div role="menu" aria-label="工作区">
            {workspaces.map(workspace => (
              <Button
                key={String(workspace.workspaceId)}
                type="button"
                role="menuitem"
                className="sheet-option"
                onClick={() => { pickWorkspace(workspace) }}
              >
                <span className="sheet-option-copy">
                  <span className="sheet-option-title">{workspace.title === '' ? workspace.path : workspace.title}</span>
                  <span className="sheet-option-desc">{workspace.path}</span>
                </span>
              </Button>
            ))}
          </div>
        </Sheet>
      ) : null}
      <ToastHost />
    </div>
  )
}
