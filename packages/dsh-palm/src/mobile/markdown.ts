/**
 * A compact GFM-subset markdown renderer for the mobile chat: headings,
 * paragraphs, fenced + inline code, bold/italic/strikethrough, links,
 * images, lists, blockquotes, hr, and tables. All HTML is escaped before
 * transformation — the output only ever contains the renderer's own tags.
 * Dependency-free on purpose (the mobile bundle stays at ~456 KB); the
 * escape-first + protocol allow-list design mirrors the desktop panel's
 * preview renderer (dsh-aionui-panel/src/client/preview/markdown.ts).
 *
 * Two entry points:
 * - {@link renderMarkdown} — the classic string renderer (tests, reference).
 * - {@link parseMarkdown} / {@link parseSegments} — block-level parsing for
 *   the React message body: code and diff fences come out as typed blocks
 *   so the surface can mount interactive components (Shiki highlighting,
 *   copy/insert/open, diff accept/reject/review) while every other block
 *   still renders as one escaped HTML string.
 *
 * Code fences render with the full chrome — language label, copy / insert /
 * open buttons — and ```diff fences become diff blocks. Inline text also
 * links file-path-like tokens (`src/main.ts`, `D:\work_REDACTED\a.ts`) to the host
 * file opener.
 * @module dsh-palm/mobile/markdown
 */

/** HTML special-character map for {@link escapeHtml}. */
const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * Escape HTML special characters. One regex pass replaces all five
 * characters through the map; the output is identical to five sequential
 * passes (each replacement string contains none of the escaped characters),
 * and the common no-special-character case scans the string only once
 * instead of five times.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => HTML_ESCAPE_MAP[char] ?? char)
}

/**
 * Guard a raw link/image target against dangerous protocols. Returns the
 * (trimmed) raw string when safe, else null. Only http:, https:, mailto:,
 * fragment anchors (#...) and strictly relative paths are allowed; anything
 * with another scheme — javascript:, data:, vbscript:, etc. — or a
 * protocol-relative //host target (the browser resolves it against the
 * current scheme, reaching an arbitrary origin) is rejected so the value
 * never reaches dangerouslySetInnerHTML.
 */
export function safeUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (trimmed.startsWith('#')) return trimmed
  if (trimmed.startsWith('//')) return null
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed)
  if (scheme === null) return trimmed
  const name = scheme[1].toLowerCase()
  return name === 'http' || name === 'https' || name === 'mailto' ? trimmed : null
}

/** Find the ')' closing a link/image target, skipping nested parens. */
function findCloseParen(text: string, from: number): number {
  let depth = 0
  for (let i = from; i < text.length; i += 1) {
    const char = text[i]
    if (char === '(') depth += 1
    else if (char === ')') {
      if (depth === 0) return i
      depth -= 1
    }
  }
  return -1
}

/* ── file-path linking ─────────────────────────────────────────────────
   Path-like tokens (src/main.ts, ./lib/x.ts, D:\work_REDACTED\a.ts) become
   clickable file links. The regex requires at least one separator and a
   file extension, which keeps dates ("2024/01/15") and bare filenames
   ("file.ts") out; a sticky anchor matches only at the current position
   so the inline pass consumes exactly the token. */

const FILE_PATH_RE = /(?:[A-Za-z]:[\\/]|\.{1,2}[\\/])?(?:[\w@.-]+[\\/])+[\w@.-]+\.(?:[A-Za-z0-9]{1,8})/y

/** Match a file path starting exactly at `from`; null when none. */
function matchFilePath(text: string, from: number): { path: string; end: number } | null {
  const char = text[from]
  if (char === undefined) return null
  if (!/[\w./\\]/.test(char)) return null
  // The path must start at a token boundary: a preceding word char, ':',
  // '/' or '.' means the match is a continuation (e.g. the "example.com"
  // after "https://", or "src" inside "xsrc").
  const prev = from > 0 ? text[from - 1]! : ''
  if (prev !== '' && /[\w:/.@]/.test(prev)) return null
  FILE_PATH_RE.lastIndex = from
  const match = FILE_PATH_RE.exec(text)
  if (match === null) return null
  const path = match[0]
  // A path needs at least one separator; bare URLs and www domains are not
  // file paths.
  if (!/[\\/]/.test(path)) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return null
  if (/^www\./i.test(path)) return null
  return { path, end: from + path.length }
}

