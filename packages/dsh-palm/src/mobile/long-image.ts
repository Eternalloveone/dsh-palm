/**
 * Long-image ("长图") export: one PNG of the whole conversation.
 *
 * Markdown is for pasting into text places; a PNG is for chat apps where a
 * transcript reads badly. Two rules shape this module:
 *
 * 1. **Layout is pure.** Wrapping and vertical placement take a
 *    `measureWidth` callback, so they can be unit-tested in Node without a
 *    canvas (jsdom has no 2D context). Only `drawLongImage` touches the DOM.
 * 2. **Never exceed the canvas limit.** Mobile browsers cap canvas area
 *    (iOS Safari ~16.7 M px); a long session would silently produce a blank
 *    image. `maxHeight` stops the layout and adds a "请分段导出" note instead.
 *
 * Every row goes through {@link redactSecrets} before drawing — same rule as
 * the Markdown/HTML exports.
 *
 * @module dsh-palm/mobile/long-image
 */

import type { ExportRow } from './export.ts'
import { redactSecrets } from './redact.ts'

/** Layout knobs for one image (CSS pixels; the canvas is drawn at `scale`). */
export interface LongImageOptions {
  /** Image width in CSS px. 720 reads well in every chat bubble. */
  width: number
  /** Inner padding on all sides. */
  padding: number
  /** Body font size. */
  fontSize: number
  /** Body line height. */
  lineHeight: number
  /** Hard height cap (CSS px) — iOS canvas area limit divided by width. */
  maxHeight: number
}

/** Defaults chosen for readability on a phone screen and safe canvas area. */
export const LONG_IMAGE_DEFAULTS: LongImageOptions = {
  width: 720,
  padding: 28,
  fontSize: 15,
  lineHeight: 24,
  maxHeight: 14_000,
}

/** One laid-out line. */
export interface LongImageLine {
  kind: 'title' | 'meta' | 'role' | 'body' | 'note'
  text: string
  x: number
  y: number
}

/** Result of a layout pass. */
export interface LongImageLayout {
  width: number
  height: number
  lines: LongImageLine[]
  /** True when `maxHeight` cut the transcript short. */
  truncated: boolean
}

/**
 * Wrap one block of text to `maxWidth`.
 *
 * Breaks at a space when the current line has one (Latin words stay whole),
 * otherwise breaks between characters (CJK, URLs, code). Explicit `\n` always
 * starts a new line. An empty paragraph keeps one blank line.
 */
export function wrapLines(
  text: string,
  maxWidth: number,
  measureWidth: (text: string) => number,
): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('')
      continue
    }
    let current = ''
    for (const char of paragraph) {
      const next = current + char
      if (measureWidth(next) <= maxWidth) {
        current = next
        continue
      }
      // Overflow: prefer breaking at the last space in the candidate line.
      const breakAt = next.lastIndexOf(' ')
      if (breakAt > 0) {
        lines.push(next.slice(0, breakAt))
        current = next.slice(breakAt + 1)
      } else if (current !== '') {
        lines.push(current)
        current = char === ' ' ? '' : char
      } else {
        // A single character wider than the line: keep it; the next character
        // will push it out (no empty line is emitted).
        current = next
      }
    }
    if (current !== '') lines.push(current)
  }
  // Drop trailing blank lines (they only add empty space at the bottom).
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Lay out the title, metadata, and transcript rows.
 *
 * @param title - session title.
 * @param rows - transcript rows (already ordered).
 * @param options - geometry knobs.
 * @param measureWidth - text width for the chosen font, in CSS px.
 * @param now - export timestamp (test seam).
 */
