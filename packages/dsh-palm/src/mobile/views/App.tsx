/**
 * Mobile surface root: the view state machine (workspaces → sessions →
 * chat) and the top-level data flows. Deliberately plain React state — no
 * router, no state library: the surface is three fixed levels with a back
 * affordance, and every piece of data is fetched on demand.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { WorkspaceView as WorkspaceRow } from '@deepseek-ai/dsh-host-apiproxy/api/workspace'
import {
  fetchMobilePreferences,
  history as fetchHistory,
  prompt,
  readChat,
  readSettings,
  type ChatPage,
} from '../api.ts'
import { EventFolder, foldEvents, lastOpenTurnStartTime, latestTodoSnapshot, type RenderMessage, type TodoSnapshot } from '../messages.ts'
import type { SessionProjectionsBlock } from '@deepseek-ai/dsh-host-apiproxy/api/sessions'
import { getShowSystemMessages, getShowToolCalls, setShowSystemMessages, setShowToolCalls } from '../display-prefs.ts'
import { MuxClient } from '../mux.ts'
import { startNotify } from '../notify.ts'
import { applyHostThemePreference } from '../mobile-theme.ts'
import { RpcCallError, RpcTransportError } from '../rpc.ts'
import { clearPairingCaches } from '../list-persist.ts'
import { ToastHost } from '../toast.tsx'
import { ChatView } from './ChatView.tsx'
import { SessionListView } from './SessionListView.tsx'
import { SettingsView } from './SettingsView.tsx'
import { WorkspaceView as WorkspaceRoster } from './WorkspaceView.tsx'
import { PairRequiredView } from '../PairRequiredView.tsx'

/** One navigation level. */
type Route =
  | { kind: 'workspaces' }
  | { kind: 'sessions'; workspace: WorkspaceRow }
  | { kind: 'settings'; workspace: WorkspaceRow }
  | { kind: 'chat'; session: SessionView; workspace: WorkspaceRow; focusSeq?: number; focusMessageId?: string; focusPartId?: string; focusQuery?: string }

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