/** Inline pass: code spans, bold, italic, strikethrough, images, links, file paths. */
export function renderInline(text: string): string {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const char = text[i]
    // Fenced inline code first.
    if (char === '`') {
      const end = text.indexOf('`', i + 1)
      if (end !== -1) {
        out += '<code>' + escapeHtml(text.slice(i + 1, end)) + '</code>'
        i = end + 1
        continue
      }
    }
    // Image ![alt](src)
    if (char === '!' && text[i + 1] === '[') {
      const close = text.indexOf('](', i + 2)
      if (close !== -1) {
        const parenEnd = findCloseParen(text, close + 2)
        if (parenEnd !== -1) {
          const alt = text.slice(i + 2, close)
          const src = text.slice(close + 2, parenEnd)
          const safe = safeUrl(src)
          if (safe === null) {
            out += escapeHtml(alt)
          } else {
            const srcEsc = escapeHtml(safe).replace(/\s+/g, '%20')
            out += '<img alt="' + escapeHtml(alt) + '" src="' + srcEsc + '" />'
          }
          i = parenEnd + 1
          continue
        }
      }
    }
    // Link [text](href)
    if (char === '[') {
      const close = text.indexOf('](', i + 1)
      if (close !== -1) {
        const parenEnd = findCloseParen(text, close + 2)
        if (parenEnd !== -1) {
          const label = text.slice(i + 1, close)
          const href = text.slice(close + 2, parenEnd)
          const safe = safeUrl(href)
          if (safe === null) {
            out += renderInline(label)
          } else {
            out += '<a href="' + escapeHtml(safe) + '" target="_blank" rel="noopener noreferrer">' + renderInline(label) + '</a>'
          }
          i = parenEnd + 1
          continue
        }
      }
    }
    // File path → host file-opener link.
    const path = matchFilePath(text, i)
    if (path !== null) {
      out += '<a class="file-link" data-path="' + escapeHtml(path.path) + '">' + escapeHtml(path.path) + '</a>'
      i = path.end
      continue
    }
    // Bold **text**
    if (char === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2)
      if (end !== -1) {
        out += '<strong>' + renderInline(text.slice(i + 2, end)) + '</strong>'
        i = end + 2
        continue
      }
    }
    // Italic *text*
    if (char === '*' && text[i - 1] !== '*' && text[i + 1] !== '*') {
      const end = text.indexOf('*', i + 1)
      if (end !== -1 && text[end + 1] !== '*') {
        out += '<em>' + renderInline(text.slice(i + 1, end)) + '</em>'
        i = end + 1
        continue
      }
    }
    // Strikethrough ~~text~~
    if (char === '~' && text[i + 1] === '~') {
      const end = text.indexOf('~~', i + 2)
      if (end !== -1) {
        out += '<del>' + renderInline(text.slice(i + 2, end)) + '</del>'
        i = end + 2
        continue
      }
    }
    // Hard line break: keep the settled DOM identical to the streaming
    // preview (previewOf renders \n as <br />), or a multi-line paragraph
    // collapses into a single space (and its 6px line gap vanishes) the
    // moment the turn closes.
    if (char === '\n') {
      out += '<br />'
      i += 1
      continue
    }
    out += escapeHtml(char)
    i += 1
  }
  return out
}

/* ── block model ─────────────────────────────────────────────────────── */

/**
 * Inline thinking tag pair — ` thinking… response` — extracted from
 * assistant body text into a collapsed think block. The API already
 * delivers separate reasoning via `message.reasoning` (RenderedDisclosure);
 * this handles models that inline their thinking into the body instead.
 * Matching is case-insensitive and tolerates attributes (`<think depth="3">`).
 */
export const THINK_OPEN_RE = /<think\b[^>]*>/i
export const THINK_CLOSE_RE = /<\/think\s*>/i

/** One parsed markdown block. Inline content is pre-rendered HTML. */
export type MarkdownBlock =
  | { type: 'paragraph'; html: string }
  | { type: 'heading'; level: number; html: string }
  | { type: 'hr' }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; head: string[]; rows: string[][] }
  | { type: 'quote'; html: string }
  | { type: 'code'; lang: string; code: string; diff: boolean }
  | { type: 'think'; text: string }

/** One renderable segment of a message body: HTML run or interactive block. */
export type MarkdownSegment =
  | { kind: 'html'; id: number; html: string }
  | { kind: 'code'; id: number; lang: string; code: string }
  | { kind: 'diff'; id: number; text: string }
  | { kind: 'think'; id: number; text: string }

