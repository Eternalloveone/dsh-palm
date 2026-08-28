/**
 * CodeBlock: the interactive code-block card for the mobile chat.
 *
 * Chrome: 12px-radius container with a 40px head bar — language label on
 * the left, action buttons on the right (run for bash/python, copy, insert
 * into the editor, open in a new tab / download). The body renders Shiki
 * syntax highlighting (both themes baked in as CSS variables, so a theme
 * switch is a pure CSS flip) with a plain escaped-text fallback whenever
 * the CDN loader or the grammar is unavailable.
 *
 * Long blocks (>20 lines) fold to ~15 visible lines behind a gradient mask
 * with an 展开全部 toggle; very large blocks (>1000 lines) highlight in
 * chunks so the first 100 lines paint immediately. Copy flips the button
 * to a green check + 「已复制」 for 1.5s with a toast.
 * @module dsh-palm/mobile/code-block
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { highlightCode, highlightCodeSync, languageInfo } from './shiki.ts'
import { copyText, insertCode, openCodeInTab, runCode, type RunResult } from './code-actions.ts'
import { toast } from './toast.tsx'
import { escapeHtml } from './markdown.ts'
import { CheckIcon, CopyIcon, EnterIcon, PlayIcon, UpperRightIcon } from './icons.tsx'

/** Fold threshold: blocks with more lines fold; the folded view shows this many. */
export const FOLD_THRESHOLD = 20
/** Lines visible in the folded view. */
export const FOLD_PREVIEW_LINES = 15
/** Blocks at or above this line count highlight in chunks (first 100 lines paint first). */
export const CHUNK_THRESHOLD = 1000
/** Chunk size for the chunked highlight path. */
export const CHUNK_SIZE = 300

/**
 * Highlight a code string, chunked for very large blocks. Resolves the
 * accumulated `<pre class="shiki">` HTML, or null when highlighting is
 * unavailable (caller renders plain text).
 */
async function highlightChunked(code: string, lang: string): Promise<string | null> {
  const lines = code.split('\n')
  if (lines.length <= CHUNK_THRESHOLD) return highlightCode(code, lang)
  // >1000 lines: highlight in chunks and accumulate the inner <code> HTML.
  const chunks: string[] = []
  for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
    chunks.push(lines.slice(i, i + CHUNK_SIZE).join('\n'))
  }
  let inner = ''
  let index = 0
  for (const chunk of chunks) {
    const part = await highlightCode(chunk, lang)
    if (part === null) return null
    const codeStart = part.indexOf('<code>')
    const codeEnd = part.lastIndexOf('</code>')
    if (codeStart === -1 || codeEnd === -1) return null
    inner += part.slice(codeStart + '<code>'.length, codeEnd)
    index += 1
    // Shiki's per-line <span>s are joined with \n INSIDE a chunk; between
    // chunks the separator must be re-added or the chunk's last line and the
    // next chunk's first line render on the same row.
    if (index < chunks.length) inner += '\n'
  }
  return '<pre class="shiki" tabindex="0"><code>' + inner + '</code></pre>'
}

/**
 * One code block card.
 * @param lang - the fence language (raw, e.g. "ts" / "python" / "").
 * @param code - the code text.
 */
