/**
 * Conditional report-card detection & parsing (single-view enhancement).
 *
 * A SETTLED assistant turn whose text looks like an agent "result report"
 * (status lines, headings, commit fragments) is rendered as a report card;
 * anything else keeps the normal paragraph flow. Pure functions, no DOM:
 * - detectReport(text) drives the container/card path,
 * - parseReportLines(text) slices the text into report segments for the
 *   renderer (status chips, section headings, commit chips, plain text).
 *
 * Line grammar (agent-facing, client-validated):
 *   - 脚本重启：✓ 通过          (name + : + status token)
 *   - 构建 pipeline → ✓ 通过     (name + → + status token)
 *   - - 宿主 3080：✗ 失败（超时） (optional list dash)
 *   - ### 验证结果               (section heading)
 *   - commit a3f9c21 | `a3f9c21` (commit chip)
 * Status tokens: ok ✓✔✅ · fail ✗✘❌ · run ●○
 */

export type StatusKind = 'ok' | 'fail' | 'run'

export type ReportSegment =
  | { type: 'text'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'status'; label: string; status: StatusKind; note?: string }
  | { type: 'commit'; hash: string }

const OK_TOKENS = /[✓✔✅]/
const FAIL_TOKENS = /[✗✘❌]/
const RUN_TOKENS = /[●○]/

/** Split one line into a status entry, or null. Accepts an optional leading
 *  list dash and either `：`/`:` or `→` separators. */
function statusOf(line: string): { label: string; status: StatusKind; note?: string } | null {
  const body = line.replace(/^\s*[-*•]\s+/, '')
  const colon = body.match(/^(.{1,200}?)[:：]\s*([✓✔✅✗✘❌●○])\s*(.*)$/)
  const arrow = body.match(/^(.{1,200}?)\s*→\s*([✓✔✅✗✘❌●○])\s*(.*)$/)
  const match = colon ?? arrow
  if (match === null) return null
  const [, label, token, rest] = match
  let status: StatusKind
  if (OK_TOKENS.test(token)) status = 'ok'
  else if (FAIL_TOKENS.test(token)) status = 'fail'
  else status = 'run'
  const note = rest.trim()
  return { label: label.trim(), status, note: note === '' ? undefined : note }
}

function isStatusLine(line: string): boolean {
  return statusOf(line) !== null
}

/** Whole-line commit fragment: `commit <hash>`, a bare 7–40 hex hash (the
 *  common two-line "commit" + hash output), or a backticked hash. */
function commitOf(line: string): string | null {
  const trimmed = line.trim()
  const bare = trimmed.match(/^commit\s+([0-9a-fA-F]{7,40})\s*$/)
  const ticked = trimmed.match(/^`([0-9a-fA-F]{7,40})`\s*$/)
  const naked = trimmed.match(/^[0-9a-fA-F]{7,40}$/)
  const hash = bare?.[1] ?? ticked?.[1] ?? naked?.[0]
  return hash === undefined ? null : hash
}

/** A bare "commit" word that continues onto the hash of the NEXT line. */
function isCommitIntro(line: string): boolean {
  return line.trim() === 'commit'
}

export function lineIsHeading(line: string): boolean {
  return /^#{1,6}\s+\S/.test(line.trimStart())
}

/**
 * Is this settled assistant text a "result report"? Heuristics:
 *  - at least two status lines, or
 *  - one status line plus a section heading, or
 *  - one status line plus a commit fragment.
 * A stray ✓ inside a prose paragraph never counts (statusOf requires a
 * structured line), which keeps normal chat on the plain path.
 */
export function detectReport(text: string): boolean {
  if (text === '') return false
  let statuses = 0
  let headings = 0
  let commit = false
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (line === '') continue
    if (isStatusLine(line)) statuses += 1
    else if (lineIsHeading(line)) headings += 1
    else if (commitOf(line) !== null) commit = true
  }
  if (statuses >= 2) return true
  return statuses >= 1 && (headings >= 1 || commit)
}

/** Slice report text into renderer-friendly segments, in line order.
 *  Status/heading/commit lines become their own segment; everything else is
 *  kept as plain text (blank lines preserved as-is for the text run). A bare
 *  "commit" intro consumes the hash-only line that follows. */
export function parseReportLines(text: string): ReportSegment[] {
  const out: ReportSegment[] = []
  let commitIntro = false
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (isStatusLine(line)) {
      const entry = statusOf(line)!
      out.push({ type: 'status', label: entry.label, status: entry.status, note: entry.note })
      commitIntro = false
      continue
    }
    if (lineIsHeading(line)) {
      const trimmed = line.trimStart()
      const level = trimmed.match(/^(#{1,6})\s+/)?.[1]?.length ?? 1
      out.push({ type: 'heading', level: Math.min(level, 6), text: trimmed.replace(/^#{1,6}\s+/, '') })
      commitIntro = false
      continue
    }
    if (isCommitIntro(line)) {
      commitIntro = true
      continue
    }
    const hash = commitOf(line)
    if (hash !== null) {
      commitIntro = false
      out.push({ type: 'commit', hash })
      continue
    }
    if (commitIntro) {
      commitIntro = false
      out.push({ type: 'text', text: 'commit' })
    }
    out.push({ type: 'text', text: line })
  }
  if (commitIntro) out.push({ type: 'text', text: 'commit' })
  return out
}
