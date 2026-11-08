/**
 * Mobile surface root: the view state machine (workspaces → sessions →
 * chat) and the top-level data flows. Deliberately plain React state — no
 * router, no state library: the surface is three fixed levels with a back
 * affordance, and every piece of data is fetched on demand.
 */

import { createElement, useCallback, useEffect, useReducer, useRef, useState, type ComponentType, type ReactElement, type ReactNode } from 'react'
import type { WorkspaceView as WorkspaceRow } from '../../api-proxy-types'
import { claimChunkAutoReload, isChunkLoadFailure } from '../platform/chunk-recovery.ts'
import { logTail, reportError } from '../data/diag.ts'
import { observeSession, prompt } from '../data/session.ts'
import { fetchMobilePreferences, readSettings } from '../data/settings.ts'
import { listWorkspaces } from '../data/workspace.ts'
import { handleAppFrame } from '../kernels/app-frame-slice.ts'
import { createHostBridge } from '../kernels/host-bridge.ts'
import { MuxClient } from '../stream/mux.ts'
import { startNotify, stopNotify } from '../platform/notify.ts'
import { usePageVisible } from '../stream/foreground.ts'
import { effectiveRunning, subscribePresence } from '../kernels/presence.ts'
import { applyHostThemePreference } from '../mobile-theme.ts'
import { RpcTransportError } from '../platform/rpc.ts'
import { runPairingTeardown } from '../platform/teardown.ts'
import { installErrorCapture } from '../platform/errors.ts'
import { watchBuildRefresh } from '../platform/build-refresh.ts'
import { installErrorReporter } from '../platform/errors-report.ts'
import { installPerfWindowHook, startPerfSampler } from '../platform/perf.ts'
import { getCachedOutline, setCachedOutline } from '../session/outline-cache.ts'
import { toSessionView, type SessionView } from '../shared/session-view.ts'
import { ToastHost } from '../components/toast.tsx'
// B（拆包）：聊天页与设置页只在真正进入时才需要，改成独立 chunk，首包因此
// 不再带上它们的 150KB 未压缩代码。
const loadChatView = async (): Promise<{ default: typeof import('./ChatView.tsx')['ChatView'] }> => ({
  default: (await import('./ChatView.tsx')).ChatView,
})
const loadSettingsView = async (): Promise<{ default: typeof import('./SettingsView.tsx')['SettingsView'] }> => ({
  default: (await import('./SettingsView.tsx')).SettingsView,
})

/**
 * 一块"懒视图"：把已解析的组件缓存在模块级，`warm()` 能在不渲染的情况下把 chunk
 * 先抓下来。用它替代 React.lazy 是为了消掉切页时的空白帧——实测在手机上点进会话，
 * 舞台先被 Suspense 的 fallback 换成一块空背景（约一帧到 40ms），再滑入新页面，
 * 看上去就是"闪一下才切过去"。现在 `navigate` 先 await `warm()` 再切，切换动画开
 * 始时目标组件已经同步可渲染，舞台永远不会掉进 fallback。
 */
export function createLazyView<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> }>,
): { View: ComponentType<P>; warm: () => Promise<void> } {
  const cache: { component?: ComponentType<P>; failed?: boolean } = {}
  let inflight: Promise<void> | undefined
  const warm = (): Promise<void> => {
    if (cache.component !== undefined) return Promise.resolve()
    if (inflight === undefined) {
      cache.failed = false
      inflight = loader().then(
        (loaded) => { cache.component = loaded.default },
        (error: unknown) => {
          cache.failed = true
          inflight = undefined
          // 分块 404（宿主刚升级、旧页面还在要老哈希）只能靠换壳解决：入口 JS 没变，
          // 于是「点一下重试」必然再失败一次。这里把失败交给自更新通道自己 reload；
          // 已经 reload 过一次仍失败（真的坏了）才回到「点一下重试」。
          const message = error instanceof Error ? error.message : String(error)
          if (isChunkLoadFailure(message) && claimChunkAutoReload()) {
            // 只刷一次（claimChunkAutoReload 自带一次性标记）：第二次仍失败说明不是
            // 换壳能救的，交回骨架上的「点一下重试」。
            window.location.reload()
          }
          throw error
        },
      )
    }
    return inflight
  }
  const View = (props: P): ReactElement => {
    const [, bump] = useReducer((tick: number) => tick + 1, 0)
    useEffect(() => {
      if (cache.component !== undefined) return
      // 冷启动直接落在这一页（深链）时没有 navigate 预取，自己补一次。
      void warm().then(() => { bump() }, () => { bump() })
    }, [])
    const Loaded = cache.component
    if (Loaded === undefined) return <PageSkeleton failed={cache.failed === true} onRetry={() => { void warm().then(() => { bump() }, () => { bump() }) }} />
    return createElement(Loaded, props)
  }
  return { View, warm }
}

