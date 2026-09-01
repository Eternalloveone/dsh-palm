/**
 * The sidebar remote-control seat: the phone-icon trigger beside the
 * settings button, and the pairing panel modal. Owns the panel behavior —
 * token minting on open, the status SSE subscription, stop/refresh/copy —
 * and renders the pure {@link RemotePanel} body. Component-local state per
 * the client stack rules: nothing here survives remounts or crosses entries.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PairingPhase } from '../pairing.ts'
import { RemotePanel, type PanelState } from './RemotePanel.tsx'
import { copyText, fetchPairStatus, fetchTunnelDetection, issuePair, revokePair, stopPair, type DeviceFrame, type IssueResponse, type PairStateFrame, type TunnelDetection } from './pair-api.ts'
import { PhoneIcon } from './PhoneIcon.tsx'
import css from './remote.module.css'

/** Entry props: the sidebar column state + the standard locale seat. */
export type RemoteEntryProps = PropsRuntime<'sidebar.remote'> & PropsLocale<'remote'> & {
  /** Persist a new public (tunneled) base URL (writes the settings section). */
  onSavePublicUrl(url: string): Promise<void>
  /** Clear the configured public (tunneled) base URL. */
  onClearPublicUrl(): Promise<void>
}

/** localStorage key marking the first-run welcome as seen. */
const WELCOME_SEEN_KEY = 'dsh-palm:welcome-seen'

/**
 * Apply one status frame onto the current state: the ready state mirrors
 * the full phase/device picture; other banner states ignore frames (the
 * snapshot on open is authoritative). A tokenId change means another window
 * re-issued the pairing code — this panel's QR is stale until refreshed.
 */
function mergeFrame(state: PanelState, frame: PairStateFrame): PanelState {
  if (state.kind !== 'ready') return state
  const stale = frame.tokenId !== undefined && state.tokenId !== undefined && frame.tokenId !== state.tokenId
  return {
    ...state,
    phase: frame.phase,
    deviceCount: frame.deviceCount,
    onlineCount: frame.onlineCount,
    devices: frame.devices ?? [],
    ...(frame.tokenId !== undefined ? { tokenId: frame.tokenId } : {}),
    ...(stale ? { stale: true } : {}),
  }
}

/**
 * Render the remote-control trigger and panel.
 * @param props - composed slot props (contract in this package).
 * @returns the entry element tree.
 */