export function layoutLongImage(
  title: string,
  rows: readonly ExportRow[],
  options: LongImageOptions,
  measureWidth: (text: string) => number,
  now: number = Date.now(),
): LongImageLayout {
  const contentWidth = options.width - options.padding * 2
  const lines: LongImageLine[] = []
  let y = options.padding

  const push = (kind: LongImageLine['kind'], text: string, x = options.padding): void => {
    lines.push({ kind, text, x, y })
    y += kind === 'title' ? options.lineHeight + 10 : options.lineHeight
  }

  for (const line of wrapLines(title === '' ? '会话' : title, contentWidth, measureWidth)) {
    push('title', line)
  }
  const date = new Date(now)
  const pad = (value: number): string => String(value).padStart(2, '0')
  push('meta', `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())} · 导出自 dsh-palm · 已自动隐藏疑似密钥`)
  y += 10

  const label = (row: ExportRow): string => {
    const time = row.at === undefined ? '' : ` · ${pad(new Date(row.at).getHours())}:${pad(new Date(row.at).getMinutes())}`
    return `${row.role === 'user' ? '我' : row.role === 'assistant' ? '助手' : '命令'}${time}`
  }

  let truncated = false
  for (const row of rows) {
    // Reserve room for the role label + a couple of body lines before starting.
    if (y + options.lineHeight * 2 > options.maxHeight) {
      truncated = true
      break
    }
    push('role', label(row))
    for (const line of wrapLines(redactSecrets(row.text), contentWidth, measureWidth)) {
      if (y + options.lineHeight > options.maxHeight) {
        truncated = true
        break
      }
      push('body', line)
    }
    if (truncated) break
    y += 18
  }

  if (truncated) {
    push('note', `（已截断，共 ${rows.length} 条消息 — 请分段导出）`)
  }

  return {
    width: options.width,
    height: Math.min(Math.ceil(y + options.padding), options.maxHeight),
    lines,
    truncated,
  }
}

/** Canvas font per line kind (the layout only decides placement). */
function fontOf(kind: LongImageLine['kind'], options: LongImageOptions): string {
  const stack = '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
  switch (kind) {
    case 'title': return `600 ${options.fontSize + 5}px ${stack}`
    case 'role': return `600 ${options.fontSize - 3}px ${stack}`
    case 'meta': return `${options.fontSize - 2}px ${stack}`
    case 'note': return `${options.fontSize - 1}px ${stack}`
    default: return `${options.fontSize}px ${stack}`
  }
}

/** Ink color per line kind. */
const INK: Record<LongImageLine['kind'], string> = {
  title: '#111118',
  meta: '#8a8a94',
  role: '#7a7a86',
  body: '#1c1c22',
  note: '#8a8a94',
}

/**
 * Draw a laid-out transcript into a canvas (sizes the canvas itself).
 *
 * Throws when the browser has no 2D context — callers catch and fall back to
 * the Markdown export rather than showing a broken share sheet.
 *
 * @param canvas - target canvas (its width/height are set here).
 * @param title - session title.
 * @param rows - transcript rows.
 * @param options - layout knobs.
 * @param scale - device pixel ratio multiplier (2 = retina-crisp).
 * @param now - timestamp seam.
 */
export function drawLongImage(
  canvas: HTMLCanvasElement,
  title: string,
  rows: readonly ExportRow[],
  options: LongImageOptions = LONG_IMAGE_DEFAULTS,
  scale = 2,
  now: number = Date.now(),
): void {
  const scratch = document.createElement('canvas').getContext('2d')
  const context = canvas.getContext('2d')
  if (scratch === null || context === null) throw new Error('canvas 2d context unavailable')

  const bodyFont = fontOf('body', options)
  scratch.font = bodyFont
  const layout = layoutLongImage(title, rows, options, text => scratch.measureText(text).width, now)

  canvas.width = Math.round(layout.width * scale)
  canvas.height = Math.round(layout.height * scale)
  context.scale(scale, scale)
  context.textBaseline = 'alphabetic'
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, layout.width, layout.height)

  for (const line of layout.lines) {
    context.font = fontOf(line.kind, options)
    context.fillStyle = INK[line.kind]
    // y is the top of the line box; the baseline sits near its bottom.
    context.fillText(line.text, line.x, line.y + options.lineHeight - 6)
  }
}
