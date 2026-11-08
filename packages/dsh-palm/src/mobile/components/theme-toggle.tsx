/**
 * Theme toggle button: sits at the right end of every view header and flips
 * the mobile surface between the light (default) and dark palettes. The
 * glyph shows the theme you will switch TO (moon in light mode, sun in dark
 * mode); the choice persists across visits.
 */

import { useSyncExternalStore } from 'react'
import { getMobileTheme, getMobileThemeMode, subscribeMobileTheme, toggleMobileTheme, type MobileThemeMode } from '../mobile-theme.ts'
import { mutateSettings } from '../api.ts'
import { Button } from '../ui/primitives.tsx'
import { ContrastIcon } from './icons.tsx'

/** 主题模式的中文名（菜单右侧显示"当前是什么"）。 */
const MODE_LABEL: Record<MobileThemeMode, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
}

/** Sun glyph: circle + eight rays (inline SVG, no emoji). */
function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5 5l1.7 1.7M17.3 17.3 19 19M19 5l-1.7 1.7M6.7 17.3 5 19" />
    </svg>
  )
}

/** Moon glyph: crescent path (inline SVG, no emoji). */
function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
    </svg>
  )
}

/**
 * Render the header theme toggle.
 * @returns the toggle button.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeMobileTheme, getMobileTheme)
  const dark = theme === 'dark'
  return (
    <Button
      type="button"
      className="mobile-theme-toggle"
      aria-label={dark ? '切换到浅色' : '切换到深色'}
      onClick={() => {
        // Keep the phone and the desktop in sync: the quick flip writes the
        // same `ui-theme.preference` the settings page sets (best effort —
        // the local theme flips immediately either way).
        const next = toggleMobileTheme()
        void mutateSettings('ui-theme', [{ op: 'set', path: ['preference'], value: next === 'dark' ? 'dark' : 'light' }]).catch(() => {})
      }}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </Button>
  )
}

/**
 * ⋯ 菜单里的「切换主题」行：右侧显示**当前模式**（不是"点了会变成什么"），
 * 点一下就在明暗之间翻转并写回桌面同一份 `ui-theme.preference`。
 *
 * 放在 components/ 而不是 views/：它要调 api.ts 的 mutateSettings，而视图层
 * 有一条"不直接 import api.ts"的架构门禁。
 */
export function ThemeMenuItem() {
  const mode = useSyncExternalStore(subscribeMobileTheme, getMobileThemeMode)
  return (
    <Button
      type="button"
      role="menuitem"
      className="sheet-option"
      onClick={() => {
        const next = toggleMobileTheme()
        void mutateSettings('ui-theme', [{ op: 'set', path: ['preference'], value: next === 'dark' ? 'dark' : 'light' }]).catch(() => {})
      }}
    >
      <ContrastIcon />
      <span className="sheet-option-copy">
        <span className="sheet-option-title">切换主题</span>
      </span>
      <span className="sheet-option-check">{MODE_LABEL[mode]}</span>
    </Button>
  )
}
