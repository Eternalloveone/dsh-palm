/**
 * MarkdownText: assistant text rendered as GFM markdown (escape-first,
 * protocol allow-list — see markdown.ts). Long replies collapse by clamping
 * the rendered block height instead of slicing the source, so half-cut code
 * fences or tables never leak malformed markup into the DOM. User messages
 * stay plain text (CollapsibleText).
 *
 * The body splits into segments: consecutive non-code blocks collapse
 * into one escaped HTML run, while code and diff fences mount the
 * interactive CodeBlock / DiffView components (Shiki highlighting,
 * copy/insert/open, accept/reject/review) in document order.
 *
 * Streaming is incremental by construction: while the turn is pending the
 * body shows the accumulated text as an escaped plain-text preview (one
 * cheap string build per chunk, newlines as `<br />`), and the single full
 * markdown parse happens exactly once when the turn closes. This replaces
 * the old per-chunk throttle (re-parse every 120 ms of a growing string,
 * O(n^2) over a long reply) with O(chunk) stream work + O(n) final parse.
 *
 * ReasoningDisclosure (the 深度思考 accordion) lives here too: MarkdownText
 * mounts in-body think blocks as footnote disclosures, and MessageRow uses
 * the same component for the message-level reasoning row.
 * @module dsh-palm/mobile/markdown-text
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { escapeHtml, parseSegments, parseStreamPrefix, safeUrl, type MarkdownSegment, type StreamBlock } from './markdown.ts'
import { CodeBlock } from './code-block.tsx'
import { DiffView } from './diff-view.tsx'
import { ChevronUpIcon, SearchIcon } from './icons.tsx'

export const LONG_TEXT_LIMIT = 6000
/** Preview length for collapsed long text (exported for height estimation). */
export const LONG_TEXT_PREVIEW = 800
/**
 * Open paragraphs longer than this skip the inline-markdown promotion in
 * the streaming preview and render as plain escaped text instead. The
 * promotion runs five regexes over the whole open block per chunk, which
 * is O(n²) over a long no-blank-line reply; the plain path is incremental
 * (see {@link previewPlain}) and stays O(chunk) per frame.
 */
const PREVIEW_INLINE_LIMIT = 2000

/** Latest non-empty line of a streaming reasoning buffer. */
function lastLine(text: string): string {
  const trimmed = text.trimEnd()
  if (trimmed === '') return ''
  const newline = trimmed.lastIndexOf('\n')
  const line = newline === -1 ? trimmed : trimmed.slice(newline + 1)
  return line.trim() === '' ? '' : line
}

/** First non-empty line of reasoning text (the collapsed summary). */
function firstMeaningfulLine(text: string): string {
  const trimmed = text.trim()
  if (trimmed === '') return ''
  const newline = trimmed.indexOf('\n')
  return newline === -1 ? trimmed : trimmed.slice(0, newline)
}

/** Desktop Think-row parity: a searchable-thinking accordion — magnifier +
 * label + collapsed summary, one-line preview; the body is a grid-rows
 * collapse (300ms) whose inner scroll region follows the latest content.
 * Expanded bodies clamp to {@link REASONING_VISIBLE_LINES} lines with a
 * 「还有 N 行思考...」 expander so a long reasoning turn never takes over
 * the screen. */
const REASONING_VISIBLE_LINES = 5

export function ReasoningDisclosure({ text, pending, label = '深度思考' }: { text: string; pending: boolean; label?: string }) {
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const summary = pending ? lastLine(text) : firstMeaningfulLine(text)
  const lines = useMemo(() => text.split('\n'), [text])
  const hiddenLines = Math.max(0, lines.length - REASONING_VISIBLE_LINES)
  useEffect(() => {
    const el = bodyRef.current
    // Auto-follow the stream only in the full view; the clamped view stays put.
    if (open && showAll && el) el.scrollTop = el.scrollHeight
  }, [open, showAll, text])
  const visibleText = open && !showAll && hiddenLines > 0
    ? lines.slice(0, REASONING_VISIBLE_LINES).join('\n') + '\n…'
    : text
  return (
    <div className={`chat-disclosure chat-reasoning${open ? ' chat-disclosure-open' : ''}`} data-pending={pending || undefined}>
      <button
        type="button"
        className="chat-disclosure-head"
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className="chat-disclosure-icon" aria-hidden><SearchIcon /></span>
        <span className="chat-disclosure-label">{pending ? '思考中…' : label}</span>
        {!open && <span className="chat-disclosure-summary">{summary}</span>}
        <span className="chat-disclosure-caret" aria-hidden><ChevronUpIcon /></span>
      </button>
      {open && (
        <>
          <div className="chat-disclosure-body" ref={bodyRef}>{visibleText}</div>
          {hiddenLines > 0 && (
            <button
              type="button"
              className="chat-reasoning-more"
              onClick={() => { setShowAll(value => !value) }}
            >
              {showAll ? '收起' : `还有 ${hiddenLines} 行思考...`}
            </button>
          )}
        </>
      )}
    </div>
  )
}

