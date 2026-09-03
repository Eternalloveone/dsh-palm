/**
 * Pure UI-text helpers shared by the views and the tests: workspace path
 * compression (common-prefix hiding + middle truncation), session preview
 * summaries (code fences collapse to a "[代码] lang" badge), and chat
 * timestamp de-duplication (one clock per minute bucket).
 */

/** Split a Windows/POSIX path into segments (drive letter stays attached). */
function segments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean)
}

/**
 * Longest leading segment sequence shared by ALL paths (≥ 2 segments so a
 * lone drive root never counts). Empty when there is nothing common.
 */
export function commonPathPrefix(paths: readonly string[]): string {
  if (paths.length < 2) return ''
  const split = paths.map(segments)
  const first = split[0] ?? []
  let shared = 0
  loop: for (let i = 0; i < first.length - 1; i++) {
    const segment = first[i]
    for (const other of split) {
      if ((other[i] ?? '') !== segment) break loop
    }
    shared += 1
  }
  if (shared === 0) return ''
  return split.map(parts => parts.slice(0, shared).join('/'))[0] ?? ''
}

/**
 * Longest leading segment sequence shared by at least `minShare` of the
 * paths (majority rule) — the roster usually clusters under one parent with
 * a few stragglers on other drives, and those stragglers simply keep their
 * full path. Needs ≥ 2 matching paths and ≥ 2 total segments.
 */
export function dominantPathPrefix(paths: readonly string[], minShare = 0.6): string {
  if (paths.length < 2) return ''
  const split = paths.map(segments)
  const minLen = Math.min(...split.map(parts => parts.length))
  const majority = Math.ceil(paths.length * minShare)
  const prefix: string[] = []
  for (let level = 0; level < minLen; level++) {
    const tally = new Map<string, number>()
    for (const parts of split) {
      const segment = parts[level] ?? ''
      tally.set(segment, (tally.get(segment) ?? 0) + 1)
    }
    let best = ''
    let bestCount = 0
    for (const [segment, count] of tally) {
      if (count > bestCount) {
        best = segment
        bestCount = count
      }
    }
    if (bestCount < majority) break
    prefix.push(best)
  }
  if (prefix.length === 0) return ''
  const matched = split.filter(parts => prefix.every((segment, i) => parts[i] === segment))
  if (matched.length < 2) return ''
  return matched[0]?.slice(0, prefix.length).join('/') ?? ''
}

/**
 * One roster path for display: hide the common parent prefix ("…" + the
 * rest); when the remainder still runs past `maxChars`, collapse the middle
 * to "…first…last".
 */
export function compactPath(full: string, commonPrefix: string, maxChars = 28): string {
  let rest = full
  if (commonPrefix !== '') {
    const prefixSegments = segments(commonPrefix)
    const fullSegments = segments(full)
    if (fullSegments.length > prefixSegments.length
      && prefixSegments.every((segment, i) => fullSegments[i] === segment)) {
      rest = '…' + fullSegments.slice(prefixSegments.length).join('\\')
    }
  }
  if (rest.length <= maxChars) return rest
  const parts = segments(rest.startsWith('…') ? rest.slice(1) : rest)
  if (parts.length < 2) return rest.slice(0, maxChars - 1) + '…'
  // "…first…last": clip each kept segment so a huge leaf name can't inflate
  // the display back past the budget.
  const clipped = '…' + (parts[0] ?? '').slice(0, 10) + '…' + (parts[parts.length - 1] ?? '').slice(0, 10)
  return clipped
}

/** Cap a preview line to `max` characters with an ellipsis. */
function clamp(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '…'
}

/**
 * The one-line session preview: plain text clamps to 30 chars; a fenced code
 * block becomes "[代码] lang" (language omitted when the fence is bare).
 * Reasoning-only turns surface their first line (thinking text is content).
 */
export function previewSummary(text: string): string {
  const fence = /^\s*```([\w+-]*)\s*\n/.exec(text)
  if (fence !== null) {
    const lang = fence[1] ?? ''
    return lang === '' ? '[代码]' : `[代码] ${lang}`
  }
  const firstLine = text.trimStart().split('\n', 1)[0] ?? ''
  return clamp(firstLine, 30)
}

/**
 * Running-turn elapsed label (desktop turn-clock parity, Chinese wording):
 * whole seconds, minutes pad the seconds to two digits. The indicator only
 * shows it once the turn has clearly been running (桌面/手机端 15s 阈值), so
 * short turns never see it.
 */
export function formatRunDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes > 0 ? `${minutes}分${String(seconds).padStart(2, '0')}秒` : `${seconds}秒`
}

/**
 * Which rows show their clock: a row shows the timestamp only when it is the
 * LAST row of its minute bucket — consecutive rows in the same minute hide
 * all but the final one.
 */
export function timeVisibility(times: readonly number[]): boolean[] {
  return times.map((time, index) => {
    const next = times[index + 1]
    if (next === undefined) return true
    return Math.floor(time / 60_000) !== Math.floor(next / 60_000)
  })
}