export function RemoteEntry({ wide, useWorkspaces, t, onSavePublicUrl, onClearPublicUrl }: RemoteEntryProps) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<PanelState>({ kind: 'lan-required' })
  const [copied, setCopied] = useState<'phone' | 'desktop' | undefined>(undefined)
  // Whether a phone-reachable address exists (drives the trigger's
  // unconfigured dot). Defaults to configured so the dot never blinks on
  // mount; the loopback status query corrects it right after.
  const [configured, setConfigured] = useState(true)
  // Tunnel hints for the onboarding card (Tailscale / frp / Cloudflare).
  const [detection, setDetection] = useState<TunnelDetection>({ frpc: false, cloudflared: false })
  // First-run welcome banner: shown until dismissed once (localStorage).
  const [showWelcome, setShowWelcome] = useState(() => {
    try {
      return window.localStorage.getItem(WELCOME_SEEN_KEY) === null
    } catch {
      return false
    }
  })
  const eventSource = useRef<EventSource | undefined>(undefined)
  // Generation counter for the open flow: closing (or re-opening) the panel
  // bumps it, so an in-flight issue() that resolves after a close does not
  // spawn a stray EventSource.
  const openSeq = useRef(0)

  // The current workspace (the recent-workspace projection the shell's New
  // Session flow targets) — the deep-link target for the phone.
  const workspaceId = useWorkspaces(s => s.recentWorkspaceId)

  // Unconfigured dot: read the loopback status once on mount so the trigger
  // reflects the real configuration state without opening the panel.
  useEffect(() => {
    let cancelled = false
    void fetchPairStatus().then(({ configured: ready }) => {
      if (!cancelled) setConfigured(ready)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const closeEventSource = useCallback(() => {
    eventSource.current?.close()
    eventSource.current = undefined
  }, [])

  const mint = useCallback(async (address?: string): Promise<PanelState> => {
    let result: IssueResponse
    try {
      result = await issuePair(workspaceId, address)
    } catch {
      // Fetch/network failure: show an explicit state instead of silently
      // leaving the panel on its initial banner.
      return { kind: 'unreachable' }
    }
    if (!result.ok) {
      // 403 is the loopback-only fence refusing a LAN origin (the panel is a
      // desktop control endpoint); 409 means the server never bound 0.0.0.0;
      // 400 means the requested LAN literal is no longer constructible.
      if (result.code === 'forbidden') return { kind: 'loopback-required' }
      if (result.code === 'unknown-address') return { kind: 'unreachable' }
      setConfigured(false)
      return { kind: 'lan-required' }
    }
    setConfigured(true)
    const publicBaseUrl = result.publicBaseUrl
    return {
      kind: 'ready',
      url: result.url,
      code: result.code ?? '',
      expiresAt: result.expiresAt,
      expired: Date.now() > result.expiresAt,
      phase: 'waiting',
      deviceCount: 0,
      onlineCount: 0,
      devices: [] as DeviceFrame[],
      // Whether this QR is built on the configured public (tunneled) base.
      public: publicBaseUrl !== undefined && result.url.startsWith(publicBaseUrl),
      ...(publicBaseUrl !== undefined ? { publicBaseUrl } : {}),
      // The issued URL names the requested (or default first) literal; the
      // public link has no LAN literal, so no radio row is selected then.
      address: address ?? result.lanAddresses[0] ?? '',
      lanAddresses: result.lanAddresses,
    }
  }, [workspaceId])

  const openPanel = useCallback(async (): Promise<void> => {
    const seq = ++openSeq.current
    setOpen(true)
    // Tunnel hints refresh on every open so a tunnel started meanwhile shows up.
    void fetchTunnelDetection().then((frame) => {
      if (seq === openSeq.current) setDetection(frame)
    }).catch(() => {})
    const next = await mint()
    // A close (or re-open) during the await invalidates this issue: skip the
    // state write and the stream so a panel closed mid-mint neither leaks an
    // EventSource nor resurrects a stale QR.
    if (seq !== openSeq.current) return
    setState(next)
    // Live status: the desktop panel mirrors the pairing service state. The
    // stream only makes sense once a QR exists; the loopback-required and
    // unreachable origins are fenced out of the events endpoint, so opening
    // it there would just start a doomed reconnect loop.
    if (next.kind !== 'ready') return
    const source = new EventSource('/api/pair/events')
    eventSource.current = source
    source.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data as string) as PairStateFrame
        if (frame.type !== 'state') return
        setState(current => mergeFrame(current, frame))
      } catch {
        // Malformed frames are dropped; the snapshot on open is authoritative.
      }
    }
  }, [mint])

  const closePanel = useCallback(() => {
    openSeq.current += 1
    closeEventSource()
    setOpen(false)
  }, [closeEventSource])

  // Expiry flip: one timeout per token lifetime (reset by refresh).
  useEffect(() => {
    if (state.kind !== 'ready') return
    if (state.expired) return
    const delay = state.expiresAt - Date.now()
    if (delay <= 0) {
      setState(previous => previous.kind === 'ready' ? { ...previous, expired: true } : previous)
      return
    }
    const timer = window.setTimeout(() => {
      setState(previous => previous.kind === 'ready' ? { ...previous, expired: true } : previous)
    }, delay)
    return () => { window.clearTimeout(timer) }
  }, [state])

  // Unmount safety: never leave the stream open.
  useEffect(() => closeEventSource, [closeEventSource])

  const handleStop = useCallback(() => {
    // A failed stop request is harmless: the optimistic phase flip below
    // keeps the UI honest, and the status stream confirms the stopped phase.
    void stopPair().catch(() => {})
    // Optimistic fallback; the status stream confirms with the stopped phase.
    setState(previous => previous.kind === 'ready' ? { ...previous, phase: 'stopped' as PairingPhase, devices: [] } : previous)
  }, [])

  const handleRevoke = useCallback((deviceId: string) => {
    // Optimistic removal, rolled back when the revoke request fails — a
    // swallowed failure would silently resurrect the device on the next
    // status frame and leave the roster lying.
    const snapshot = state.kind === 'ready' ? state.devices : undefined
    setState(previous => previous.kind === 'ready'
      ? { ...previous, devices: previous.devices.filter(device => device.id !== deviceId) }
      : previous)
    void revokePair(deviceId).catch(() => {
      if (snapshot !== undefined) {
        setState(previous => previous.kind === 'ready'
          ? { ...previous, devices: snapshot }
          : previous)
      }
    })
  }, [state])

  const handleRefresh = useCallback(() => {
    void mint().then(setState)
  }, [mint])

  /** Re-mint against another LAN literal (multi-homed machines). */
  const handlePickAddress = useCallback((address: string) => {
    void mint(address).then(setState)
  }, [mint])

  /** Re-mint against the configured public (tunneled) base. */
  const handlePickPublic = useCallback(() => {
    void mint().then(setState)
  }, [mint])

  /** Persist a new public base URL, then re-mint so the QR reflects it. */
  const handleSavePublicUrl = useCallback(async (url: string): Promise<void> => {
    await onSavePublicUrl(url)
    const next = await mint()
    setState(next)
  }, [onSavePublicUrl, mint])

  /** Clear the public base URL, then re-mint on the LAN base. */
  const handleClearPublicUrl = useCallback(async (): Promise<void> => {
    await onClearPublicUrl()
    const next = await mint()
    setState(next)
  }, [onClearPublicUrl, mint])

  const handleCopy = useCallback((target: 'phone' | 'desktop', url: string) => {
    void copyText(url).then((ok) => {
      if (!ok) return
      setCopied(target)
      window.setTimeout(() => { setCopied(undefined) }, 2000)
    })
  }, [])

  const dismissWelcome = useCallback(() => {
    try {
      window.localStorage.setItem(WELCOME_SEEN_KEY, '1')
    } catch {
      // Storage unavailable: the banner simply reappears next time.
    }
    setShowWelcome(false)
  }, [])

  return (
    <>
      <div className={css.entryRow} data-rail={wide ? undefined : 'rail'}>
        <TooltipAnchor wide={wide} label={t('entry.label')} onClick={openPanel} expanded={open} unconfigured={!configured} />
      </div>
      {open && createPortal((
        <div className={css.overlay} role="presentation">
          <div className={css.mask} aria-hidden="true" onClick={closePanel} />
          <RemotePanel
            t={t}
            state={state}
            copied={copied}
            detection={detection}
            showWelcome={showWelcome}
            onDismissWelcome={dismissWelcome}
            onClose={closePanel}
            onStop={handleStop}
            onRefresh={handleRefresh}
            onCopy={handleCopy}
            onPickAddress={handlePickAddress}
            onPickPublic={handlePickPublic}
            onSavePublicUrl={handleSavePublicUrl}
            onClearPublicUrl={handleClearPublicUrl}
            onRevoke={handleRevoke}
          />
        </div>
      ), document.body)}
    </>
  )
}

/** The trigger: an icon-only control with a persistent accessible label. */
function TooltipAnchor({ wide, label, onClick, expanded, unconfigured }: { wide: boolean; label: string; onClick: () => void; expanded: boolean; unconfigured: boolean }) {
  return (
    <button
      type="button"
      className={css.trigger}
      data-wide={wide ? 'wide' : 'rail'}
      aria-label={label}
      aria-expanded={expanded}
      title={label}
      onClick={onClick}
    >
      <PhoneIcon size={wide ? 16 : 18} />
      {unconfigured && <span className={css.triggerDot} data-testid="remote-unconfigured-dot" aria-hidden="true" />}
    </button>
  )
}
