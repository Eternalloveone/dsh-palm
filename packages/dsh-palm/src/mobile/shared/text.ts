/**
 * Text helpers shared by every phone surface.
 *
 * Display truncation used to be re-implemented at each call site with a
 * slightly different threshold and suffix (`slice(0, 57) + '…'` in settings,
 * `slice(0, 20) + (…)` in the quote chip, and so on). One helper keeps the
 * suffix and the "does it even need truncating" rule identical everywhere.
 *
 * @module dsh-palm/mobile/shared/text
 */

/**
 * Truncate display text, appending an ellipsis only when something was cut.
 * The result is at most `max` characters (including the ellipsis).
 * @param text - source text.
 * @param max - maximum display length, at least 1.
 * @param ellipsis - suffix, defaults to the single-character ellipsis.
 * @returns the (possibly shortened) display string.
 */
export function truncate(text: string, max: number, ellipsis = '…'): string {
  if (text === '') return ''
  if (max <= 0) return ''
  if (text.length <= max) return text
  if (ellipsis.length >= max) return text.slice(0, max)
  return `${text.slice(0, max - ellipsis.length)}${ellipsis}`
}

/**
 * Turn a session title into a safe download file name stem.
 *
 * Replaces characters Windows/macOS reject in file names, trims surrounding
 * whitespace and dots (Windows drops a trailing dot silently), and caps the
 * stem length. An empty title falls back to `fallback`.
 * @param title - session title (may be empty).
 * @param max - maximum stem length.
 * @param fallback - used when the sanitized stem is empty.
 * @returns a file name stem without extension.
 */
export function sanitizeFileName(title: string, max = 60, fallback = '会话'): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  const stem = cleaned === '' ? fallback : cleaned
  return stem.slice(0, Math.max(1, max))
}
