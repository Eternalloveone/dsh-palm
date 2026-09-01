/**
 * The mobile remote-control panel body, organized as a three-step wizard:
 * ① configure (public address), ② pair (QR + code + links), ③ use (device
 * status + roster). The step indicator doubles as navigation — completed or
 * current steps are clickable, and the view follows the pairing state until
 * the user picks one manually. Pure presentation — all state and actions
 * arrive through props from the entry's behavior component.
 */
import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { QRCodeSVG } from 'qrcode.react'
import {
  IconCloseOutline16, IconCopyOutline16, IconRefreshOutline16, IconStopFill16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { PairingPhase } from '../pairing.ts'
import {
  desktopPairUrl,
  formatClock,
  formatLastSeen,
  type DeviceFrame,
  type TunnelDetection,
} from './pair-api.ts'
import { deviceNameFromUserAgent } from './device-name.ts'
import { PublicUrlConfig } from './PublicUrlConfig.tsx'
import css from './remote.module.css'

/** The panel's view state, owned by the entry component. */
export type PanelState =
  | { kind: 'lan-required' }
  | { kind: 'loopback-required' }
  | { kind: 'unreachable' }
  | {
      kind: 'ready'
      url: string
      /** Six-digit pairing code the phone can type instead of scanning. */
      code: string
      expiresAt: number
      expired: boolean
      phase: PairingPhase
      deviceCount: number
      onlineCount: number
      /** Authorized devices for the roster under the QR card. */
      devices: DeviceFrame[]
      /** The LAN literal the current QR was built from. */
      address: string
      /** Every constructible LAN literal (interface order). */
      lanAddresses: string[]
      /** Whether this QR is built on the configured public (tunneled) base. */
      public: boolean
      /** The configured public (tunneled) base URL, when present. */
      publicBaseUrl?: string
      /** The server-side token id this QR was minted from (events frames). */
      tokenId?: string
      /** Another window re-issued the pairing code; this QR is stale. */
      stale?: boolean
    }

/** Full panel props: copy + view state + actions. */
export interface RemotePanelProps {
  t: TranslateNS<'remote'>
  state: PanelState
  copied: 'phone' | 'desktop' | undefined
  /** Tunnel hints for the onboarding card (Tailscale / frp / Cloudflare). */
  detection: TunnelDetection
  /** Whether the first-run welcome banner should show. */
  showWelcome: boolean
  /** Dismiss the first-run welcome banner (persists the choice). */
  onDismissWelcome(): void
  onClose(): void
  onStop(): void
  onRefresh(): void
  onCopy(target: 'phone' | 'desktop', url: string): void
  /** Re-mint the QR against a different LAN address. */
  onPickAddress(address: string): void
  /** Re-mint the QR against the configured public (tunneled) base. */
  onPickPublic(): void
  /** Persist a new public (tunneled) base URL from the in-panel editor. */
  onSavePublicUrl(url: string): Promise<void>
  /** Clear the configured public (tunneled) base URL. */
  onClearPublicUrl(): Promise<void>
  /** Revoke one paired device. */
  onRevoke(deviceId: string): void
}

/** Badge text + tone per phase (ready states only). */
function statusOf(
  t: TranslateNS<'remote'>,
  state: Extract<PanelState, { kind: 'ready' }>,
): { text: string; tone: 'waiting' | 'connected' | 'disconnected' | 'stopped' } {
  switch (state.phase) {
    case 'connected': return { text: t('status.connected', { n: state.onlineCount }), tone: 'connected' }
    case 'disconnected': return { text: t('status.disconnected'), tone: 'disconnected' }
    case 'stopped': return { text: t('status.stopped'), tone: 'stopped' }
    case 'lan-required': return { text: t('status.lanRequired'), tone: 'stopped' }
    case 'waiting': return { text: t('status.waiting'), tone: 'waiting' }
  }
}

/** Group a six-digit code as "200 785" for readability. */
export function formatCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code
}

