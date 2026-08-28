/**
 * Mobile-surface theme: three modes — light, dark, and system (follow the OS
 * `prefers-color-scheme`). The standalone page boots without the shell, so
 * there is no theme system to inherit; the mode is stored in localStorage and
 * applied as a `data-theme` attribute on <html>. Explicit modes pin the
 * palette; `system` leaves the choice to the stylesheet's media query (the
 * CSS carries both palettes under `:root`/`@media (prefers-color-scheme:
 * dark)`, so a system-mode change needs no re-render at all).
 *
 * A tiny module store (subscribe/get) keeps the toggle button, the settings
 * segmented control, and the boot path in sync without threading props
 * through the three view levels. `getMobileTheme()`/`toggleMobileTheme()` keep
 * working on the RESOLVED (light/dark) theme so the quick header flip stays a
 * one-liner.
 */

/** The persisted theme mode (`system` follows the OS scheme). */
export type MobileThemeMode = 'light' | 'dark' | 'system'
/** The concrete palette a mode resolves to. */
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'dsh.remote.theme'
const THEME_COLOR_META_NAME = 'theme-color'
const LIGHT_THEME_COLOR = '#f5f5f7'
const DARK_THEME_COLOR = '#0a0a0f'

let current: MobileThemeMode = readStored() ?? 'system'
const listeners = new Set<() => void>()

function readStored(): MobileThemeMode | undefined {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'dark' || value === 'light' || value === 'system' ? value : undefined
  } catch {
    return undefined
  }
}

function persist(mode: MobileThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // Private-mode storage failures are non-fatal; the session keeps the theme.
  }
}

/** The OS scheme, as far as the browser reports one (light when unknown). */
function osPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Resolve a mode to its concrete palette. */
export function resolveTheme(mode: MobileThemeMode = current): ResolvedTheme {
  if (mode === 'system') return osPrefersDark() ? 'dark' : 'light'
  return mode
}

/** Apply the mode to the document: data-theme attribute + browser chrome color. */
function applyToDocument(mode: MobileThemeMode): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = mode
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${THEME_COLOR_META_NAME}"]`)
  if (meta !== null) {
    meta.content = resolveTheme(mode) === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR
  }
}

/** One live matchMedia listener while system mode is active: an OS flip
 * re-resolves without a reload and notifies subscribers. */
const systemWatcher = {
  media: undefined as MediaQueryList | undefined,
  onChange: undefined as (() => void) | undefined,
  sync(): void {
    const wanted = current === 'system'
      && typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
    if (wanted && this.media === undefined) {
      this.media = window.matchMedia('(prefers-color-scheme: dark)')
      this.onChange = () => {
        applyToDocument(current)
        for (const listener of [...listeners]) listener()
      }
      // Modern browsers use addEventListener; addListener is the legacy hook.
      if (typeof this.media.addEventListener === 'function') {
        this.media.addEventListener('change', this.onChange)
      } else if (typeof (this.media as unknown as { addListener?: (cb: () => void) => void }).addListener === 'function') {
        ;(this.media as unknown as { addListener: (cb: () => void) => void }).addListener(this.onChange)
      }
    } else if (!wanted && this.media !== undefined) {
      if (typeof this.media.removeEventListener === 'function' && this.onChange !== undefined) {
        this.media.removeEventListener('change', this.onChange)
      }
      this.media = undefined
      this.onChange = undefined
    }
  },
}

/** Current theme mode (system unless the user picked an explicit palette). */
export function getMobileThemeMode(): MobileThemeMode {
  return current
}

/** The concrete palette currently painted (system resolved through the OS). */
export function getMobileTheme(): ResolvedTheme {
  return resolveTheme()
}

/** Subscribe to mode and resolved-theme changes; returns the unsubscribe function. */
export function subscribeMobileTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Set the theme mode explicitly (persisted + applied to the document). */
export function setMobileThemeMode(mode: MobileThemeMode): void {
  if (mode === current) return
  current = mode
  persist(mode)
  systemWatcher.sync()
  applyToDocument(mode)
  for (const listener of [...listeners]) listener()
}

/** Pin an explicit palette (kept for the quick toggle and older callers). */
export function setMobileTheme(theme: ResolvedTheme): void {
  setMobileThemeMode(theme)
}

/** Flip to the opposite of the currently painted palette and return it. */
export function toggleMobileTheme(): ResolvedTheme {
  const next: ResolvedTheme = resolveTheme() === 'light' ? 'dark' : 'light'
  setMobileThemeMode(next)
  return next
}

/** Apply the host `ui-theme.preference` (desktop-synced): the host and the
 * phone share the same three modes, so this is a straight set. */
export function applyHostThemePreference(preference: 'light' | 'dark' | 'system'): void {
  setMobileThemeMode(preference)
}

/** Apply the persisted (or default system) mode once at boot, before first paint. */
export function initMobileTheme(): void {
  systemWatcher.sync()
  applyToDocument(current)
}