/** The session-list row model (list + chat share it). */
export interface SessionView {
  sessionId: string
  title: string
  /** Latest-message preview from the host projection (absent most of the time). */
  preview?: string
  /** Turn count from the sessionStats projection (preview fallback line). */
  turns?: number
  cwd?: string
  updatedAt: number
  running: boolean
  blank: boolean
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

/** Map a list row to the surface model; the title comes from projections when present. */
export function toSessionView(item: {
  sessionId: string
  updatedAt: number
  running: boolean
  blank: boolean
  cwd?: string
  projections?: { values?: Record<string, unknown> }
}): SessionView {
  const values = item.projections?.values
  const titleValue = values?.title
  const title = typeof titleValue === 'string' && titleValue !== ''
    ? titleValue
    : item.cwd !== undefined ? item.cwd.split('/').filter(Boolean).at(-1) ?? item.cwd : '新会话'
  const previewValue = values?.preview
  const stats = values?.sessionStats
  const turns = typeof stats === 'object' && stats !== null
    ? (stats as Record<string, unknown>).turns
    : undefined
  return {
    sessionId: item.sessionId,
    title,
    ...(typeof previewValue === 'string' && previewValue !== '' ? { preview: previewValue } : {}),
    ...(typeof turns === 'number' && turns > 0 ? { turns } : {}),
    ...(item.cwd !== undefined ? { cwd: item.cwd } : {}),
    updatedAt: item.updatedAt,
    running: item.running,
    blank: item.blank,
  }
}

/** Human clock, e.g. "14:05" or "昨天 20:31". */
export function formatTime(epochMs: number): string {
  const date = new Date(epochMs)
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return clock
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${clock}`
  return `${String(date.getMonth() + 1)}月${String(date.getDate())}日 ${clock}`
}

/** Full timestamp for roster rows, e.g. "08-29 14:05" (year added when not
 * the current one) — same-named sessions stay distinguishable by date. */
export function formatFullTime(epochMs: number): string {
  const date = new Date(epochMs)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  const year = date.getFullYear()
  return year === new Date().getFullYear()
    ? `${month}-${day} ${clock}`
    : `${year}-${month}-${day} ${clock}`
}

/** Props accepted by the mobile root before it begins paired-device RPC calls. */
export interface AppProps {
  initialPairError?: string
}

/** Navigation depth of each route kind (drives the slide direction). */
const ROUTE_DEPTH = { workspaces: 0, sessions: 1, settings: 2, chat: 2 } as const

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

  useEffect(() => {
    let current = true
    void fetchMobilePreferences().then(
      () => { if (current) setPairState('paired') },
      (error: unknown) => { if (current) setPairState(mobilePairStateForError(error)) },
    )
    return () => { current = false }
  }, [])

  // Pairing eviction (v3.3): a revoked/unpaired device must not keep
  // another device's persisted sessions — clear the local caches the moment
  // the pair state turns out to be broken (or is re-established).
  useEffect(() => {
    if (pairState === 'unpaired') clearPairingCaches()
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
          // identity's persisted sessions before the reload lands.
          clearPairingCaches()
          window.location.replace(path)
        }}
      />
    )
  }
  if (pairState === 'unavailable') {
    return (
      <main className="mobile mobile-empty">
        <p className="mobile-error" role="alert">无法连接到运行中的 DSH host。</p>
        <button className="mobile-new" type="button" onClick={() => { window.location.reload() }}>重试</button>
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

/** The existing remote mobile surface, mounted only after device pairing succeeds. */
function PairedApp({ onUnpaired }: { onUnpaired: () => void }) {
  const [transition, setTransition] = useState<TransitionState>({
    current: { route: { kind: 'workspaces' }, forward: true },
    leaving: undefined,
  })
  const route = transition.current.route
  const forward = transition.current.forward
  const exitTimerRef = useRef<number | undefined>(undefined)
  const [initialWorkspaceId, setInitialWorkspaceId] = useState<string | undefined>(
    () => mobileWorkspaceTarget(window.location.search),
  )
  const [initialSessionId, setInitialSessionId] = useState<string | undefined>(
    () => mobileSessionTarget(window.location.search),
  )
  /** Message-seq target from a locate link; consumed by the first chat open. */
  const [initialFocusSeq, setInitialFocusSeq] = useState<number | undefined>(
    () => mobileFocusSeqTarget(window.location.search),
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
  /** Live in-list search surface, reported by the open session list (tagged
   *  with its workspace so a different workspace's list never restores it). */
  const listSearchSnapRef = useRef({ workspaceId: '', open: false, term: '' })
  /** One-shot restore of the in-list search surface on returning to a list. */
  const [restoreListSearch, setRestoreListSearch] = useState<{ open: boolean; term: string } | undefined>(undefined)
  /** Whether the current chat was reached through a workspace-search locate,
   *  so backing out returns to the search results instead of the plain list. */
  const locateFromSearchRef = useRef(false)
  const muxRef = useRef<MuxClient | undefined>(undefined)
  // Message-visibility prefs live here (shared by the chat and the settings
  // page) and persist on the /m origin through display-prefs.
  const [showToolCalls, setShowToolCallsState] = useState(() => getShowToolCalls())
  const [showSystemMessages, setShowSystemMessagesState] = useState(() => getShowSystemMessages())
  const handleToolCalls = useCallback((value: boolean) => {
    setShowToolCalls(value)
    setShowToolCallsState(value)
  }, [])
  const handleSystemMessages = useCallback((value: boolean) => {
    setShowSystemMessages(value)
    setShowSystemMessagesState(value)
  }, [])

  useEffect(() => () => {
    if (exitTimerRef.current !== undefined) clearTimeout(exitTimerRef.current)
  }, [])

  /** Drop the leaving page once its exit animation has played. */
  const scheduleExitCleanup = useCallback(() => {
    if (exitTimerRef.current !== undefined) clearTimeout(exitTimerRef.current)
    exitTimerRef.current = window.setTimeout(() => {
      setTransition(state => ({ current: state.current, leaving: undefined }))
    }, PAGE_TRANSITION_MS)
  }, [])

  /** Set the route: current page plays the exit animation, next one slides in. */
  const navigate = useCallback((next: Route) => {
    setTransition(previous => {
      const nextForward = ROUTE_DEPTH[next.kind] >= ROUTE_DEPTH[previous.current.route.kind]
      return {
        current: { route: next, forward: nextForward },
        leaving: previous.current,
      }
    })
    scheduleExitCleanup()
  }, [scheduleExitCleanup])

  // The mux stream lives for the page lifetime: session events keep the
  // open chat live, and reconnect is automatic. If the polling fallback hits a
  // terminal (unpaired) error — the device was revoked or remote control
  // stopped — the client stops itself and we drop back to the pairing screen
  // instead of polling forever into a 60 s backoff.
  useEffect(() => {
    const mux = new MuxClient(undefined, { onUnpaired })
    muxRef.current = mux
    mux.start()
    return () => { mux.stop() }
  }, [onUnpaired])

  // The L1 completion-notify channel: starts once the page is paired and the
  // browser granted notification permission (the settings page asks). The
  // server decides what to notify; this only delivers.
  useEffect(() => {
    startNotify()
  }, [])

  // Keep the live-event client pointed at the session currently on screen so
  // its polling fallback can keep that chat fresh over SSE-impairing tunnels
  // (quick tunnel / Tailscale Serve do not forward Server-Sent Events).
  useEffect(() => {
    muxRef.current?.observe(route.kind === 'chat' ? route.session.sessionId : undefined)
  }, [route])

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

  /** Arm the one-shot in-list search restore for the workspace being
   *  returned to: the snapshot must both be open and belong to that list. */
  const armListSearchRestore = (workspaceId: string): void => {
    const snap = listSearchSnapRef.current
    setRestoreListSearch(snap.workspaceId === workspaceId && snap.open ? { open: true, term: snap.term } : undefined)
  }

  const back = useCallback(() => {
    // Compute the search-surface restore from the CURRENT route (a click
    // handler runs after a render, so `route` is current) and apply it
    // OUTSIDE the transition updater — updaters must stay pure, and calling
    // a setter inside one is a side effect (StrictMode runs updaters twice).
    if (locateFromSearchRef.current) {
      // Reached from a workspace-search locate: restore the roster search.
      setRestoreSearch({ ...locateSearchSnapRef.current })
    } else if (route.kind === 'chat' && route.workspace.workspaceId !== STANDALONE_WORKSPACE.workspaceId) {
      // Returning to a plain list restores that list's search surface
      // (a chat opened out of an active search comes back to it).
      armListSearchRestore(route.workspace.workspaceId)
    } else if (route.kind === 'settings') {
      armListSearchRestore(route.workspace.workspaceId)
    }
    setTransition(previous => {
      const route = previous.current.route
      if (route.kind === 'chat') {
        if (locateFromSearchRef.current) {
          // Reached from a workspace-search locate: go straight back to the
          // roster with the search surface restored (one back press), instead
          // of stepping through the intermediate session list.
          locateFromSearchRef.current = false
          return {
            current: { route: { kind: 'workspaces' }, forward: false },
            leaving: previous.current,
          }
        }
        if (route.workspace.workspaceId === STANDALONE_WORKSPACE.workspaceId) {
          // A standalone chat has no session list behind it: return to the
          // roster instead of a phantom empty list.
          return {
            current: { route: { kind: 'workspaces' }, forward: false },
            leaving: previous.current,
          }
        }
        return {
          current: { route: { kind: 'sessions', workspace: route.workspace }, forward: false },
          leaving: previous.current,
        }
      }
      if (route.kind === 'settings') {
        return {
          current: { route: { kind: 'sessions', workspace: route.workspace }, forward: false },
          leaving: previous.current,
        }
      }
      if (route.kind === 'sessions') {
        return {
          current: { route: { kind: 'workspaces' }, forward: false },
          leaving: previous.current,
        }
      }
      return previous
    })
    scheduleExitCleanup()
  }, [route, scheduleExitCleanup])

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

  const openWorkspace = useCallback((workspace: WorkspaceRow) => {
    if (initialWorkspaceId !== undefined || initialSessionId !== undefined) {
      const url = new URL(window.location.href)
      url.searchParams.delete('workspace')
      url.searchParams.delete('session')
      url.searchParams.delete('seq')
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
        onSearchSnapshot={(open, term) => { workspaceSearchSnapRef.current = { open, term } }}
        onSearchApplied={() => { setRestoreSearch(undefined) }}
      />
    )
    : route.kind === 'sessions'
      ? (
        <SessionListView
          workspace={route.workspace}
          initialSessionId={initialSessionId}
          initialSearch={restoreListSearch}
          onBack={back}
          onPick={(session) => { openChat(session, route.workspace, focusSeqRef.current, focusQueryRef.current, focusMessageIdRef.current, focusPartIdRef.current) }}
          onOpenSettings={() => { navigate({ kind: 'settings', workspace: route.workspace }) }}
          onLocateSession={locateSession}
          onPickSeq={(session, seq, query, messageId, partId) => { openChat(session, route.workspace, seq, query, messageId, partId) }}
          onSearchSnapshot={(open, term) => { listSearchSnapRef.current = { workspaceId: route.workspace.workspaceId, open, term } }}
          onSearchApplied={() => { setRestoreListSearch(undefined) }}
        />
      )
      : route.kind === 'settings'
        ? <SettingsView
          onBack={back}
          showToolCalls={showToolCalls}
          showSystemMessages={showSystemMessages}
          onToolCalls={handleToolCalls}
          onSystemMessages={handleSystemMessages}
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
        />

  return (
    <div className="mobile">
      <div className="page-stage">
        {/* Same key as the current slot: React's keyed reconciliation moves the
            existing instance into the leaving slot instead of re-mounting it.
            A remount would re-run ChatView's tail load (a duplicate history
            fetch + mux resubscribe) on every back-from-chat. */}
        {transition.leaving !== undefined && (
          <div key={leavingKey} className={`page page-exit-${dirClass}`} aria-hidden="true">
            {renderRoute(transition.leaving.route)}
          </div>
        )}
        <div key={routeKey} className={`page page-enter-${dirClass}`}>
          {renderRoute(route)}
        </div>
      </div>
      <ToastHost />
    </div>
  )
}

/** Shared error text for the surface's small failure affordances. */
export function errorText(error: unknown): string {
  if (error instanceof RpcCallError) return error.error.message
  if (error instanceof RpcTransportError) return error.message
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Actionable hint for transport-level 403s on host-gated channels (model
 * picker, session creation): the phone's UI bundle is served fresh from disk
 * per request, while the host-side allowlist lives in the long-running
 * process — a rebuild without a restart shows the new surface against the
 * old allowlist (HTTP 403 forbidden).
 */
export function staleHostHint(message: string): string | undefined {
  return /^HTTP 403/.test(message)
    ? '宿主端插件可能仍在运行旧版本：请重启 dsh web 后再试。'
    : undefined
}

/** Fetch one history page (tail by default) — thin wrapper so views share the call shape. */
export function loadHistory(sessionId: string, beforeSeq?: number, signal?: AbortSignal) {
  return fetchHistory(sessionId, beforeSeq, undefined, signal)
}

/** One folded chat page as the surface consumes it (any source). */
export interface ChatPageResult {
  rows: RenderMessage[]
  /** Event-seq watermark (replay floor for restoring the live folder). */
  maxSeq: number
  hasMore: boolean
  todo?: TodoSnapshot
  projections?: SessionProjectionsBlock
  /** The running turn's logged `turn/start` time (epoch ms), when the tail
   *  window holds an open turn boundary — the turn-clock anchor (desktop
   *  parity). Only the tail page may carry it (an older page's boundary is
   *  not the open one). */
  turnStartAt?: number
}

/** The fallback fold of a raw history page (host lacks/refused readChat). */
function foldHistoryPage(page: Awaited<ReturnType<typeof fetchHistory>>, isTail: boolean): ChatPageResult {
  const events = page.events.map(entry => (
    { ...entry.event, ...(entry.view !== undefined ? { view: entry.view } : {}) }
  ))
  const folder = new EventFolder(foldEvents(events))
  const todo = latestTodoSnapshot(events)
  const turnStartAt = lastOpenTurnStartTime(events)
  return {
    rows: folder.snapshot(),
    maxSeq: folder.lastSeq,
    hasMore: page.hasMore,
    ...(todo === undefined ? {} : { todo }),
    ...(isTail && turnStartAt !== undefined ? { turnStartAt } : {}),
    ...(page.projections === undefined ? {} : { projections: page.projections }),
  }
}

/**
 * Fetch one folded chat page (v3): `mobile.readChat` first (host-folded
 * rows, mux-fed window cache), with an automatic fallback to the raw
 * `session.history` + local fold when the host answers unavailable or the
 * read fails — the two paths converge on the same {@link ChatPageResult}
 * shape, so the surface never has to know which one served it.
 */
export async function loadChatPage(
  sessionId: string,
  beforeSeq?: number,
  signal?: AbortSignal,
): Promise<ChatPageResult> {
  const isTail = beforeSeq === undefined
  try {
    const page: ChatPage = await readChat(sessionId, beforeSeq, undefined, signal)
    return {
      rows: page.rows,
      maxSeq: page.maxSeq,
      hasMore: page.hasMore,
      ...(page.todo === undefined ? {} : { todo: page.todo }),
      ...(page.projections === undefined ? {} : { projections: page.projections }),
      ...(isTail && page.turnStartAt !== undefined ? { turnStartAt: page.turnStartAt } : {}),
    }
  } catch {
    // Fallback: the raw event page folded locally (identical shape). Any
    // failure of THIS path propagates to the caller's own error handling.
    return foldHistoryPage(await fetchHistory(sessionId, beforeSeq, undefined, signal), isTail)
  }
}

export { prompt }