export const CodeBlock = memo(function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const info = useMemo(() => languageInfo(lang), [lang])
  const lines = useMemo(() => code.split('\n'), [code])
  const foldable = lines.length > FOLD_THRESHOLD
  // Synchronous first paint: the lightweight tokenizer has no I/O, so the
  // highlighted HTML renders on the very first frame — a code block that
  // just closed in the stream never flashes as plain text. Only very large
  // blocks (>1000 lines) keep the chunked async path (first 100 lines paint
  // first).
  const chunks = lines.length > CHUNK_THRESHOLD
  /** Highlighted HTML (null = plain fallback, until the async chunked highlight lands). */
  const [html, setHtml] = useState<string | null>(() => chunks ? null : highlightCodeSync(code, lang))
  /** Copy feedback: true while the button shows the green check + 已复制. */
  const [copied, setCopied] = useState(false)
  /** Copy-feedback timer (cleared on re-copy and unmount). */
  const copyTimerRef = useRef<number | undefined>(undefined)
  /** Fold state for long blocks. */
  const [expanded, setExpanded] = useState(false)
  /** Sandbox run state (bash / python only). */
  const [run, setRun] = useState<{ running: boolean; result?: RunResult }>({ running: false })
  const folded = foldable && !expanded

  useEffect(() => () => {
    if (copyTimerRef.current !== undefined) window.clearTimeout(copyTimerRef.current)
  }, [])

  // Reset the fold when the code changes and re-highlight ALWAYS: the
  // synchronous first paint only covers the initial text, so a later code
  // change (authoritative rewrite / replay) must not keep the stale HTML.
  // Very large blocks (>1000 lines) keep the chunked async path (first
  // chunks paint first), everything else re-highlights synchronously.
  useEffect(() => {
    setExpanded(false)
    if (chunks) {
      let cancelled = false
      setHtml(null)
      void highlightChunked(code, lang).then(result => {
        if (!cancelled) setHtml(result)
      })
      return () => { cancelled = true }
    }
    setHtml(highlightCodeSync(code, lang))
    return undefined
  }, [code, lang, chunks])

  const handleCopy = (): void => {
    setCopied(true)
    if (copyTimerRef.current !== undefined) window.clearTimeout(copyTimerRef.current)
    copyTimerRef.current = window.setTimeout(() => {
      copyTimerRef.current = undefined
      setCopied(false)
    }, 1500)
    void copyText(code, '已复制到剪贴板')
  }

  const handleInsert = (): void => {
    insertCode(code)
  }

  const handleOpen = (): void => {
    openCodeInTab(code, info.ext)
  }

  const handleRun = (): void => {
    if (run.running) return
    setRun({ running: true })
    void runCode(code, lang).then(result => {
      if (result === null) {
        setRun({ running: false })
        toast('当前环境不支持代码执行')
        return
      }
      setRun({ running: false, result })
    })
  }

  return (
    <div className="code-block" data-lang={lang === '' ? 'text' : lang}>
      <div className="code-head">
        <span className="code-lang">{info.label}</span>
        <div className="code-actions">
          {info.runnable && (
            <button
              type="button"
              className="code-btn"
              aria-label="运行代码"
              disabled={run.running}
              onClick={handleRun}
            >
              <PlayIcon width={16} height={16} />
            </button>
          )}
          <button
            type="button"
            className={'code-btn' + (copied ? ' code-btn-done' : '')}
            aria-label="复制代码"
            onClick={handleCopy}
          >
            {copied ? <CheckIcon width={16} height={16} /> : <CopyIcon width={16} height={16} />}
            {copied && <span className="code-btn-label">已复制</span>}
          </button>
          <button type="button" className="code-btn" aria-label="插入到编辑器" onClick={handleInsert}>
            <EnterIcon width={16} height={16} />
          </button>
          <button type="button" className="code-btn" aria-label="新标签页打开" onClick={handleOpen}>
            <UpperRightIcon width={16} height={16} />
          </button>
        </div>
      </div>
      <div className="code-body-zone">
        <div className={'code-body' + (folded ? ' code-body-folded' : '')}>
          {html !== null ? (
            // Shiki's codeToHtml output is already a <pre class="shiki">.
            <div className="code-fade" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <pre>
              <code>
                {lines.map((line, index) => (
                  <span key={index} className="code-line">{line === '' ? ' ' : escapeHtml(line)}</span>
                ))}
              </code>
            </pre>
          )}
        </div>
        {folded && <div className="code-fold-mask" aria-hidden="true" />}
      </div>
      {foldable && (
        <button type="button" className="code-fold-btn" onClick={() => { setExpanded(value => !value) }}>
          {folded ? '展开全部' : '收起'}
        </button>
      )}
      {run.result !== undefined && (
        <pre className={'code-run' + (run.result.error === true ? ' code-run-error' : ' code-run-ok')}>
          {run.result.output}
        </pre>
      )}
    </div>
  )
})
