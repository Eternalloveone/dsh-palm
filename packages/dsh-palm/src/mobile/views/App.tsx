/**
 * Mobile surface root: the view state machine (workspaces → sessions →
 * chat) and the top-level data flows. Deliberately plain React state — no
 * router, no state library: the surface is three fixed levels with a back
 * affordance, and every piece of data is fetched on demand.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { WorkspaceView as WorkspaceRow } from '@deepseek-ai/dsh-host-apiproxy/api/workspace'
import { fetchMobilePreferences, history as fetchHistory, prompt, readSettings } from '../api.ts'
import { getShowSystemMessages, getShowToolCalls, setShowSystemMessages, setShowToolCalls } from '../display-prefs.ts'
import { MuxClient } from '../mux.ts'
import { startNotify } from '../notify.ts'
import { applyHostThemePreference } from '../mobile-theme.ts'
import { RpcCallError, RpcTransportError } from '../rpc.ts'
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
  | { kind: 'chat'; session: SessionView; workspace: WorkspaceRow }

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

  if (pairState === 'checking') {
    return (
      <main className="mobile mobile-empty" role="status">
        <span className="boot-dot" aria-hidden />
        <p className="mobile-muted">正在连接...</p>
      </main>
    )
  }
  if (pairState === 'unpaired') {
    return <PairRequiredView initialError={initialPairError} onPaired={(path) => { window.location.replace(path) }} />
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

  const back = useCallback(() => {
    setTransition(previous => {
      const route = previous.current.route
      if (route.kind === 'chat') {
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
  }, [scheduleExitCleanup])

  const openChat = useCallback((session: SessionView, workspace: WorkspaceRow) => {
    navigate({ kind: 'chat', session, workspace })
  }, [navigate])

  const openWorkspace = useCallback((workspace: WorkspaceRow) => {
    if (initialWorkspaceId !== undefined || initialSessionId !== undefined) {
      const url = new URL(window.location.href)
      url.searchParams.delete('workspace')
      url.searchParams.delete('session')
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
      setInitialWorkspaceId(undefined)
      setInitialSessionId(undefined)
    }
    navigate({ kind: 'sessions', workspace })
  }, [initialWorkspaceId, initialSessionId, navigate])

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
    ? <WorkspaceRoster initialWorkspaceId={initialWorkspaceId} onPick={openWorkspace} />
    : route.kind === 'sessions'
      ? (
        <SessionListView
          workspace={route.workspace}
          initialSessionId={initialSessionId}
          onBack={back}
          onPick={(session) => { openChat(session, route.workspace) }}
          onOpenSettings={() => { navigate({ kind: 'settings', workspace: route.workspace }) }}
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

export { prompt }
