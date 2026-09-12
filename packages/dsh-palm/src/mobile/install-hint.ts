/**
 * iOS home-screen install hint.
 *
 * The phone surface is a PWA, but iOS Safari has no `beforeinstallprompt` and
 * cannot be asked to install from script — the only way in is the share sheet's
 * 「添加到主屏幕」, and a page sitting in a plain tab never becomes full-screen
 * or push-capable. So the surface says so, once, where device settings live.
 *
 * @module dsh-palm/mobile/install-hint
 */

/** Storage key for the one-time acknowledgement. */
export const INSTALL_HINT_KEY = 'dsh-palm.install-hint.v1'

/** The navigator facts the decision needs (injectable for tests). */
export interface InstallHintEnv {
  userAgent: string
  /** iOS home-screen apps expose this instead of the display-mode query. */
  standalone?: boolean
  /** iPadOS reports a desktop UA, but only a touch device does. */
  maxTouchPoints?: number
  /** `(display-mode: standalone)` — the modern signal, true on Android too. */
  displayModeStandalone?: boolean
}

/** Read the live environment (empty pieces when there is no DOM). */
export function installHintEnv(): InstallHintEnv {
  if (typeof navigator === 'undefined') return { userAgent: '' }
  const nav = navigator as Navigator & { standalone?: boolean }
  return {
    userAgent: nav.userAgent ?? '',
    standalone: nav.standalone,
    maxTouchPoints: nav.maxTouchPoints,
    displayModeStandalone: typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(display-mode: standalone)').matches
      : undefined,
  }
}

/**
 * Whether this is iOS Safari running OUTSIDE the home screen.
 *
 * Chrome/Firefox/Edge on iOS are Safari underneath but cannot add the page to
 * the home screen the way Safari does, and they all announce themselves in the
 * UA — telling those users to use the share sheet would be wrong. iPadOS 13+
 * masquerades as macOS, which is why a Mac UA with touch points is an iPad.
 */
export function iosInstallHintNeeded(env: InstallHintEnv = installHintEnv()): boolean {
  const { userAgent, maxTouchPoints = 0 } = env
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
  if (!ios) return false
  if (/(CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo)/.test(userAgent)) return false
  return env.standalone !== true && env.displayModeStandalone !== true
}

/** Whether the hint was already acknowledged on this device. */
export function installHintDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_HINT_KEY) === '1'
  } catch {
    // Private mode: better to show it again than to never show it.
    return false
  }
}

/** Remember the acknowledgement (best effort). */
export function dismissInstallHint(): void {
  try {
    localStorage.setItem(INSTALL_HINT_KEY, '1')
  } catch {
    // non-fatal: the hint simply comes back next visit
  }
}
