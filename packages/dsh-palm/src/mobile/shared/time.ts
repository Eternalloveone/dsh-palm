/**
 * Time formatting shared by every phone surface.
 *
 * These used to live in three places (App / process-rows / each row), which is
 * how "the same clock" ended up with two behaviours: `formatTime` said
 * "昨天 20:31" while the roster's own copy said "08-29 14:05". One module now
 * owns the wording; call sites pass a timestamp and render the string.
 *
 * @module dsh-palm/mobile/shared/time
 */

/**
 * Human clock, e.g. "14:05", "昨天 20:31", "8月29日 14:05".
 * @param epochMs - wall-clock milliseconds.
 * @returns localized short time for chat rows.
 */
export function formatTime(epochMs: number): string {
  const date = new Date(epochMs)
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return clock
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${clock}`
  return `${String(date.getMonth() + 1)}月${String(date.getDate())}日 ${clock}`
}

/**
 * Full timestamp for roster rows, e.g. "08-29 14:05" (year added when the
 * timestamp is not from the current year) — same-named sessions stay
 * distinguishable by date.
 * @param epochMs - wall-clock milliseconds.
 * @returns date + clock for the session list.
 */
export function formatFullTime(epochMs: number): string {
  const date = new Date(epochMs)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  const year = date.getFullYear()
  return year === new Date().getFullYear()
    ? `${month}-${day} ${clock}`
    : `${year}-${month}-${day} ${clock}`
}

/**
 * Run duration wording, desktop parity: whole seconds are FLOORED, never
 * rounded. Rounding put the phone up to half a second ahead of the desktop,
 * and because the reading is re-derived from the wall clock on every render, a
 * tick just past the half-second showed one second more at the same instant —
 * read as "手机的秒表比桌面快". Floor makes the two numbers identical.
 * @param ms - elapsed milliseconds.
 * @returns e.g. "19秒", "9分29秒", "1小时2分0秒".
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  // 超过一小时也要带秒：长回合里只看"几分"根本看不出还在不在动（用户要求）。
  if (hours > 0) return `${hours}小时${minutes}分${seconds}秒`
  if (minutes > 0) return `${minutes}分${seconds}秒`
  return `${seconds}秒`
}