/**
 * The onboarding step the panel is on: 1 configure, 2 pair, 3 use. Returns
 * undefined for states outside the onboarding flow (loopback-required and
 * unreachable are access/connectivity problems, not configuration steps —
 * showing "configure" highlighted there would mislead a first-time user).
 */
export function stepOf(state: PanelState): { current: 1 | 2 | 3; done: [boolean, boolean, boolean] } | undefined {
  if (state.kind === 'lan-required') return { current: 1, done: [false, false, false] }
  if (state.kind !== 'ready') return undefined
  if (state.phase === 'connected' || state.phase === 'disconnected') {
    return { current: 3, done: [true, true, false] }
  }
  return { current: 2, done: [true, false, false] }
}

/** The three-step onboarding indicator; completed/current steps navigate. */
function Steps({ t, state, view, onStepClick }: {
  t: TranslateNS<'remote'>
  state: PanelState
  view: 1 | 2 | 3
  onStepClick(step: 1 | 2 | 3): void
}) {
  const step = stepOf(state)
  if (step === undefined) return null
  const { current, done } = step
  const labels = [t('steps.configure'), t('steps.pair'), t('steps.use')]
  return (
    <div className={css.steps} aria-label="setup steps">
      {labels.map((label, index) => {
        const n = (index + 1) as 1 | 2 | 3
        const complete = done[index]
        const clickable = n <= current
        return (
          <button
            key={label}
            type="button"
            className={clsx(
              css.step,
              n === view && css.stepActive,
              complete && css.stepDone,
              !clickable && css.stepLocked,
            )}
            disabled={!clickable}
            onClick={() => onStepClick(n)}
          >
            <span className={css.stepDot} aria-hidden="true">{complete ? '✓' : String(n)}</span>
            <span className={css.stepLabel}>{label}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Render the pairing panel.
 * @param props - copy, state, and actions.
 * @returns the panel element tree.
 */
export function RemotePanel({ t, state, copied, detection, showWelcome, onDismissWelcome, onClose, onStop, onRefresh, onCopy, onPickAddress, onPickPublic, onSavePublicUrl, onClearPublicUrl, onRevoke }: RemotePanelProps) {
  // The wizard view: follows the pairing state, overridable by clicking a
  // completed/current step (e.g. "re-pair" jumps back to step 2).
  const [view, setView] = useState<1 | 2 | 3>(1)
  const step = stepOf(state)
  useEffect(() => {
    if (step !== undefined) setView(step.current)
  }, [step?.current])

  // The countdown bar's duration is fixed per token lifetime: recomputing
  // Date.now() on every render would restart the CSS animation.
  const countdownMs = useMemo(
    () => (state.kind === 'ready' ? Math.max(0, state.expiresAt - Date.now()) : 0),
    [state.kind === 'ready' ? state.expiresAt : 0],
  )

  return (
    <div className={css.panel} role="dialog" aria-modal="true" aria-label={t('title')}>
      <div className={css.header}>
        <div className={css.heading}>
          <h2 className={css.title}>{t('title')}</h2>
          <p className={css.subtitle}>{t('subtitle')}</p>
        </div>
        <button type="button" className={css.close} aria-label={t('close.label')} onClick={onClose}>
          <IconCloseOutline16 size={14} />
        </button>
      </div>

      <Steps t={t} state={state} view={view} onStepClick={setView} />

      {showWelcome && (
        <div className={css.welcome} role="status">
          <span className={css.welcomeText}>{t('welcome.text')}</span>
          <button type="button" className={css.welcomeDismiss} onClick={onDismissWelcome}>
            {t('welcome.dismiss')}
          </button>
        </div>
      )}

      {state.kind === 'lan-required' ? (
        <>
          <div className={css.banner} role="alert">
            <p className={css.bannerTitle}>{t('status.lanRequired')}</p>
            <p className={css.bannerHint}>{t('status.lanRequiredHint')}</p>
          </div>
          {/* The banner points at the public-address card, so it must render
              here too — a first-time user needs the input right below the
              explanation, not hidden behind a ready state. */}
          <PublicUrlConfig
            t={t}
            current={undefined}
            detection={detection}
            onSave={onSavePublicUrl}
            onClear={onClearPublicUrl}
          />
        </>
      ) : state.kind === 'loopback-required' ? (
        <div className={css.banner} role="alert">
          <p className={css.bannerTitle}>{t('status.loopbackRequired')}</p>
          <p className={css.bannerHint}>{t('status.loopbackRequiredHint')}</p>
        </div>
      ) : state.kind === 'unreachable' ? (
        <div className={css.banner} role="alert">
          <p className={css.bannerTitle}>{t('status.unreachable')}</p>
          <p className={css.bannerHint}>{t('status.unreachableHint')}</p>
        </div>
      ) : (
        <>
          {view === 1 && (
            <>
              {state.publicBaseUrl !== undefined && (
                <div className={css.configNote}>
                  <p className={css.configNoteTitle}>{t('config.noteTitle')}</p>
                  <p className={css.configNoteBody}>
                    {t('config.noteBody', { url: state.publicBaseUrl })}
                  </p>
                </div>
              )}
              <PublicUrlConfig
                t={t}
                current={state.publicBaseUrl}
                detection={detection}
                onSave={onSavePublicUrl}
                onClear={onClearPublicUrl}
              />
            </>
          )}

          {view === 2 && (
            <>
              <div className={css.badges}>
                {state.public && <span className={clsx(css.badge, css.badgePublic)}>{t('public.badge')}</span>}
                <span className={clsx(css.badge, css[`badge-${statusOf(t, state).tone}`])}>
                  {statusOf(t, state).text}
                </span>
              </div>

              <div className={css.pairCard}>
                <div className={css.qrWrap} data-testid="remote-qr">
                  <QRCodeSVG value={state.url} size={168} level="M" marginSize={1} className={css.qr} />
                </div>
                {!state.expired && countdownMs > 0 && (
                  <div className={css.progressTrack} aria-hidden="true">
                    <div className={css.progressBar} style={{ animationDuration: `${countdownMs}ms` }} />
                  </div>
                )}
                {state.expired
                  ? <p className={css.expired}>{t('pair.expired')}</p>
                  : <p className={css.expiry}>{t('pair.expires', { time: formatClock(state.expiresAt) })}</p>}
                {state.stale === true && <p className={css.staleHint}>{t('pair.staleHint')}</p>}
                <div className={css.codeBlock}>
                  <span className={css.codeLabel}>{t('pair.codeLabel')}</span>
                  <span className={css.codeValue} data-testid="remote-code">{formatCode(state.code)}</span>
                  <span className={css.codeHint}>{t('pair.codeHint')}</span>
                </div>
              </div>

              <div className={css.linkCard}>
                <p className={css.linkCardTitle}>{state.public ? t('pair.publicHint') : t('pair.hint')}</p>
                <div className={css.linkRow}>
                  <span className={css.linkIcon} aria-hidden="true">📱</span>
                  <div className={css.linkText}>
                    <span className={css.linkLabel}>{t('pair.phoneLabel')}</span>
                    <code className={css.link} title={state.url}>{state.url}</code>
                  </div>
                  <button
                    type="button"
                    className={clsx(css.copyBtn, copied === 'phone' && css.copied)}
                    onClick={() => onCopy('phone', state.url)}
                  >
                    <IconCopyOutline16 size={14} />
                    {copied === 'phone' ? t('action.copied') : t('action.copyPhone')}
                  </button>
                </div>
                <div className={css.linkRow}>
                  <span className={css.linkIcon} aria-hidden="true">💻</span>
                  <div className={css.linkText}>
                    <span className={css.linkLabel}>{t('pair.desktopLabel')}</span>
                    <code className={css.link} title={desktopPairUrl(state.url)}>{desktopPairUrl(state.url)}</code>
                  </div>
                  <button
                    type="button"
                    className={clsx(css.copyBtn, copied === 'desktop' && css.copied)}
                    onClick={() => onCopy('desktop', desktopPairUrl(state.url))}
                  >
                    <IconCopyOutline16 size={14} />
                    {copied === 'desktop' ? t('action.copied') : t('action.copyDesktop')}
                  </button>
                </div>
                <p className={css.oneTimeHint}><span aria-hidden="true">⚠️</span>{t('pair.oneTimeHint')}</p>
              </div>
              {state.phase === 'stopped' && <p className={css.stoppedHint}>{t('stopped.hint')}</p>}

              {(state.publicBaseUrl !== undefined || state.lanAddresses.length > 1) && (
                <fieldset className={css.addresses}>
                  <legend>{t('address.label')}</legend>
                  {state.publicBaseUrl !== undefined && (
                    <label key="public" className={css.address}>
                      <input
                        type="radio"
                        name="lan-address"
                        aria-label={t('address.public')}
                        checked={state.public}
                        onChange={onPickPublic}
                      />
                      <span>{t('address.public')}</span>
                      <code className={css.addressValue}>{state.publicBaseUrl}</code>
                    </label>
                  )}
                  {state.lanAddresses.map(address => (
                    <label key={address} className={css.address}>
                      <input
                        type="radio"
                        name="lan-address"
                        aria-label={address}
                        checked={!state.public && address === state.address}
                        onChange={() => onPickAddress(address)}
                      />
                      <span>{t('address.lan')}</span>
                      <code className={css.addressValue}>{address}</code>
                    </label>
                  ))}
                  <p className={css.addressHint}>{t('address.hint')}</p>
                </fieldset>
              )}

              <div className={css.actions}>
                <button type="button" className={css.action} onClick={onStop}>
                  <IconStopFill16 size={14} />
                  {t('action.stop')}
                </button>
                <button type="button" className={css.action} onClick={onRefresh}>
                  <IconRefreshOutline16 size={14} />
                  {t('action.refresh')}
                </button>
              </div>
            </>
          )}

          {view === 3 && (
            <>
              <div className={css.statusCard}>
                <span className={clsx(css.statusDot, css[`statusDot-${statusOf(t, state).tone}`])} aria-hidden="true" />
                <div className={css.statusMeta}>
                  <p className={css.statusTitle}>{statusOf(t, state).text}</p>
                  <p className={css.statusSub}>{t('status.useHint')}</p>
                </div>
              </div>

              <section className={css.devices} data-testid="remote-devices" aria-label={t('devices.title')}>
                <h3 className={css.devicesTitle}>{t('devices.title')}</h3>
                {state.devices.length === 0 ? (
                  <p className={css.devicesEmpty}>{t('devices.empty')}</p>
                ) : (
                  <ul className={css.deviceList}>
                    {state.devices.map(device => (
                      <li key={device.id} className={css.deviceRow}>
                        <div className={css.deviceMeta}>
                          <span className={css.deviceName}>
                            {deviceNameFromUserAgent(device.userAgent) ?? t('devices.unknown')}
                          </span>
                          <span className={clsx(css.devicePresence, device.online ? css.deviceOnline : css.deviceOffline)}>
                            {device.online ? t('devices.online') : t('devices.offline')}
                          </span>
                          <span className={css.deviceSeen}>
                            {t('devices.lastSeen', { time: formatLastSeen(device.lastSeenAt) })}
                          </span>
                        </div>
                        <button
                          type="button"
                          className={css.deviceRevoke}
                          aria-label={t('devices.revoke.label')}
                          onClick={() => { onRevoke(device.id) }}
                        >
                          {t('devices.revoke')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div className={css.actions}>
                <button type="button" className={css.action} onClick={onStop}>
                  <IconStopFill16 size={14} />
                  {t('action.stop')}
                </button>
                <button type="button" className={css.action} onClick={onRefresh}>
                  <IconRefreshOutline16 size={14} />
                  {t('action.refresh')}
                </button>
                <button type="button" className={css.action} onClick={() => setView(2)}>
                  {t('pair.reopen')}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
