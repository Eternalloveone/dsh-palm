/**
 * Local display preferences (the phone-only appearance settings): font
 * scale, message density, code line numbers, and chat auto-scroll. Each is
 * a localStorage flag; the visual ones are mirrored onto <html> as data
 * attributes so plain CSS reacts, and every setter applies immediately.
 */

export type FontScale = 'small' | 'standard' | 'large'
export type Density = 'compact' | 'cozy'

const FONT_KEY = 'dsh.palm.fontScale'
const DENSITY_KEY = 'dsh.palm.density'
const LINE_NUMBERS_KEY = 'dsh.palm.lineNumbers'
const AUTO_SCROLL_KEY = 'dsh.palm.autoScroll'

function readStored(key: string): string | undefined {
  try {
    const value = localStorage.getItem(key)
    return value === '' ? undefined : value ?? undefined
  } catch {
    return undefined
  }
}

function writeStored(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* non-fatal */ }
}

/* ── font scale ──────────────────────────────────────────────────────── */

export function getFontScale(): FontScale {
  const value = readStored(FONT_KEY)
  return value === 'small' || value === 'large' ? value : 'standard'
}

export function setFontScale(value: FontScale): void {
  writeStored(FONT_KEY, value)
  applyDisplayPrefs()
}

/** Chat message font size per scale (drives the label in settings). */
export const FONT_SCALE_LABEL: Record<FontScale, string> = {
  small: '小',
  standard: '标准',
  large: '大',
}

/* ── message density ─────────────────────────────────────────────────── */

export function getDensity(): Density {
  return readStored(DENSITY_KEY) === 'compact' ? 'compact' : 'cozy'
}

export function setDensity(value: Density): void {
  writeStored(DENSITY_KEY, value)
  applyDisplayPrefs()
}

export const DENSITY_LABEL: Record<Density, string> = {
  compact: '紧凑',
  cozy: '舒适',
}

/* ── code line numbers ───────────────────────────────────────────────── */

export function getLineNumbers(): boolean {
  return readStored(LINE_NUMBERS_KEY) === '1'
}

export function setLineNumbers(value: boolean): void {
  writeStored(LINE_NUMBERS_KEY, value ? '1' : '0')
  applyDisplayPrefs()
}

/* ── chat auto-scroll ────────────────────────────────────────────────── */

export function getAutoScroll(): boolean {
  return readStored(AUTO_SCROLL_KEY) !== '0'
}

export function setAutoScroll(value: boolean): void {
  writeStored(AUTO_SCROLL_KEY, value ? '1' : '0')
}

/* ── tool-call / system-message visibility ──────────────────────────── */

const SHOW_TOOL_CALLS_KEY = 'dsh.mobile.showToolCalls'
const SHOW_SYSTEM_MESSAGES_KEY = 'dsh.mobile.showSystemMessages'

/** Whether tool-call disclosures render (default on; '0' opts out). */
export function getShowToolCalls(): boolean {
  return readStored(SHOW_TOOL_CALLS_KEY) !== '0'
}

export function setShowToolCalls(value: boolean): void {
  writeStored(SHOW_TOOL_CALLS_KEY, value ? '1' : '0')
}

/** Whether injected system messages render (default off; '1' opts in). */
export function getShowSystemMessages(): boolean {
  return readStored(SHOW_SYSTEM_MESSAGES_KEY) === '1'
}

export function setShowSystemMessages(value: boolean): void {
  writeStored(SHOW_SYSTEM_MESSAGES_KEY, value ? '1' : '0')
}

/* ── document wiring ─────────────────────────────────────────────────── */

/** Mirror the visual prefs onto <html> data attributes (boot + on change). */
export function applyDisplayPrefs(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const font = getFontScale()
  if (font === 'standard') delete root.dataset.fontScale
  else root.dataset.fontScale = font
  const density = getDensity()
  if (density === 'cozy') delete root.dataset.density
  else root.dataset.density = density
  if (getLineNumbers()) root.dataset.lineNumbers = '1'
  else delete root.dataset.lineNumbers
}