const { View: ChatView, warm: warmChatView } = createLazyView(loadChatView)
const { View: SettingsView, warm: warmSettingsView } = createLazyView(loadSettingsView)

/** 冷启动落进懒视图时的一块"等得起"的骨架：和真实页面同高、带页头，不是空背景。 */
function PageSkeleton({ failed, onRetry }: { failed?: boolean; onRetry?: () => void }): ReactElement {
  return (
    <div className="page-loading" aria-busy={failed === true ? undefined : true}>
      <div className="page-loading-head" />
      {failed === true
        ? <Button type="button" className="page-loading-retry" onClick={onRetry}>加载失败，点一下重试</Button>
        : (
          <div className="page-loading-rows" aria-hidden="true">
            <span /><span /><span /><span />
          </div>
        )}
    </div>
  )
}
import { RunOverviewView, StatusGlyph, fetchRoster as fetchRunRoster } from './RunOverviewView.tsx'
import { SubChatView } from './SubChatView.tsx'
import { durationFromPage, formatRunDuration, summaryFromPage } from '../session/run-detail.ts'
import { recordFinishedRun, shortSessionId, type FinishedRun } from '../session/recent-finished.ts'
import { SessionListView } from './SessionListView.tsx'
import { WorkspaceView as WorkspaceRoster } from './WorkspaceView.tsx'
import { PairRequiredView } from '../components/PairRequiredView.tsx'
import { hasAnyChatCache } from '../session/chat-cache.ts'
import { loadChatCache } from '../session/chat-cache.ts'
import { loadPersistedList } from '../session/list-persist.ts'
import { Button } from '../ui/primitives.tsx'

/** One navigation level. */
type Route =
  | { kind: 'workspaces' }
  | { kind: 'run-overview' }
  | { kind: 'sessions'; workspace: WorkspaceRow }
  | { kind: 'settings'; workspace: WorkspaceRow }
  | {
    kind: 'chat'
    session: SessionView
    workspace: WorkspaceRow
    focusSeq?: number
    focusMessageId?: string
    focusPartId?: string
    focusQuery?: string
    /** Opened from the run-overview page: back returns there, not to a list. */
    fromRunOverview?: boolean
  }
  /** 子代理自己的会话（只读）：从"运行中"页的子代理行点进来。 */
  | { kind: 'sub-chat'; sessionId: string; label?: string; parentTitle?: string }

/** Placeholder workspace for standalone search hits (no attach relation):
 *  the chat only needs the session; backing out returns to the roster. */
