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
 * chunks so the first chunk paints immediately and later chunks yield the
 * main thread between commits (a huge dump never blocks in one long task).
 * Copy flips the button to a green check + 「已复制」 for 1.5s with a toast.
 * @module dsh-palm/mobile/code-block
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { highlightCodeSync, languageInfo } from './shiki.ts'
import { copyText, insertCode, openCodeInTab, runCode, type RunResult } from './code-actions.ts'
import { toast } from './toast.tsx'
import { escapeHtml } from './markdown.ts'
import { CheckIcon, CopyIcon, EnterIcon, PlayIcon, UpperRightIcon } from './icons.tsx'

/** Fold threshold: blocks with more lines fold; the folded view shows this many. */
export const FOLD_THRESHOLD = 20
/** Blocks at or above this line count highlight in chunks (first 100 lines paint first). */
export const CHUNK_THRESHOLD = 1000
/** Chunk size for the chunked highlight path. */
export const CHUNK_SIZE = 300

/** Resolve on the next timer tick, so a frame can paint between chunks. */
function yieldToFrame(): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, 0) })
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
  // blocks (>1000 lines) keep the chunked path: the first chunk paints on
  // the next frame and later chunks yield between commits (see the effect).
  const chunks = lines.length > CHUNK_THRESHOLD
  /** Highlighted HTML (null = plain fallback, until the async highlight lands). */
  const [html, setHtml] = useState<string | null>(null)
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
  // initial paint is plain text (fast), and the highlight lands on the next
  // idle frame so a long session's many code blocks never block the first
  // paint in one long task. Very large blocks (>1000 lines) highlight
  // chunk-by-chunk: each chunk commits its own HTML and then yields to the
  // browser (a 0 ms timer lets a frame paint), so a huge dump never blocks
  // the main thread in one long task and the visible head appears first.
  useEffect(() => {
    setExpanded(false)
    if (chunks) {
      let cancelled = false
      const lines = code.split('\n')
      const steps = Math.ceil(lines.length / CHUNK_SIZE)
      let inner = ''
      let index = 0
      const run = async (): Promise<void> => {
        while (index < steps && !cancelled) {
          const start = index * CHUNK_SIZE
          const part = highlightCodeSync(lines.slice(start, start + CHUNK_SIZE).join('\n'), lang)
          if (part === null || cancelled) return
          const codeStart = part.indexOf('<code>')
          const codeEnd = part.lastIndexOf('</code>')
          if (codeStart === -1 || codeEnd === -1) return
          inner += part.slice(codeStart + '<code>'.length, codeEnd)
          index += 1
          // Shiki's per-line <span>s are joined with \n INSIDE a chunk; between
          // chunks the separator must be re-added or the chunk's last line and
          // the next chunk's first line render on the same row.
          if (index < steps) inner += '\n'
          setHtml('<pre class="shiki" tabindex="0"><code>' + inner + '</code></pre>')
          // Let the browser paint this chunk before tokenizing the next one.
          await yieldToFrame()
        }
      }
      void run()
      return () => { cancelled = true }
    }
    // Defer the highlight to idle time: the first paint shows plain text
    // immediately, and the highlight lands on the next idle frame (or a 0 ms
    // timer when requestIdleCallback is unavailable, e.g. older Safari).
    let cancelled = false
    let idleId: number | undefined
    const run = (): void => {
      if (cancelled) return
      setHtml(highlightCodeSync(code, lang))
    }
    if (typeof requestIdleCallback === 'function') {
      idleId = requestIdleCallback(run)
    } else {
      idleId = window.setTimeout(run, 0)
    }
    return () => {
      cancelled = true
      if (idleId !== undefined) {
        if (typeof requestIdleCallback === 'function') cancelIdleCallback(idleId)
        else window.clearTimeout(idleId)
      }
    }
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
