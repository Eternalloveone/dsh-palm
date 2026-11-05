/**
 * Session export: one Markdown string and one self-contained HTML file.
 *
 * Why these two: Markdown is what people paste into issues, notes and other
 * agents; a single HTML file opens on any phone with no assets and no network
 * (the PWA itself already has to be offline-friendly). Both paths run
 * {@link redactSecrets} on every row — redaction is a property of the export
 * module, not something each caller remembers.
 *
 * @module dsh-palm/mobile/export
 */

import { redactSecrets } from './redact.ts'

/** One exported row. */
export interface ExportRow {
  role: 'user' | 'assistant' | 'command'
  text: string
  /** Epoch ms of the row (omitted from output when unknown). */
  at?: number
}

/** Human label per role. */
const ROLE_LABEL: Record<ExportRow['role'], string> = {
  user: '我',
  assistant: '助手',
  command: '命令',
}

/** Escape one string for HTML text/attribute contexts. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Local `YYYY-MM-DD HH:mm` stamp (readable in a note; no locale dependency). */
function stamp(at: number | undefined): string {
  if (at === undefined) return ''
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Render rows as Markdown.
 * @param title - session title (used as the H1).
 * @param rows - transcript rows, in order.
 * @param now - export timestamp (test seam).
 */
export function exportMarkdown(title: string, rows: readonly ExportRow[], now: number = Date.now()): string {
  const header = `# ${title === '' ? '会话' : title}\n\n> 导出自 dsh-palm · ${stamp(now)}\n`
  const blocks = rows.map((row) => {
    const time = stamp(row.at)
    const label = ROLE_LABEL[row.role]
    const heading = `## ${label}${time === '' ? '' : ` · ${time}`}`
    return `${heading}\n\n${redactSecrets(row.text)}`
  })
  return `${header}\n${blocks.join('\n\n---\n\n')}\n`
}

/**
 * Render rows as a single, dependency-free HTML file.
 * @param title - session title (document title + H1).
 * @param rows - transcript rows, in order.
 * @param now - export timestamp (test seam).
 */
export function exportSingleFileHtml(title: string, rows: readonly ExportRow[], now: number = Date.now()): string {
  const safeTitle = escapeHtml(title === '' ? '会话' : title)
  const body = rows.map((row) => {
    const time = stamp(row.at)
    const heading = `${ROLE_LABEL[row.role]}${time === '' ? '' : ` · ${time}`}`
    return [
      '<article>',
      `<h2>${escapeHtml(heading)}</h2>`,
      `<pre>${escapeHtml(redactSecrets(row.text))}</pre>`,
      '</article>',
    ].join('\n')
  }).join('\n')
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 20px 16px 40px; font: 15px/1.6 -apple-system, "Segoe UI", "PingFang SC", sans-serif; }
  header { max-width: 720px; margin: 0 auto 20px; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .meta { color: #888; font-size: 12.5px; }
  main { max-width: 720px; margin: 0 auto; }
  article { margin: 0 0 18px; padding: 12px 14px; border-radius: 12px; background: rgba(127, 127, 127, 0.08); }
  h2 { font-size: 12.5px; margin: 0 0 8px; color: #888; font-weight: 500; }
  pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
</style>
</head>
<body>
<header>
  <h1>${safeTitle}</h1>
  <p class="meta">导出自 dsh-palm · ${escapeHtml(stamp(now))} · 已自动隐藏疑似密钥</p>
</header>
<main>
${body}
</main>
</body>
</html>
`
}
