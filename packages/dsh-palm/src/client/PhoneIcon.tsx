/**
 * Phone glyph for the sidebar remote-control trigger. Not part of the
 * shared icon set (ui-primitives has no phone icon); matches the outline
 * style with currentColor strokes. A modern smartphone silhouette: rounded
 * body, earpiece line, and a home bar.
 */

/** Icon props mirroring ui-primitives' IconProps. */
export interface PhoneIconProps {
  /** Glyph size in px (default 16). */
  size?: number
  /** Extra class for layout placement. */
  className?: string
}

/**
 * Render the phone icon.
 * @param props - size and optional class.
 * @returns the svg element.
 */
export function PhoneIcon({ size = 16, className }: PhoneIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="4" y="1.5" width="8" height="13" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <line x1="6.5" y1="3.5" x2="9.5" y2="3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="6.5" y1="12.5" x2="9.5" y2="12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