/* Inline SVG glyphs for the static code-block chrome (16px, stroke = currentColor). */
const ICON_COPY = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/></svg>'
const ICON_ENTER = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 4v9"/><path d="M7.5 9.5 12 14l4.5-4.5"/><path d="M5 19h14"/></svg>'
const ICON_UPPER_RIGHT = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v5a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19V7a1.5 1.5 0 0 1 1.5-1.5H10"/></svg>'

/* Think-block chrome glyphs (14px, matching the chat-disclosure icons). */
const ICON_THINK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/></svg>'
const ICON_CHEVRON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 14 6-6 6 6"/></svg>'

/** Static code-block chrome (the string renderer's reference output). */
function codeBlockHtml(lang: string, code: string): string {
  const langLabel = lang === '' ? 'text' : lang
  const codeHtml = code.split('\n').map(codeLine => '<span class="code-line">' + (escapeHtml(codeLine) || ' ') + '</span>').join('')
  return '<div class="code-block" data-lang="' + escapeHtml(langLabel) + '">'
    + '<div class="code-head"><span class="code-lang">' + escapeHtml(langLabel) + '</span>'
    + '<div class="code-actions">'
    + '<button type="button" class="code-btn code-copy" aria-label="复制代码">' + ICON_COPY + '</button>'
    + '<button type="button" class="code-btn code-insert" aria-label="插入到编辑器">' + ICON_ENTER + '</button>'
    + '<button type="button" class="code-btn code-open" aria-label="新标签页打开">' + ICON_UPPER_RIGHT + '</button>'
    + '</div></div>'
    + '<div class="code-body"><pre><code>' + codeHtml + '</code></pre></div>'
    + '</div>'
}

/** Static diff-block chrome (the string renderer's reference output). */
function diffBlockHtml(code: string): string {
  const codeHtml = code.split('\n').map(codeLine => '<span class="code-line">' + (escapeHtml(codeLine) || ' ') + '</span>').join('')
  return '<div class="diff-block" data-lang="diff">'
    + '<div class="diff-head"><span class="diff-label">变更对比</span></div>'
    + '<div class="diff-body"><pre><code>' + codeHtml + '</code></pre></div>'
    + '</div>'
}

/** Static think-block chrome: a native `<details>` collapse (the string
 * renderer's reference output). Reuses the chat-disclosure classes so the
 * look matches the interactive ReasoningDisclosure exactly. */
function thinkBlockHtml(text: string): string {
  return '<details class="chat-disclosure think-block">'
    + '<summary class="chat-disclosure-head">'
    + '<span class="chat-disclosure-icon">' + ICON_THINK + '</span>'
    + '<span class="chat-disclosure-label">思考过程</span>'
    + '<span class="chat-disclosure-caret">' + ICON_CHEVRON + '</span>'
    + '</summary>'
    + '<div class="chat-disclosure-body think-body">' + escapeHtml(text) + '</div>'
    + '</details>'
}

/** Render one block to its HTML string. */
export function blockToHtml(block: MarkdownBlock): string {
  switch (block.type) {
    case 'paragraph':
      return '<p>' + block.html + '</p>'
    case 'heading':
      return '<h' + block.level + '>' + block.html + '</h' + block.level + '>'
    case 'hr':
      return '<hr />'
    case 'list':
      return (block.ordered ? '<ol>' : '<ul>') + block.items.map(item => '<li>' + item + '</li>').join('') + (block.ordered ? '</ol>' : '</ul>')
    case 'table': {
      const head = '<thead><tr>' + block.head.map(cell => '<th>' + cell + '</th>').join('') + '</tr></thead>'
      const body = block.rows.length > 0
        ? '<tbody>' + block.rows.map(row => '<tr>' + row.map(cell => '<td>' + cell + '</td>').join('') + '</tr>').join('') + '</tbody>'
        : ''
      return '<table>' + head + body + '</table>'
    }
    case 'quote':
      return '<blockquote><p>' + block.html + '</p></blockquote>'
    case 'code':
      return block.diff ? diffBlockHtml(block.code) : codeBlockHtml(block.lang, block.code)
    case 'think':
      return thinkBlockHtml(block.text)
  }
}

