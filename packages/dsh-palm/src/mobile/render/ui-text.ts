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
  // 保留**尾部**而不是"…首段…末段"：末两级才是"这是哪个项目"的答案，首段
  // （如项目代号）往往和名字重复，拼进去只是把真实目录挤掉。实测截成
  // "…proj-a…panel-ol" 时，两条同名工作区的副标题完全一样、分不出来。
  const keep: string[] = []
  let budget = maxChars - 2
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const segment = parts[i] ?? ''
    const cost = segment.length + (keep.length > 0 ? 1 : 0)
    if (cost > budget && keep.length > 0) break
    // 单个名字都放不下时保留它的**尾部**：目录名区分度通常在末尾（版本号/后缀）。
    if (cost > budget) { keep.unshift(segment.slice(-budget)); break }
    keep.unshift(segment)
    budget -= cost
  }
  return '…\\' + keep.join('\\')
}

/** Cap a preview line to `max` characters with an ellipsis. */
function clamp(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '…'
}

/**
 * Strip the markdown a list row has no room to render: heading hashes, list
 * bullets, quote markers, emphasis and inline-code ticks, and links (their
 * label survives). A row that would otherwise read "## 结论" or "- 修好了"
 * should read like the sentence the user wrote.
 */
function plainPreviewLine(line: string): string {
  return line
    .replace(/^[ \t]*#{1,6}[ \t]+/, '')
    .replace(/^[ \t]*>+[ \t]*/, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/^Task:[ \t]*/i, '')
    .trim()
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
  // 跳过只有标记的行（标题行剥完就空了、分隔线、表格行），取第一条真文本。
  for (const raw of text.trimStart().split('\n')) {
    const line = plainPreviewLine(raw)
    if (line === ' ' || /^(?:-{3,}|\*{3,}|_{3,}|\|)/.test(line)) continue
    return clamp(line, 30)
  }
  return ''
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
 * Which rows show their clock. Policy set by the user (2026-10-13): **every row
 * carries its own timestamp**. The old rule showed only the LAST row of each
 * minute bucket, which made earlier rows look as if they had lost their time
 * ("有的时候发消息，消息下方没有出现时刻"). Kept as a function so ChatView's
 * windowed slices stay shape-compatible.
 */
export function timeVisibility(times: readonly number[]): boolean[] {
  return times.map(() => true)
}

/** 附件大小：1024 → "1 KB"，1.5 MB → "1.5 MB"（手机上只需要个量级）。 */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}
