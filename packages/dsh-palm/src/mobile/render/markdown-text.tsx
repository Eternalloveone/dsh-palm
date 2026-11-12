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

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { escapeHtml, parseSegments, parseStreamPrefix, safeUrl, type MarkdownSegment, type StreamBlock } from './markdown.ts'
import {
  clearLocalImageFailure,
  isLocalImageFailed,
  loadLocalImageUrl,
  localImageFailureReason,
} from '../platform/local-images.ts'
/**
 * 把读不到的图换成一枚小牌子：破图什么都说明不了，牌子上写着「哪张、哪个路径」，
 * 用户才知道是路径问题而不是 App 坏了（2026-11-10 真机：「经常正文里的图片没法显示」）。
 * 用 span 顶替 img —— `<img>` 是替换元素，`::after` 里的路径根本不会渲染。
 *
 * 2026-11-11 真机补充：牌子上还要写**为什么**（主机上没有 / 读取超时 / 图片太大），
 * 并且**点一下就能重试** —— 一次失败常常只是"图还没写完"，不该永久钉死。
 *
 * @param image - 正在被替换的 img（alt 与路径都从它身上取）
 * @param path - 作者写的路径
 * @param reason - 失败原因（没有就只说未找到）
 */
function markMissingImage(image: HTMLImageElement, path: string, reason?: string): void {
  const alt = (image.getAttribute('alt') ?? '').trim()
  const chip = document.createElement('span')
  chip.className = 'md-img-missing'
  chip.setAttribute('data-local-path', path)
  // 点牌子重试时要还原成 img：alt 得先存下来，否则重试成功后说明文字丢了。
  chip.setAttribute('data-local-alt', alt)
  chip.setAttribute('role', 'button')
  chip.tabIndex = 0
  chip.title = `${reason === undefined ? '主机上找不到这张图' : `读不到这张图（${reason}）`}：${path} · 点一下重试`
  chip.textContent = `${alt === '' ? '图片' : alt}未找到 · ${path}${reason === undefined ? '' : ` · ${reason}`}`
  image.replaceWith(chip)
}

/**
 * 把牌子还原成待水合的 `<img>`（`data-local-src` 原样带回）。
 *
 * 为什么必须还原：React 的 `dangerouslySetInnerHTML` 只在 HTML 字符串变化时才重写
 * 子树，牌子一旦替换掉 img，后续任何重渲染都**不会**把 img 变回来 —— 只清失败缓存
 * 是不够的，必须自己把节点换回去，水合 effect 才有东西可水合。
 *
 * @param chip - 「未找到」牌子
 * @returns 还原出来的 img（点重试后水合 effect 会接管它）
 */
function restoreImageFromChip(chip: HTMLElement): HTMLImageElement | null {
  const path = chip.getAttribute('data-local-path')
  if (path === null || path === '') return null
  const image = document.createElement('img')
  image.className = 'md-local-img'
  image.setAttribute('data-local-src', path)
  image.setAttribute('alt', chip.getAttribute('data-local-alt') ?? '')
  image.setAttribute('loading', 'lazy')
  image.setAttribute('decoding', 'async')
  chip.replaceWith(image)
  return image
}
import { CodeBlock } from './code-block.tsx'
import { DiffView } from './diff-view.tsx'
import { ChevronUpIcon, SearchIcon } from '../components/icons.tsx'
import { Button } from '../ui/primitives.tsx'

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
      <Button
        type="button"
        className="chat-disclosure-head"
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className="chat-disclosure-icon" aria-hidden><SearchIcon /></span>
        <span className="chat-disclosure-label">{pending ? '思考中…' : label}</span>
        {!open && <span className="chat-disclosure-summary">{summary}</span>}
        <span className="chat-disclosure-caret" aria-hidden><ChevronUpIcon /></span>
      </Button>
      {open && (
        <>
          <div className="chat-disclosure-body" ref={bodyRef}>{visibleText}</div>
          {hiddenLines > 0 && (
            <Button
              type="button"
              className="chat-reasoning-more"
              onClick={() => { setShowAll(value => !value) }}
            >
              {showAll ? '收起' : `还有 ${hiddenLines} 行思考...`}
            </Button>
          )}
        </>
      )}
    </div>
  )
}

