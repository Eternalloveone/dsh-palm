/**
 * In-panel public-address configuration: lets the desktop user paste their
 * own tunneled address (frp / relay / Cloudflare Tunnel / any public
 * origin) right inside the pairing panel instead of hunting through the
 * settings surface. The input always shows the current value; "修改" saves
 * (validated), "清除" clears. Persistence is delegated to the entry through
 * the onSave/onClear callbacks (which write the remote-web-ui settings
 * section and re-mint the QR).
 */
import { useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { probePublicUrl, type TunnelDetection } from './pair-api.ts'
import css from './remote.module.css'

/** Props: copy, the current configured value, and the two persistence actions. */
export interface PublicUrlConfigProps {
  /** Bound translator for the `remote` namespace. */
  t: TranslateNS<'remote'>
  /** The configured public (tunneled) base URL, when present. */
  current?: string
  /** Tunnel hints for the onboarding card (Tailscale / frp / Cloudflare). */
  detection?: TunnelDetection
  /** Persist a new public base URL (writes the settings section, re-mints). */
  onSave(url: string): Promise<void>
  /** Clear the configured public base URL (re-mints on the LAN base). */
  onClear(): Promise<void>
}

/** Whether a value is a parseable http(s) URL with a host (mirrors the host half). */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== ''
  } catch {
    return false
  }
}

/**
 * Render the public-address configuration card.
 * @param props - copy, current value, and persistence callbacks.
 * @returns the configuration card element tree.
 */
export function PublicUrlConfig({ t, current, detection, onSave, onClear }: PublicUrlConfigProps) {
  const [draft, setDraft] = useState(current ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const submit = async (): Promise<void> => {
    const value = draft.trim()
    if (!isHttpUrl(value)) {
      setError(t('publicConfig.invalid'))
      return
    }
    setSaving(true)
    setError(undefined)
    try {
      // Reachability first: a tunnel that is down or a mistyped address is
      // caught before the value is persisted (the browser cannot probe a
      // cross-origin tunnel itself, so the host does it).
      const probe = await probePublicUrl(value)
      if (!probe.ok) {
        setError(t('publicConfig.unreachable'))
        return
      }
      await onSave(value)
    } catch {
      setError(t('publicConfig.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const clear = async (): Promise<void> => {
    setSaving(true)
    setError(undefined)
    try {
      await onClear()
      setDraft('')
    } catch {
      setError(t('publicConfig.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={css.publicCard}>
      <span className={css.publicCardLabel}>{t('publicConfig.label')}</span>
      <div className={css.publicRow}>
        <input
          className={css.publicInput}
          type="url"
          value={draft}
          placeholder={t('publicConfig.placeholder')}
          aria-label={t('publicConfig.label')}
          disabled={saving}
          onChange={(event) => { setDraft(event.target.value) }}
          onKeyDown={(event) => { if (event.key === 'Enter') void submit() }}
        />
        <button type="button" className={css.btnPrimary} disabled={saving} onClick={() => { void submit() }}>
          {saving ? t('publicConfig.saving') : t('publicConfig.edit')}
        </button>
        <button type="button" className={css.btnGhost} disabled={saving} onClick={() => { void clear() }}>
          {t('publicConfig.clear')}
        </button>
      </div>
      {error !== undefined && <p className={css.publicError} role="alert">{error}</p>}
      {detection !== undefined && (
        <div className={css.detectHints}>
          {detection.tailnetDomain !== undefined && (
            <div className={css.detectHint}>
              <span className={css.detectText}>
                {t('publicConfig.detectTailscale', { domain: detection.tailnetDomain })}
              </span>
              <button
                type="button"
                className={css.detectApply}
                disabled={saving}
                onClick={() => { setDraft(`https://${detection.tailnetDomain ?? ''}`) }}
              >
                {t('publicConfig.apply')}
              </button>
            </div>
          )}
          {detection.frpEntry !== undefined && (
            <div className={css.detectHint}>
              <span className={css.detectText}>
                {t('publicConfig.detectFrpEntry', { entry: detection.frpEntry })}
              </span>
              <button
                type="button"
                className={css.detectApply}
                disabled={saving}
                onClick={() => { setDraft(detection.frpEntry ?? '') }}
              >
                {t('publicConfig.apply')}
              </button>
            </div>
          )}
          {detection.frpEntry !== undefined && <p className={css.detectHint}>{t('publicConfig.detectFrpTlsHint')}</p>}
          {detection.frpc && detection.frpEntry === undefined && <p className={css.detectHint}>{t('publicConfig.detectFrpc')}</p>}
          {detection.cloudflared && <p className={css.detectHint}>{t('publicConfig.detectCloudflared')}</p>}
          {detection.tailnetDomain === undefined && !detection.frpc && !detection.cloudflared && detection.frpEntry === undefined && (
            <div className={css.noTunnel}>
              <p className={css.noTunnelTitle}>{t('publicConfig.noTunnel')}</p>
              <div className={css.noTunnelRow}>
                <span className={css.noTunnelIcon} aria-hidden="true">📶</span>
                <div className={css.noTunnelMeta}>
                  <p className={css.noTunnelName}>{t('publicConfig.lanOption')}</p>
                  <p className={css.noTunnelHint}>{t('publicConfig.lanOptionHint')}</p>
                </div>
              </div>
              <div className={css.noTunnelRow}>
                <span className={css.noTunnelIcon} aria-hidden="true">🌐</span>
                <div className={css.noTunnelMeta}>
                  <p className={css.noTunnelName}>{t('publicConfig.tunnelOption')}</p>
                  <p className={css.noTunnelHint}>{t('publicConfig.tunnelHint')}</p>
                </div>
              </div>
              <a
                className={css.noTunnelLink}
                href={t('publicConfig.tutorialUrl')}
                target="_blank"
                rel="noreferrer"
              >
                {t('publicConfig.tutorial')} →
              </a>
            </div>
          )}
        </div>
      )}
      <p className={css.publicHint}>{t('publicConfig.hint')}</p>
    </div>
  )
}