/** Parse a markdown document into blocks (block pass). */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let i = 0
  const n = lines.length

  const flushParagraph = (buffer: string[]): void => {
    if (buffer.length === 0) return
    blocks.push({ type: 'paragraph', html: renderInline(buffer.join('\n')) })
    buffer.length = 0
  }

  let paragraph: string[] = []
  while (i < n) {
    const line = lines[i]

    // Fenced code block: chrome wrapper (language label + copy button),
    // one span per line so the optional line-number counter can count.
    // A ```diff fence becomes a diff block (interactive diff view).
    const fence = /^```([\w+-]*)\s*$/.exec(line)
    if (fence !== null) {
      flushParagraph(paragraph)
      const lang = fence[1] ?? ''
      i += 1
      const code: string[] = []
      while (i < n && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i])
        i += 1
      }
      i += 1 // closing fence
      blocks.push({ type: 'code', lang, code: code.join('\n'), diff: lang.toLowerCase() === 'diff' })
      continue
    }

    // Inline thinking tag ` thinking… response` → a collapsed think block.
    // Extraction happens at the block level only (never inside code fences,
    // which the branch above consumes whole). A tag without a matching
    // close degrades to an ordinary paragraph, so literal `<think` in
    // prose never swallows the rest of the message. Text after the closing
    // tag on the same line keeps flowing in the surrounding paragraph.
    const thinkOpen = THINK_OPEN_RE.exec(line)
    if (thinkOpen !== null) {
      flushParagraph(paragraph)
      const prefix = line.slice(0, thinkOpen.index)
      const rest = line.slice(thinkOpen.index + thinkOpen[0].length)
      let closeLine = 0
      let closeMatch = THINK_CLOSE_RE.exec(rest)
      if (closeMatch === null) {
        closeLine = 1
        while (closeLine < n - i) {
          closeMatch = THINK_CLOSE_RE.exec(lines[i + closeLine] ?? '')
          if (closeMatch !== null) break
          closeLine += 1
        }
      }
      if (closeMatch === null) {
        // Unclosed tag: re-parse the opening line as ordinary text.
        paragraph.push(line)
        i += 1
        continue
      }
      const body: string[] = []
      if (closeLine === 0) {
        body.push(rest.slice(0, closeMatch.index))
      } else {
        body.push(rest)
        for (let k = i + 1; k < i + closeLine; k += 1) body.push(lines[k] ?? '')
        body.push((lines[i + closeLine] ?? '').slice(0, closeMatch.index))
      }
      const thinkText = body.join('\n').trim()
      // Text before the opening tag reads BEFORE the folded block, so it is
      // emitted as its own paragraph right away (the trailing text after the
      // close stays in the buffer and lands after the block).
      if (prefix.trim() !== '') blocks.push({ type: 'paragraph', html: renderInline(prefix) })
      if (thinkText !== '') blocks.push({ type: 'think', text: thinkText })
      const trailing = closeLine === 0
        ? rest.slice(closeMatch.index + closeMatch[0].length)
        : (lines[i + closeLine] ?? '').slice(closeMatch.index + closeMatch[0].length)
      if (trailing.trim() !== '') paragraph.push(trailing)
      i += closeLine + 1
      continue
    }

    // Heading.
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      flushParagraph(paragraph)
      blocks.push({ type: 'heading', level: heading[1].length, html: renderInline(heading[2] ?? '') })
      i += 1
      continue
    }

    // Horizontal rule.
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushParagraph(paragraph)
      blocks.push({ type: 'hr' })
      i += 1
      continue
    }

    // Table: header row then separator row.
    if (line.includes('|') && i + 1 < n && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flushParagraph(paragraph)
      const headerCells = splitTableRow(line)
      i += 2
      const rows: string[][] = []
      while (i < n && lines[i].includes('|')) {
        rows.push(splitTableRow(lines[i]))
        i += 1
      }
      blocks.push({
        type: 'table',
        head: headerCells.map(cell => renderInline(cell)),
        rows: rows.map(row => row.map(cell => renderInline(cell))),
      })
      continue
    }

    // Blockquote (one level).
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote !== null) {
      flushParagraph(paragraph)
      const body: string[] = []
      while (i < n) {
        const q = /^>\s?(.*)$/.exec(lines[i])
        if (q === null) break
        body.push(q[1] ?? '')
        i += 1
      }
      blocks.push({ type: 'quote', html: body.map(bodyLine => renderInline(bodyLine)).join('<br />') })
      continue
    }

    // Unordered list.
    const ul = /^\s*([-*+])\s+(.*)$/.exec(line)
    if (ul !== null) {
      flushParagraph(paragraph)
      const items: string[] = []
      while (i < n) {
        const item = /^\s*([-*+])\s+(.*)$/.exec(lines[i])
        if (item === null) break
        items.push(renderInline(item[2] ?? ''))
        i += 1
      }
      blocks.push({ type: 'list', ordered: false, items })
      continue
    }

    // Ordered list.
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (ol !== null) {
      flushParagraph(paragraph)
      const items: string[] = []
      while (i < n) {
        const item = /^\s*\d+[.)]\s+(.*)$/.exec(lines[i])
        if (item === null) break
        items.push(renderInline(item[1] ?? ''))
        i += 1
      }
      blocks.push({ type: 'list', ordered: true, items })
      continue
    }

    // Blank line: flush the paragraph.
    if (line.trim() === '') {
      flushParagraph(paragraph)
      i += 1
      continue
    }

    paragraph.push(line)
    i += 1
  }
  flushParagraph(paragraph)
  return blocks
}

/** Render a markdown document to HTML (block pass). */
export function renderMarkdown(source: string): string {
  return parseMarkdown(source).map(blockToHtml).join('\n')
}

/**
 * Split a markdown document into renderable segments: consecutive
 * non-code blocks collapse into one HTML run (rendered as a single
 * escaped string), while code and diff fences come out as typed segments
 * for the interactive React components. Order is preserved.
 */
export function parseSegments(source: string): MarkdownSegment[] {
  const blocks = parseMarkdown(source)
  const segments: MarkdownSegment[] = []
  let htmlBuffer: string[] = []
  let id = 0
  const flush = (): void => {
    if (htmlBuffer.length === 0) return
    segments.push({ kind: 'html', id: id, html: htmlBuffer.join('\n') })
    id += 1
    htmlBuffer = []
  }
  for (const block of blocks) {
    if (block.type === 'code') {
      flush()
      if (block.diff) {
        segments.push({ kind: 'diff', id, text: block.code })
      } else {
        segments.push({ kind: 'code', id, lang: block.lang, code: block.code })
      }
      id += 1
    } else if (block.type === 'think') {
      // In-body thinking gets its own segment so the surface can mount the
      // interactive collapsed disclosure (same chrome as the reasoning row).
      flush()
      segments.push({ kind: 'think', id, text: block.text })
      id += 1
    } else {
      htmlBuffer.push(blockToHtml(block))
    }
  }
  flush()
  return segments
}

/** Split one table row into cells (respecting the leading/trailing pipes). */
function splitTableRow(line: string): string[] {
  const trimmed = line.trim()
  const inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed
  const withoutTrailing = inner.endsWith('|') ? inner.slice(0, -1) : inner
  return withoutTrailing.split('|').map((cell) => cell.trim())
}

/* ── streaming prefix parse ────────────────────────────────────────────
   While a turn streams, the surface cannot wait for the closing
   parseSegments call: the phone would show one unbroken plain-text blob
   for the whole reply. {@link parseStreamPrefix} therefore re-scans ONLY
   the text after the last stable boundary on every frame and returns the
   chunks that just became stable:

   - Paragraphs close at a blank line.
   - Code fences (line-start ```) close at their matching ``` line.
   - In-body thinking tags (`<think…>… response`) close at their tag.
   - Diff fences close like code fences and come out as diff blocks.

   Everything past the last stable boundary is returned as `tail` and the
   surface renders it as an escaped plain-text preview until it closes.
   Cost per frame is O(newly-arrived text); a long open fence is re-scanned
   per frame but that is bounded by the fence length, never the whole text.
   The terminal parse (parseSegments) stays authoritative on turn close. */

export type StreamBlock =
  | { kind: 'html'; html: string }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'diff'; text: string }
  | { kind: 'think'; text: string }

export interface StreamParseResult {
  /** Blocks that became stable since the previous call (caller assigns ids). */
  blocks: StreamBlock[]
  /** Length of the stable prefix of `text` (caller passes it back as `from`). */
  stableLen: number
  /** Unstable suffix: render as an escaped plain-text preview. */
  tail: string
}

const FENCE_OPEN_RE = /^```([\w+-]*)\s*$/
const FENCE_CLOSE_RE = /^```\s*$/

/**
 * Incremental streaming parse. `from` is the stableLen of the previous
 * frame (0 on the first frame or after the text shrank). Normalizes CRLF
 * like {@link parseMarkdown}; `stableLen` is relative to the normalized
 * string, which is what the caller should keep and pass back.
 */
export function parseStreamPrefix(source: string, from: number): StreamParseResult {
  const text = source.replace(/\r\n/g, '\n')
  const n = text.length
  if (from > n || from < 0) from = 0
  const blocks: StreamBlock[] = []
  let i = from
  let paragraph: string[] | null = null
  let paragraphStart = from

  const flushParagraph = (): void => {
    if (paragraph !== null && paragraph.length > 0) {
      blocks.push({ kind: 'html', html: '<p>' + renderInline(paragraph.join('\n')) + '</p>' })
    }
    paragraph = null
  }

  while (i < n) {
    const lineEnd = text.indexOf('\n', i)
    const line = lineEnd === -1 ? text.slice(i) : text.slice(i, lineEnd)
    const lineNext = lineEnd === -1 ? n : lineEnd + 1

    // Code / diff fence: stable once the closing fence line appears.
    const fenceOpen = FENCE_OPEN_RE.exec(line)
    if (fenceOpen !== null) {
      flushParagraph()
      const lang = fenceOpen[1] ?? ''
      let closeStart = -1
      let closeEnd = -1
      let cursor = lineNext
      while (cursor < n) {
        const le = text.indexOf('\n', cursor)
        const ln = le === -1 ? text.slice(cursor) : text.slice(cursor, le)
        if (FENCE_CLOSE_RE.test(ln)) {
          closeStart = cursor
          closeEnd = le === -1 ? n : le + 1
          break
        }
        cursor = le === -1 ? n : le + 1
      }
      if (closeStart === -1) break // fence still open
      const code = text.slice(lineNext, closeStart).replace(/\n$/, '')
      if (lang.toLowerCase() === 'diff') {
        blocks.push({ kind: 'diff', text: code })
      } else {
        blocks.push({ kind: 'code', lang, code })
      }
      i = closeEnd
      continue
    }

    // In-body thinking tag (any column, matching the terminal parse — an
    // in-line tag must not change shape when the message settles): stable
    // once the closing tag lands. An unclosed tag leaves the whole block
    // (from this line on) in the tail.
    const thinkOpen = THINK_OPEN_RE.exec(line)
    if (thinkOpen !== null) {
      flushParagraph()
      // Text before the opening tag reads BEFORE the folded block as its own
      // paragraph, exactly like the terminal parse.
      if (thinkOpen.index > 0) {
        const prefix = line.slice(0, thinkOpen.index)
        if (prefix.trim() !== '') blocks.push({ kind: 'html', html: '<p>' + renderInline(prefix) + '</p>' })
      }
      const rest = line.slice(thinkOpen.index + thinkOpen[0].length)
      const sameLine = THINK_CLOSE_RE.exec(rest)
      if (sameLine !== null) {
        const body = rest.slice(0, sameLine.index).trim()
        if (body !== '') blocks.push({ kind: 'think', text: body })
        const trailing = rest.slice(sameLine.index + sameLine[0].length)
        if (trailing.trim() !== '') {
          paragraph = [trailing]
          paragraphStart = i + thinkOpen.index + thinkOpen[0].length + sameLine.index + sameLine[0].length
        }
        i = lineNext
        continue
      }
      // Multi-line: collect content lines until a line contains the close.
      // The opener's own line content (rest) is the first body line.
      const collected: string[] = [rest]
      let cursor = lineNext
      let closed = false
      while (cursor < n) {
        const le = text.indexOf('\n', cursor)
        const ln = le === -1 ? text.slice(cursor) : text.slice(cursor, le)
        const m = THINK_CLOSE_RE.exec(ln)
        if (m !== null) {
          const body = [...collected, ln.slice(0, m.index)].join('\n').trim()
          if (body !== '') blocks.push({ kind: 'think', text: body })
          const trailing = ln.slice(m.index + m[0].length)
          if (trailing.trim() !== '') {
            paragraph = [trailing]
            paragraphStart = cursor + m.index + m[0].length
          }
          i = le === -1 ? n : le + 1
          closed = true
          break
        }
        collected.push(ln)
        cursor = le === -1 ? n : le + 1
      }
      if (!closed) break // think block still open: keep the entire block in the tail
      continue
    }

    // Paragraph: collect lines until a blank line (stable), a fence opener,
    // or a line-start think tag. EOF with content means the paragraph is
    // still open — leave it (and everything after) as the unstable tail.
    if (paragraph === null) {
      paragraph = []
      paragraphStart = i
    }
    if (line.trim() === '') {
      flushParagraph()
      i = lineNext
      continue
    }
    paragraph.push(line)
    i = lineNext
  }

  // EOF: an open paragraph is NOT stable — its text stays in the tail.
  if (paragraph !== null && paragraph.length > 0) i = paragraphStart
  return { blocks, stableLen: i, tail: text.slice(i) }
}