const STANDALONE_WORKSPACE: WorkspaceRow = {
  workspaceId: 'standalone' as never,
  path: '',
  title: '未分组',
  sessionIds: [] as never,
  createdAt: '',
  updatedAt: '',
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
 * 抽成纯函数 + 穷尽 switch：漏写一个页面就是一颗死按钮 —— 2026-10-28 的真机现场，
 * 子代理只读页（`sub-chat`）进去之后 ‹ 和「回到运行中」都按不动，因为 `back()` 里
 * 没有它的分支、落到最后的 `return previous`。以后再加页面，TypeScript 会因为
 * "没覆盖所有分支"直接报错，不会再默默变砖。
 */
export function backTargetOf(route: Route, options: { fromLocate?: boolean } = {}): Route {
  switch (route.kind) {
    case 'chat':
      if (options.fromLocate === true) {
        // Reached from a workspace-search locate: go straight back to the roster
        // with the search surface restored (one back press).
        return { kind: 'workspaces' }
      }
      if (route.fromRunOverview === true) {
        // Opened from the run-overview page: one back press returns there.
        return { kind: 'run-overview' }
      }
      if (route.workspace.workspaceId === STANDALONE_WORKSPACE.workspaceId) {
        // A standalone chat has no session list behind it: return to the roster
        // instead of a phantom empty list.
        return { kind: 'workspaces' }
      }
      return { kind: 'sessions', workspace: route.workspace }
    case 'run-overview':
      return { kind: 'workspaces' }
    case 'settings':
      return { kind: 'sessions', workspace: route.workspace }
    case 'sessions':
      return { kind: 'workspaces' }
    case 'sub-chat':
      // 只读子会话只有一个入口：运行中页。
      return { kind: 'run-overview' }
    case 'workspaces':
      // 首页就是根：没有"上一页"，原地不动（原来的兜底行为）。
      return route
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
 * Read the decision target carried by a notification tap. iOS has no
 * lock-screen action buttons, so tapping a "needs your approval" notification
 * lands here: the chat opens with that approval already in front of the user
 * instead of making them scroll for it.
 */
export function mobileDecisionTarget(search: string): { id: string; kind: 'approval' | 'question' } | undefined {
  const params = new URLSearchParams(search)
  const id = params.get('decision')
  if (id === null || id === '') return undefined
  return { id, kind: params.get('decisionKind') === 'question' ? 'question' : 'approval' }
}

/**
 * 「当前所在位置」对应的查询串。
 *
 * 刷新 / PWA 重启必须回到原来那一页：以前进入会话后 `?workspace=&session=`
 * 被消费掉就再也不写回，一刷新就落回工作区首页 —— IndexedDB 里的会话缓存根本
 * 没有被读到的机会（真机与渲染审计里的「聊天 warm 0/0」就是这么来的）。
 *
 * - 会话页：写回 `workspace` + `session`（seq 不写：刷新后不该再定位到某条消息，
 *   那是搜索点进来的瞬态意图）；
 * - 会话列表 / 设置页：只写 `workspace`，刷新仍回到这个工作区；
 * - 首页 / 运行中 / 子会话：只清 `session`、`seq`，`workspace` 原样保留。
 *
 * `debug`、`perf` 这类与位置无关的参数一律原样保留。
 */
export function routeUrlSearch(search: string, route: Route): string {
  const params = new URLSearchParams(search)
  // 离线深链造出来的占位工作区没有 workspaceId：这时不要覆盖 URL 里原有的值。
  const workspaceId = route.kind === 'chat' || route.kind === 'sessions' || route.kind === 'settings'
    ? String(route.workspace.workspaceId ?? '')
    : ''
  if (workspaceId !== '') params.set('workspace', workspaceId)
  if (route.kind === 'chat') {
    params.set('session', route.session.sessionId)
    params.delete('seq')
  } else {
    params.delete('session')
    params.delete('seq')
  }
  const query = params.toString()
  return query === '' ? '' : `?${query}`
}

/** 时钟措辞已移入 `shared/time.ts`（单一实现）；此处保留 re-export 直到 S5 改完调用方。 */
export { formatFullTime, formatTime } from '../shared/time.ts'

/** Props accepted by the mobile root before it begins paired-device RPC calls. */
export interface AppProps {
  initialPairError?: string
}

/** Navigation depth of each route kind (drives the slide direction). */
const ROUTE_DEPTH = { workspaces: 0, 'run-overview': 1, sessions: 1, settings: 2, chat: 2, 'sub-chat': 2 } as const

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

/** How long the parallax transition runs (matches the CSS animation). */
const PAGE_TRANSITION_MS = 260

/** How often the open chat re-asserts its host-side observation (v3.4). */
const OBSERVE_REFRESH_MS = 30_000

/**
 * 现在是不是在输入框里打字（浮层要避让）。
 *
 * 只看「可编辑元素是否聚焦」：手机键盘弹出必然意味着某个输入框焦点在手，
 * 比监听视口高度变化稳（不同浏览器对 `visualViewport` 的支持差别很大）。
 */
function isEditableFocused(): boolean {
  if (typeof document === 'undefined') return false
  const active = document.activeElement
  if (active === null) return false
  const tag = active.tagName
  if (tag === 'TEXTAREA' || tag === 'INPUT') return true
  return (active as HTMLElement).isContentEditable === true
}

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
    // 标题只能从本地缓存里**同步**取：ChatView 的标题在同一个会话内只认
    // session.title（切换会话才重读），拿不到标题就退回原来的深链链路 ——
    // 那条路会从会话列表拿到真标题，而且它是「第一次来这个会话」的常态。
    const persisted = loadPersistedList(workspaceId)
    const cachedTitle = persisted?.rows.find(row => String(row.sessionId) === sessionId)?.title
    if (cachedTitle === undefined || cachedTitle === '') return undefined
    return {
      workspaceId,
      sessionId,
      seq: mobileFocusSeqTarget(window.location.search),
      title: cachedTitle,
    }
  })
  const [transition, setTransition] = useState<TransitionState>({
    current: {
      route: bootedChat === undefined
        ? { kind: 'workspaces' }
        : chatRouteFromUrl(bootedChat.workspaceId, bootedChat.sessionId, bootedChat.seq, bootedChat.title),
      forward: true,
    },
    leaving: undefined,
  })
  const route = transition.current.route
  /** 当前页面（给异步回调读：收工事件要知道该弹底部浮层还是走聊天页顶部条）。 */
  const routeRef = useRef<Route>(route)
  routeRef.current = route
  const forward = transition.current.forward
  const exitTimerRef = useRef<number | undefined>(undefined)
  // 首帧已经落在会话页时，URL 里的深链目标就已经被这一跳消费掉了：再留给
  // 列表页的 initialSessionId 会让「返回」又自动打开同一个会话。
  const [initialWorkspaceId, setInitialWorkspaceId] = useState<string | undefined>(
    () => (bootedChat === undefined ? mobileWorkspaceTarget(window.location.search) : undefined),
  )
  const [initialSessionId, setInitialSessionId] = useState<string | undefined>(
    () => (bootedChat === undefined ? mobileSessionTarget(window.location.search) : undefined),
  )
  /** Message-seq target from a locate link; consumed by the first chat open. */
  const [initialFocusSeq, setInitialFocusSeq] = useState<number | undefined>(
    () => (bootedChat === undefined ? mobileFocusSeqTarget(window.location.search) : undefined),
  )
  // The seq travels through the workspace→list→chat open chain via a ref:
  // the callbacks that consume it (openChat) are stable, so a state read
  // there would be stale; the ref is cleared once handed to a chat route.
  const focusSeqRef = useRef<number | undefined>(initialFocusSeq)
  /** Search query paired with focusSeq for exact in-message highlighting. */
  const focusQueryRef = useRef<string | undefined>(undefined)
  const focusMessageIdRef = useRef<string | undefined>(undefined)
  const focusPartIdRef = useRef<string | undefined>(undefined)
  /** Live workspace-search surface state (open + term), reported by the
   *  roster so the app can restore it when returning from a located chat. */
  const workspaceSearchSnapRef = useRef<{ open: boolean; term: string }>({ open: false, term: '' })
  /** Search snapshot frozen at locate time: the navigate to workspaces
   *  mounts a fresh roster whose initial snapshot report would overwrite
   *  the live one, so the back-restore must use this frozen copy. */
  const locateSearchSnapRef = useRef<{ open: boolean; term: string }>({ open: false, term: '' })
  /** One-shot restore of the workspace search surface on a located return. */
  const [restoreSearch, setRestoreSearch] = useState<{ open: boolean; term: string } | undefined>(undefined)
  /** Whether the current chat was reached through a workspace-search locate,
   *  so backing out returns to the search results instead of the plain list. */
  const locateFromSearchRef = useRef(false)
  /** Live background-task count across all sessions (run-overview badge). */
  /** Live-activity session count for the run-overview entry: main-agent
   *  sessions with a running turn or an in-flight background job. Both come
   *  from the mux mirrors, and the running mirror is host-verified
   *  (`mobile.turnState` per session) before a session is admitted — see
   *  MuxClient.refreshRunning. A second, independent host probe here used to
   *  keep counting a session the chat surface had already reported idle, so
   *  the chip said "有会话在跑" for minutes after a turn ended.
   *  Drives the entry chip's green breathing dot + numeric badge. */
  const [runOverviewLive, setRunOverviewLive] = useState(0)
  const muxRef = useRef<MuxClient | undefined>(undefined)
  const bridgeRef = useRef<ReturnType<typeof createHostBridge> | undefined>(undefined)

  /** 收工浮层：当前显示的那一条（undefined＝没在显示）。 */
  const [finishToast, setFinishToast] = useState<FinishedRun | undefined>(undefined)
  /** 聊天页顶部的「别的会话跑完了」条：聊天页不弹底部浮层（会盖住输入框）。 */
  const [chatFinished, setChatFinished] = useState<FinishedRun | undefined>(undefined)
  const chatFinishedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** 排队等显示的收工记录：短时间内跑完两个会话也不会互相盖掉。 */
  const toastQueueRef = useRef<FinishedRun[]>([])
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** 同一会话 10 秒内只记一次：重连重放会重复送同一个 turn/end。 */
  const collectSeenRef = useRef(new Map<string, number>())
  /** 当前正开着的会话：它跑完不用弹浮层（人就在眼前看着）。 */
  const openSessionRef = useRef<string | undefined>(undefined)

  /** 从队列里取一条来显示；显示期间新来的排队，4 秒后接上下一条。 */
  const pumpFinishToast = useCallback((): void => {
    if (toastTimerRef.current !== undefined) return
    // 打字时不打断：浮层会盖住输入框、也抢注意力。等手离开输入框再来
    // （每 800ms 重试一次，队列里的记录不会丢）。
    if (isEditableFocused()) {
      toastTimerRef.current = setTimeout(() => {
        toastTimerRef.current = undefined
        pumpFinishToast()
      }, 800)
      return
    }
    const next = toastQueueRef.current.shift()
    if (next === undefined) return
    setFinishToast(next)
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = undefined
      setFinishToast(undefined)
      pumpFinishToast()
    }, 4_000)
  }, [])

  const dismissFinishToast = useCallback((): void => {
    if (toastTimerRef.current !== undefined) {
      clearTimeout(toastTimerRef.current)
      toastTimerRef.current = undefined
    }
    setFinishToast(undefined)
    pumpFinishToast()
  }, [pumpFinishToast])

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
      // 聊天页：走顶部 HUD。底部浮层会盖住输入框（.finish-toast 的 z-index 高于
      // .chat-composer，两者都钉在底部），而聊天页正是唯一在打字的地方。
      if (routeRef.current.kind === 'chat' || routeRef.current.kind === 'sub-chat') {
        setChatFinished(entry)
        if (chatFinishedTimerRef.current !== undefined) clearTimeout(chatFinishedTimerRef.current)
        chatFinishedTimerRef.current = setTimeout(() => {
          chatFinishedTimerRef.current = undefined
          setChatFinished(undefined)
        }, 8_000)
        return
      }
      toastQueueRef.current = [...toastQueueRef.current, entry]
      pumpFinishToast()
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
  }, [pumpFinishToast])

  useEffect(() => () => {
    if (toastTimerRef.current !== undefined) clearTimeout(toastTimerRef.current)
  }, [])
  /** The current observe re-assertion, so the visibility handler can fire it
   *  the moment the page returns instead of waiting out the 30 s cadence. */
  const assertObserveRef = useRef<() => void>(() => {})
  /** Recompute the active session count from the mux mirrors (running
   *  sessions + sessions owning in-flight jobs), both read-only snapshots. */
  const recomputeActive = useCallback((): void => {
    const mux = muxRef.current
    if (mux === undefined) {
      setRunOverviewLive(0)
      return
    }
    const active = new Set<string>()
    // 以聊天页发布的结论为准（它同时握着实时帧、原子快照和本地意图）；
    // 没有发布过的会话才退回花名册 —— 首页徽标与运行中页从此同一个判据。
    for (const sessionId of mux.runningSessionsSnapshot()) {
      if (effectiveRunning(sessionId, true)) active.add(sessionId)
    }
    for (const row of mux.jobsSnapshot()) {
      const hasLiveJob = row.jobs.some(job => job.status === 'running' || job.status === 'stopping')
      if (!hasLiveJob) continue
      // 后台任务也是「在跑」的一种：共享状态说这一轮停了，任务还活着就仍算。
      active.add(row.sessionId)
    }
    setRunOverviewLive(active.size)
  }, [])
  // Message visibility is pinned to desktop parity: tool calls always render,
  // injected system messages never do. No setting can flip either one.
  const showToolCalls = true
  const showSystemMessages = false

  // 聊天页发布新的「在跑」结论时立刻重算徽标：同一个判据，两个视图同步。
  useEffect(() => subscribePresence(() => { recomputeActive() }), [recomputeActive])
  useEffect(() => () => {
    if (exitTimerRef.current !== undefined) clearTimeout(exitTimerRef.current)
  }, [])
  // 列表页一出来就把聊天页、设置页的 chunk 抓到本地：用户点进去时才不需要等下载，
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

  /** Set the route: current page plays the exit animation, next one slides in. */
  const applyRoute = useCallback((next: Route) => {
    setTransition(previous => {
      const nextForward = ROUTE_DEPTH[next.kind] >= ROUTE_DEPTH[previous.current.route.kind]
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
      recomputeActive,
      collectFinished: (sessionId, event) => collectFinished(sessionId, event as TurnEndEvent),
    }))

    recomputeActive()
    return () => { unsubscribe(); bridge.stop() }
  }, [onUnpaired, recomputeActive])

  // Running-set re-check for the roster entry, polled while the roster — the
  // surface that hosts the entry chip — is on screen. It goes through the mux
  // mirror instead of keeping a second set here: the mux re-asks the host and
  // re-verifies every stale claim with `mobile.turnState` (the very call the
  // chat page makes), so the chip and the chat can no longer disagree.
  useEffect(() => {
    // 只要不是聊天页就要核对：徽标/运行中入口在**首页、会话列表、运行中页**都显示，
    // 而原来只给 'workspaces' 开着 —— 那几页上的徽标就成了只涨不落（真机 2026-11-01：
    // 运行中页挂着 5 条早就结束的会话，收工之后再也不消失）。
    const badgeRouted = route.kind !== 'chat' && route.kind !== 'sub-chat' && route.kind !== 'settings'
    if (!badgeRouted || !foreground) return
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined
    const probe = (): void => {
      const mux = muxRef.current
      if (mux === undefined) return
      void mux.refreshRunning().then(
        () => { if (!cancelled) recomputeActive() },
        () => { /* non-fatal: the mirrors keep their previous count */ },
      )
    }
    probe()
    // 4 秒一次（原来 30 秒 —— 真机 2026-11-01："运行状态很不实时"）。
    // 首页/工作区页**没有订阅任何会话**，因此收不到 `session/status` 帧，
    // 运行集合只能靠这里问；30 秒的节奏意味着别处刚起一轮，手机上最多要干等半分钟。
    // 这个调用很轻（只回一组 sessionId），4 秒的代价远小于"看起来没在跑"的代价。
    timer = setInterval(probe, 4_000)
    return () => { cancelled = true; if (timer !== undefined) clearInterval(timer) }
  }, [route.kind, recomputeActive, foreground])

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
    muxRef.current?.observe(route.kind === 'chat' ? route.session.sessionId : undefined)
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
        const fresh = rows.find(row => String(row.workspaceId) === bootedChat.workspaceId)
        if (fresh === undefined) return
        setTransition((previous) => {
          const current = previous.current.route
          if (current.kind !== 'chat' || current.session.sessionId !== bootedChat.sessionId) return previous
          return { ...previous, current: { ...previous.current, route: { ...current, workspace: fresh } } }
        })
      },
      () => { /* 非致命：从会话页返回列表时那边会自己再拉一次 */ },
    )
    return () => { cancelled = true }
  }, [bootedChat])

  // Tell the HOST which session is on screen (v3.4): it opens exactly one
  // assistant-stream follow for it, and that is what makes the phone stream
  // token-by-token like the desktop. Re-asserted on a slow cadence because the
  // host releases the registration when the SSE stream ends (device gone), so
  // a tunnel blip must not silently cost the chat its streaming.
  useEffect(() => {
    const sessionId = route.kind === 'chat' ? route.session.sessionId : undefined
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
    // Compute the search-surface restore from the CURRENT route (a click
    // handler runs after a render, so `route` is current) and apply it
    // OUTSIDE the transition updater — updaters must stay pure, and calling
    // a setter inside one is a side effect (StrictMode runs updaters twice).
    const fromLocate = locateFromSearchRef.current
    if (fromLocate) {
      // Reached from a workspace-search locate: restore the roster search.
      locateFromSearchRef.current = false
      setRestoreSearch({ ...locateSearchSnapRef.current })
    }
    setTransition(previous => ({
      current: { route: backTargetOf(previous.current.route, { fromLocate }), forward: false },
      leaving: previous.current,
    }))
    scheduleExitCleanup()
  }, [scheduleExitCleanup])

  const openChat = useCallback((session: SessionView, workspace: WorkspaceRow, seq?: number, query?: string, messageId?: string, partId?: string) => {
    navigate({
      kind: 'chat',
      session,
      workspace,
      ...(seq !== undefined ? { focusSeq: seq } : {}),
      ...(messageId !== undefined ? { focusMessageId: messageId } : {}),
      ...(partId !== undefined ? { focusPartId: partId } : {}),
      ...(query !== undefined ? { focusQuery: query } : {}),
    })
    // Consume the search-locate targets now that the chat is opening, so a
    // later back-to-list (or back-to-roster) does not auto-open them again.
    setInitialSessionId(undefined)
    setInitialFocusSeq(undefined)
    // A normal session open must never inherit a PREVIOUS locate's stable
    // identity: leaving the refs armed would send a stale messageId/seq into
    // an unrelated chat and either fail to locate or jump to the wrong row.
    if (seq !== undefined) focusSeqRef.current = undefined
    if (query !== undefined) focusQueryRef.current = undefined
    if (messageId !== undefined) focusMessageIdRef.current = undefined
    if (partId !== undefined) focusPartIdRef.current = undefined
  }, [navigate])

  /**
   * 离线深链：`?session=` 指向的会话在本机有正文缓存时，**直接进聊天页**。
   *
   * 宿主连不上时，深链原本要靠会话列表确认这条会话存在才敢进 —— 断网就永远停在
   * 工作区首页，缓存里的正文根本没机会画出来（2026-11-01 实测）。
   * 现在只要有本地缓存就直接进；连上之后各视图会自己校准归属与状态。
   */
  const offlineDeepLinkRef = useRef(false)
  useEffect(() => {
    // **只有连不上宿主时**才走这条捷径。在线时 URL 里的 `?session=` 由正常链路
    // （会话列表确认后进入）处理 —— 在这里抢跑会和用户的正常导航打架，
    // 表现为"页面套页面 / 同一行出现两份 / 点击超时"（2026-11-01 验收 SOP 实测）。
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
    navigate({
      kind: 'chat',
      session: {
        sessionId: target,
        title: `会话 ${target.slice(-6)}`,
        running: false,
        updatedAt: Date.now(),
      } as never,
      workspace: { id: initialWorkspaceId ?? '', name: '离线', path: '', sessionCount: 0, pinned: false } as unknown as WorkspaceRow,
    } as never)
  }, [navigate, initialWorkspaceId, offline])

  const openWorkspace = useCallback((workspace: WorkspaceRow) => {
    if (initialWorkspaceId !== undefined || initialSessionId !== undefined) {
      const url = new URL(window.location.href)
      url.searchParams.delete('workspace')
      url.searchParams.delete('session')
      url.searchParams.delete('seq')
      // Consumed: a decision tap must not re-target after a refresh.
      url.searchParams.delete('decision')
      url.searchParams.delete('decisionKind')
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
      // NOTE: only initialWorkspaceId is cleared here — it prevents the
      // roster's auto-open effect from re-firing. initialSessionId and
      // initialFocusSeq are deliberately PRESERVED: they carry the
      // search-locate target that the session list consumes when mounting
      // (and openChat consumes them once the chat opens). Clearing them here
      // dropped the target session id, so the hit opened a plain list and
      // never reached the chat's message locate.
      setInitialWorkspaceId(undefined)
    }
    navigate({ kind: 'sessions', workspace })
  }, [initialWorkspaceId, initialSessionId, navigate])

  /** Locate a search hit: in-app navigation that reuses the deep-link
   *  targets — the roster auto-opens the target workspace, then the session
   *  list opens the target session. An optional seq scrolls the chat to the
   *  matched message. No full-page reload. */
  const locateSession = useCallback((sessionId: string, workspaceId: string, seq?: number, query?: string, messageId?: string, partId?: string) => {
    // A workspace-search locate: back from the located chat returns to the
    // search results (restored surface) rather than the plain roster.
    // Freeze the search snapshot NOW — the immediate navigate remounts the
    // roster, whose fresh-instance snapshot report would overwrite the live
    // snapshot before the user backs out.
    locateFromSearchRef.current = true
    locateSearchSnapRef.current = { ...workspaceSearchSnapRef.current }
    setInitialWorkspaceId(workspaceId)
    setInitialSessionId(sessionId)
    // Replace the whole locate target atomically. A title hit or a cold hit
    // may have no seq; retaining the previous seq would focus an unrelated
    // message on the next navigation.
    setInitialFocusSeq(seq)
    focusSeqRef.current = seq
    focusQueryRef.current = query
    focusMessageIdRef.current = messageId
    focusPartIdRef.current = partId
    navigate({ kind: 'workspaces' })
  }, [navigate])

  /** Open a search hit that belongs to NO workspace (standalone session):
   *  the chat only needs the session, so navigate straight there; backing
   *  out returns to the roster with the search surface restored (same
   *  contract as a workspace-hop locate). */
  const openChatDirect = useCallback((hit: { sessionId: string; title?: string; snippet?: string }, seq?: number, query?: string, messageId?: string, partId?: string) => {
    locateFromSearchRef.current = true
    locateSearchSnapRef.current = { ...workspaceSearchSnapRef.current }
    const session: SessionView = {
      sessionId: hit.sessionId,
      title: hit.title ?? '匹配会话',
      ...(hit.snippet !== undefined && hit.snippet !== '' ? { preview: hit.snippet } : {}),
      updatedAt: 0,
      running: false,
      blank: false,
    }
    navigate({
      kind: 'chat',
      session,
      workspace: STANDALONE_WORKSPACE,
      ...(seq !== undefined ? { focusSeq: seq } : {}),
      ...(messageId !== undefined ? { focusMessageId: messageId } : {}),
      ...(partId !== undefined ? { focusPartId: partId } : {}),
      ...(query !== undefined ? { focusQuery: query } : {}),
    })
  }, [navigate])

  /** Open a session from the global run-overview: back returns to the
   *  overview (the session may live in any workspace, so it rides the
   *  standalone chat shape — the overview page is its own list level). */
  const openOverviewChat = useCallback((hit: { sessionId: string; title?: string }) => {
    const session: SessionView = {
      sessionId: hit.sessionId,
      title: hit.title ?? '会话',
      updatedAt: 0,
      running: false,
      blank: false,
    }
    navigate({
      kind: 'chat',
      session,
      workspace: STANDALONE_WORKSPACE,
      fromRunOverview: true,
    })
  }, [navigate])

  /** 打开某个子代理自己的会话（只读）：子代理就是子会话，按 sessionId 读它的日志。 */
  const openSubagent = useCallback((hit: { sessionId: string; label?: string; parentTitle?: string }) => {
    navigate({
      kind: 'sub-chat',
      sessionId: hit.sessionId,
      ...(hit.label === undefined ? {} : { label: hit.label }),
      ...(hit.parentTitle === undefined ? {} : { parentTitle: hit.parentTitle }),
    })
  }, [navigate])

  // 正开着的会话：它收工时不弹浮层（人已经在看那一页了）。
  openSessionRef.current = route.kind === 'chat' ? route.session.sessionId : undefined

  const routeKey = route.kind === 'chat'
    ? `chat:${route.session.sessionId}`
    : route.kind === 'sessions'
      ? `sessions:${route.workspace.workspaceId}`
      : route.kind
  const leavingKey = transition.leaving !== undefined
    ? (transition.leaving.route.kind === 'chat'
      ? `chat:${transition.leaving.route.session.sessionId}`
      : transition.leaving.route.kind === 'sessions'
        ? `sessions:${transition.leaving.route.workspace.workspaceId}`
        : transition.leaving.route.kind)
    : ''
  const dirClass = forward ? 'fwd' : 'back'
  const renderRoute = (route: Route): ReactNode => route.kind === 'workspaces'
    ? (
      <WorkspaceRoster
        initialWorkspaceId={initialWorkspaceId}
        initialSearch={restoreSearch}
        onPick={openWorkspace}
        onLocateSession={locateSession}
        onOpenDirect={openChatDirect}
        onOpenRunOverview={() => { navigate({ kind: 'run-overview' }) }}
        runOverviewLive={runOverviewLive}
        onSearchSnapshot={(open, term) => { workspaceSearchSnapRef.current = { open, term } }}
        onSearchApplied={() => { setRestoreSearch(undefined) }}
      />
    )
    : route.kind === 'run-overview'
      ? <RunOverviewView
        mux={muxRef.current}
        onBack={back}
        onOpenSession={openOverviewChat}
        onOpenSubagent={openSubagent}
      />
      : route.kind === 'sessions'
        ? (
        <SessionListView
          workspace={route.workspace}
          mux={muxRef.current}
          bridge={bridgeRef.current}
          initialSessionId={initialSessionId}
          onBack={back}
          onPick={(session) => { openChat(session, route.workspace, focusSeqRef.current, focusQueryRef.current, focusMessageIdRef.current, focusPartIdRef.current) }}
          onOpenSettings={() => { navigate({ kind: 'settings', workspace: route.workspace }) }}
          onLocateSession={locateSession}
          onPickSeq={(session, seq, query, messageId, partId) => { openChat(session, route.workspace, seq, query, messageId, partId) }}
        />
      )
      : route.kind === 'settings'
        ? <SettingsView
          onBack={back}
        />
        : route.kind === 'sub-chat'
          ? <SubChatView
            sessionId={route.sessionId}
            {...(route.label === undefined ? {} : { label: route.label })}
            {...(route.parentTitle === undefined ? {} : { parentTitle: route.parentTitle })}
            onBack={back}
          />
          : <ChatView
            session={route.session}
            initialFocusSeq={route.focusSeq}
            initialFocusMessageId={route.focusMessageId}
            initialFocusPartId={route.focusPartId}
            initialFocusQuery={route.focusQuery}
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
              if (hit !== undefined) openOverviewChat({ sessionId: hit.sessionId, title: hit.title })
            }}
            onDismissFinished={() => { setChatFinished(undefined) }}
          />

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
      {finishToast !== undefined && route.kind !== 'chat' && route.kind !== 'sub-chat' && (
        <Button
          type="button"
          className="finish-toast"
          onClick={() => {
            const hit = finishToast
            dismissFinishToast()
            openOverviewChat({ sessionId: hit.sessionId, title: hit.title })
          }}
        >
          <StatusGlyph status={finishToast.status} />
          <span className="finish-toast-title">
            {finishToast.title}
            {' · '}
            {finishToast.status === 'error' ? '出错退出' : finishToast.status === 'stopped' ? '已中断' : '已完成'}
          </span>
          {finishToast.durationMs !== undefined && (
            <span className="finish-toast-dur">{formatRunDuration(finishToast.durationMs)}</span>
          )}
          <span className="finish-toast-chev" aria-hidden>›</span>
        </Button>
      )}
      <ToastHost />
    </div>
  )
}