export function MarkdownText({ text, pending, forceOpen = false, highlightQuery, sessionId }: { text: string; pending: boolean; forceOpen?: boolean; highlightQuery?: string; sessionId?: string }) {
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
   *  settled parse). Extracted so the over-limit path can reuse it for the head. */
  const inlinePreview = (value: string): string => {
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
  /** Inline-promoting preview for short open blocks (visual parity with the
   *  settled parse); long blocks keep their head formatted and escape only the
   *  tail — see the comment below.
   *
   *  2026-11-06 真机：长回答写到第 2001 个字符时，屏幕上方**已经看到**的粗体/
   *  行内代码会当场变回 `**` 与反引号原文，`<p>` 的外边距也消失 → 整段高度跳变。
   *  旧实现超过阈值就整块退回 {@link previewPlain}。现在只对**新增尾部**退化为
   *  纯文本：头部 2000 字保持格式化（正则成本仍有上界），已读内容不再被改写。 */
  const previewOf = (value: string): string => {
    if (value.length <= PREVIEW_INLINE_LIMIT) return inlinePreview(value)
    return inlinePreview(value.slice(0, PREVIEW_INLINE_LIMIT))
      + previewPlain(value.slice(PREVIEW_INLINE_LIMIT))
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
    const next = parseSegments(text)
    // 流式尾部一直是 id -1；收尾若换成 0..N，React 会把那一块当新节点卸载重挂
    // （代码块重挂 = 重新高亮，读者正盯着最后一行时会看到一次闪动）。保留 -1，
    // 让收尾只**更新**尾部内容，不换节点。过去的稳定块 id 本来就按顺序分配，
    // 与本次解析一致。
    if (segments.some(segment => segment.id === -1) && next.length > 0) {
      const last = next[next.length - 1]
      if (last !== undefined && last.kind === 'html') last.id = -1
    }
    setSegments(next)
  }, [text, pending])

  const long = !pending && text.length > LONG_TEXT_LIMIT
  const collapsed = long && !open
  const bodyRef = useRef<HTMLDivElement | null>(null)
  /**
   * 内容变短时通知聊天页（收尾折叠到 45vh、流式块被更短的 settled parse 替换）。
   * 这里只报事实（多高 → 多高、少了多少），是否回钉由 ChatView 判断：
   * 只有「缩之前就贴底」的读者才该被拉回底部，读历史的人不能被拽走。
   */
  const lastBodyHeightRef = useRef(0)
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (el === null) return
    const height = el.offsetHeight
    const previous = lastBodyHeightRef.current
    lastBodyHeightRef.current = height
    if (previous > 0 && height < previous - 24) {
      window.dispatchEvent(new CustomEvent('palm:content-shrunk', {
        detail: { delta: previous - height },
      }))
    }
  }, [segments, collapsed])
  /**
   * 本地 markdown 图片的**重试脉冲**。
   *
   * 一次读取失败（图还没写完、链路抖一下）不该让正文永久停在「未找到」上：
   * 点牌子、或这一轮结束时，把 tick 加一，水合 effect 会重跑一遍。
   */
  const [retryTick, setRetryTick] = useState(0)
  /**
   * 一轮结束（pending 转 false）= agent 的文件都落地了：清掉本会话的失败记录，
   * 把牌子换回 img，再敲一次 tick 让水合重跑。
   *
   * 顺序要紧：这个 effect 必须排在**水合 effect 之前**，否则同一帧里水合先按旧
   * 失败缓存把图换成牌子，清缓存就白清了。
   */
  const wasPendingRef = useRef(pending)
  useEffect(() => {
    const wasPending = wasPendingRef.current
    wasPendingRef.current = pending
    if (pending || !wasPending) return
    const root = bodyRef.current
    if (root === null || sessionId === undefined) return
    clearLocalImageFailure(sessionId)
    for (const chip of root.querySelectorAll<HTMLElement>('.md-img-missing')) restoreImageFromChip(chip)
    setRetryTick(value => value + 1)
  }, [pending, sessionId])
  /**
   * 点「未找到」牌子重试（2026-11-11 真机：图晚几秒才写出来，而牌子不会自己好）。
   * 事件委托挂在正文根节点上：牌子是由 innerHTML 造的，逐个绑监听会在每次重解析后丢。
   */
  useEffect(() => {
    const root = bodyRef.current
    if (root === null || sessionId === undefined) return
    const onClick = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      const chip = target.closest('.md-img-missing')
      if (!(chip instanceof HTMLElement)) return
      const path = chip.getAttribute('data-local-path')
      if (path === null || path === '') return
      clearLocalImageFailure(sessionId, path)
      if (restoreImageFromChip(chip) === null) return
      setRetryTick(value => value + 1)
    }
    root.addEventListener('click', onClick)
    return () => { root.removeEventListener('click', onClick) }
  }, [sessionId])
  /**
   * Local markdown images carry their path on `data-local-src` (see
   * markdown.ts): the phone bundle has no `/api/file` route, so the bytes
   * come back through `mobile.readFile` as a data URL and are assigned to
   * `src` here. This runs after every segment change — the segments array
   * is a fresh object on each parse, so a re-mounted run re-hydrates.
   * `data-local-state` makes each image settle exactly once; the loader
   * caches by (sessionId, path), so a re-mount costs no extra request.
   *
   * Assigning `src` (rather than emitting one) is what keeps this inside
   * the renderer's escape-first contract: the data URL is produced by our
   * own authenticated channel, and `safeUrl` — which deliberately rejects
   * `data:` — only ever sees authored markdown.
   */
  useEffect(() => {
    const root = bodyRef.current
    if (root === null || sessionId === undefined) return
    const images = root.querySelectorAll<HTMLImageElement>('img.md-local-img[data-local-src]')
    for (const image of images) {
      if (image.dataset['localState'] !== undefined) continue
      const path = image.getAttribute('data-local-src')
      if (path === null || path === '') continue
      // 刚确认过读不到（TTL 内）：直接出牌子，不再发一次 RPC。
      if (isLocalImageFailed(sessionId, path)) {
        image.dataset['localState'] = 'failed'
        markMissingImage(image, path, localImageFailureReason(sessionId, path))
        continue
      }
      image.dataset['localState'] = 'loading'
      void loadLocalImageUrl(sessionId, path).then((url) => {
        // The element can be gone (list re-mount) before the bytes arrive.
        if (!image.isConnected) return
        if (url === undefined) {
          image.dataset['localState'] = 'failed'
          markMissingImage(image, path, localImageFailureReason(sessionId, path))
          return
        }
        image.dataset['localState'] = 'loaded'
        image.src = url
      })
    }
  }, [segments, sessionId, retryTick])
  return (
    <div className="chat-msg-text chat-md">
      {/*
       * 裁剪必须只套在正文上：原来 `chat-md-collapsed`（max-height:45vh + overflow:hidden）
       * 和「展开全文」按钮在同一个容器里，于是**按钮被自己裁掉了** —— 手机上看到的
       * 就是「正文断在半句、下面一点渐变，再没有任何可点的地方」（2026-10-30 真机反馈）。
       */}
      <div className={'chat-md-body' + (collapsed ? ' chat-md-collapsed' : '')} ref={bodyRef}>
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
        <Button
          type="button"
          className="chat-msg-toggle"
          aria-expanded={open}
          onClick={() => { setOpen(value => !value) }}
        >
          {open ? '收起' : '展开全文（' + text.length + ' 字）'}
        </Button>
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
    return <span className="chat-msg-text" data-part-id="body">{highlighted(text)}</span>
  }
  const shown = open ? text : text.slice(0, LONG_TEXT_PREVIEW)
  return (
    <span className="chat-msg-text" data-part-id="body">
      {highlighted(shown)}{!open ? '…' : ''}
      <Button type="button" className="chat-msg-toggle" onClick={() => { setOpen(value => !value) }}>
        {open ? '收起' : `展开全文（${text.length} 字）`}
      </Button>
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

export function highlightPlain(text: string, query: string | undefined): ReactNode {
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
