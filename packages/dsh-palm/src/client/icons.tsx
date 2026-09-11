/**
 * Local icon set for the desktop pairing panel. 0.1.5 decoupling: the panel
 * deliberately does not import `@deepseek-ai/dsh-client-ui-primitives` (the
 * dsh-web-ui icon set); these four glyphs are self-contained outline SVGs in
 * the same `currentColor` stroke style as the shared set, so the pairing
 * panel survives dsh-web-ui version churn without changing imports.
 */

/** Icon props mirroring the ui-primitives IconProps surface used here. */
export interface PanelIconProps {
  /** Glyph size in px (default 16). */
  size?: number
  /** Extra class for layout placement. */
  className?: string
}

/** Close (×) glyph. */
export function IconCloseOutline16({ size = 16, className }: PanelIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** Copy glyph (two stacked rectangles). */
export function IconCopyOutline16({ size = 16, className }: PanelIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <rect x="5.5" y="5.5" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.2 10.5H3.5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v.7" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

/** Refresh glyph (circular arrow). */
export function IconRefreshOutline16({ size = 16, className }: PanelIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M13 8a5 5 0 1 1-1.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M13 1.8v3h-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Stop glyph (filled square). */
export function IconStopFill16({ size = 16, className }: PanelIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <rect x="4.5" y="4.5" width="7" height="7" rx="1.2" fill="currentColor" />
    </svg>
  )
}