export function MarkdownText({ text, pending, forceOpen = false, highlightQuery }: { text: string; pending: boolean; forceOpen?: boolean; highlightQuery?: string }) {
  const [open, setOpen] = useState(forceOpen)
  useEffect(() => {
    if (forceOpen) setOpen(true)
  }, [forceOpen])
  // Streaming state: blocks that became stable plus the stable prefix
  // length, so every frame re-parses only the newly-arrived tail. The
  // first pending frame renders the whole text as an escaped preview to
  // avoid a blank first paint; the effect below immediately upgrades the
  // stable parts to structured segments.
  const streamRef = useRef<{ blocks: Array<{ id: number; block: StreamBlock }>; stableLen: number } | null>(null)
  const streamIdRef = useRef(0)
  /** Text of the previous stream frame (for the text-rewrite guard). */
  const streamPrevTextRef = useRef<string | null>(null)
  /**
   * Incremental plain-preview cache: escaped text + <br /> newlines, grown
   * by the newly-arrived suffix each frame. Escaping is stateless per
   * character, so a prefix-stable text costs O(chunk) per frame instead of
   * O(n) — the long-open-paragraph path would otherwise re-escape the whole
   * block on every chunk (O(n²) over a long reply). A text rewrite (prefix
   * mismatch) rebuilds from scratch automatically.
   */
  const previewCacheRef = useRef<{ text: string; html: string } | null>(null)
  const previewPlain = (value: string): string => {
    const cache = previewCacheRef.current
    if (cache !== null && value.startsWith(cache.text)) {
      const tail = value.slice(cache.text.length)
      const html = cache.html + escapeHtml(tail).replace(/\n/g, '<br />')
      previewCacheRef.current = { text: value, html }
      return html
    }
    const html = escapeHtml(value).replace(/\n/g, '<br />')
    previewCacheRef.current = { text: value, html }
    return html
  }
  /** Inline-promoting preview for short open blocks (visual parity with the
   *  settled parse); long blocks fall back to {@link previewPlain}. */
  const previewOf = (value: string): string => {
    if (value.length > PREVIEW_INLINE_LIMIT) return previewPlain(value)
    const escaped = escapeHtml(value)
      .replace(/(^|[^`])`([^`\n]+)`(?=$|[^`])/g, '$1<code>$2</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?=$|[^*])/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
      .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
        const safe = safeUrl(url)
        return safe === null ? match : `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>`
      })
    return escaped.split(/\n{2,}/).map(block => `<p>${block.replace(/\n/g, '<br />')}</p>`).join('')
  }
  const [segments, setSegments] = useState<MarkdownSegment[]>(() => pending
    ? [{ kind: 'html', id: 0, html: previewOf(text) }]
    : parseSegments(text))
  /** Text of the last markdown parse applied to `segments` (terminal only). */
  const renderedTextRef = useRef(pending ? '' : text)
  /** Text of the last plain-text preview applied to `segments` (pending only). */
  const previewTextRef = useRef(pending ? text : '')

  useEffect(() => {
    if (pending) {
      // Skip re-renders while the text is unchanged, but ALWAYS run the
      // first parse even when a message mounts with its full text already
      // present (live replay / a one-chunk reply): the initial plain
      // preview should upgrade to structured parts immediately.
      if (streamRef.current !== null && text === previewTextRef.current) return
      previewTextRef.current = text
      let stream = streamRef.current
      if (stream === null) {
        stream = { blocks: [], stableLen: 0 }
        streamRef.current = stream
      }
      // A final assistant/message event may REPLACE the accumulated text
      // (e.g. a tool-call step's authoritative content differs from the
      // chunk deltas). Every incremental position is then invalid: compare
      // the stable prefix against the PREVIOUS frame's text at the same
      // offset and, on mismatch, reset and re-parse the whole (now
      // authoritative) text - closed paragraphs are replaced wholesale,
      // never silently re-scoped or dropped.
      const prevText = streamPrevTextRef.current
      // parseStreamPrefix normalizes CRLF before measuring, so its stableLen
      // is a normalized coordinate — compare normalized prefixes, or any
      // \r\n in the text would trip the guard on every frame and rebuild
      // the stable blocks.
      const norm = (value: string): string => value.replace(/\r\n/g, '\n')
      if (prevText !== null && stream.stableLen > 0
        && norm(text).slice(0, stream.stableLen) !== norm(prevText).slice(0, stream.stableLen)) {
        stream.blocks = []
        stream.stableLen = 0
        streamIdRef.current = 0
      }
      streamPrevTextRef.current = text
      const result = parseStreamPrefix(text, stream.stableLen)
      for (const block of result.blocks) {
        const last = stream.blocks[stream.blocks.length - 1]
        if (block.kind === 'html' && last !== undefined && last.block.kind === 'html') {
          // Adjacent html runs merge into one segment (same as terminal).
          stream.blocks[stream.blocks.length - 1] = { id: last.id, block: { kind: 'html', html: last.block.html + block.html } }
        } else {
          stream.blocks.push({ id: streamIdRef.current, block })
          streamIdRef.current += 1
        }
      }
      stream.stableLen = result.stableLen
      if (stream.blocks.length === 0) {
        // Nothing stable yet (paragraph or fence still open): keep the
        // escaped plain-text preview for the whole text.
        setSegments([{ kind: 'html', id: 0, html: previewOf(text) }])
        return
      }
      setSegments([
        ...stream.blocks.map(entry => ({ id: entry.id, ...entry.block }) as MarkdownSegment),
        ...(result.tail === '' ? [] : [{ kind: 'html', id: -1, html: previewOf(result.tail) } as MarkdownSegment]),
      ])
      return
    }
    // The moment the turn closes: exactly one full markdown parse of the
    // final text, regardless of what the preview last showed.
    if (text === renderedTextRef.current) return
    renderedTextRef.current = text
    streamRef.current = null
    streamPrevTextRef.current = null
    setSegments(parseSegments(text))
  }, [text, pending])

  const long = !pending && text.length > LONG_TEXT_LIMIT
  const collapsed = long && !open
  return (
    <div className={'chat-msg-text chat-md' + (collapsed ? ' chat-md-collapsed' : '')}>
      <div className="chat-md-body">
        {segments.map(segment => {
          if (segment.kind === 'think') return null
          if (segment.kind === 'html') {
            return <div key={segment.id} className="md-html" dangerouslySetInnerHTML={{ __html: highlightHtml(segment.html, highlightQuery) }} />
          }
          if (segment.kind === 'code') {
            return <CodeBlock key={segment.id} lang={segment.lang} code={segment.code} />
          }
          return <DiffView key={segment.id} text={segment.text} />
        })}
        {/* In-body thinking folds ride the message tail as a footnote —
            never interrupting the answer flow. */}
        {segments.some(segment => segment.kind === 'think') && (
          <div className="chat-md-notes">
            {segments.map(segment => {
              if (segment.kind !== 'think') return null
              return <ReasoningDisclosure key={segment.id} text={segment.text} pending={false} label="思考过程" />
            })}
          </div>
        )}
      </div>
      {long && (
        <button type="button" className="chat-msg-toggle" onClick={() => { setOpen(value => !value) }}>
          {open ? '收起' : '展开全文（' + text.length + ' 字）'}
        </button>
      )}
    </div>
  )
}

/** Long assistant text collapses behind an explicit expand toggle. */
export function CollapsibleText({ text, forceOpen = false, highlightQuery }: { text: string; forceOpen?: boolean; highlightQuery?: string }) {
  const [open, setOpen] = useState(forceOpen)
  useEffect(() => {
    if (forceOpen) setOpen(true)
  }, [forceOpen])
  const highlighted = (value: string): ReactNode => highlightPlain(value, highlightQuery)
  if (text.length <= LONG_TEXT_LIMIT) {
    return <span className="chat-msg-text">{highlighted(text)}</span>
  }
  const shown = open ? text : text.slice(0, LONG_TEXT_PREVIEW)
  return (
    <span className="chat-msg-text">
      {highlighted(shown)}{!open ? '…' : ''}
      <button type="button" className="chat-msg-toggle" onClick={() => { setOpen(value => !value) }}>
        {open ? '收起' : `展开全文（${text.length} 字）`}
      </button>
    </span>
  )
}

function escapedPattern(query: string | undefined): RegExp | undefined {
  const value = query?.trim()
  if (value === undefined || value === '') return undefined
  const terms = value.split(/\s+/).filter(Boolean)
  const escaped = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(escaped.sort((a, b) => b.length - a.length).join('|'), 'gi')
}

/** Highlight only text between markup tags; fenced code/diff segments never enter here. */
function highlightHtml(html: string, query: string | undefined): string {
  const pattern = escapedPattern(query)
  if (pattern === undefined) return html
  return html.split(/(<[^>]+>)/g).map(part => part.startsWith('<')
    ? part
    : part.replace(pattern, match => `<mark class="chat-search-mark">${match}</mark>`)).join('')
}

function highlightPlain(text: string, query: string | undefined): ReactNode {
  const pattern = escapedPattern(query)
  if (pattern === undefined) return text
  const parts: ReactNode[] = []
  let from = 0
  for (const match of text.matchAll(pattern)) {
    const at = match.index
    if (at > from) parts.push(text.slice(from, at))
    parts.push(<mark className="chat-search-mark" key={`${at}:${match[0]}`}>{match[0]}</mark>)
    from = at + match[0].length
  }
  if (from < text.length) parts.push(text.slice(from))
  return parts
}
