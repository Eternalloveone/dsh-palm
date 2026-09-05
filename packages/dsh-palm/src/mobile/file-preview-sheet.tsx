/**
 * FilePreviewSheet: bottom-sheet preview for a file path tapped in the chat.
 *
 * The chat renders file-path tokens as `.file-link` anchors; on the desktop
 * the host opens them with its native opener, but a standalone phone has no
 * such hook — so the tap now reads the file's text back through the
 * `mobile.readFile` RPC and previews it here. Guards are host-side: real
 * regular files only, <=256 KiB, UTF-8 text with no NUL (binary refuses).
 * The body renders Shiki highlighting when the extension maps to a known
 * language, otherwise plain escaped text; a copy button grabs the content.
 */

import { useEffect, useMemo, useState } from 'react'
import { readFile, type FilePreview } from './api.ts'
import { Sheet } from './sheet.tsx'
import { copyText } from './code-actions.ts'
import { highlightCodeSync } from './shiki.ts'
import { escapeHtml, parseSegments } from './markdown.ts'
import { CodeBlock } from './code-block.tsx'
import { DiffView } from './diff-view.tsx'
import { CopyIcon } from './icons.tsx'

/** Extension → shiki language key (best effort; unknown → plain text). */
const EXT_LANG: Record<string, string> = {
  ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  py: 'py', sh: 'sh', bash: 'sh', zsh: 'sh', json: 'json',
  yaml: 'yaml', yml: 'yaml', html: 'html', xml: 'xml', htm: 'html',
  css: 'css', rs: 'rs', go: 'go', java: 'java', cpp: 'cpp', cc: 'cpp',
  cxx: 'cpp', h: 'cpp', hpp: 'cpp', c: 'c', md: 'md', markdown: 'md',
  sql: 'sql', txt: 'text', log: 'text', gitignore: 'text', toml: 'text',
}

/** Pick a shiki language key from a file path's extension (or plain text). */
function languageForPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : base.toLowerCase()
  if (ext === 'gitignore' || ext === 'dockerignore') return 'text'
  return EXT_LANG[ext] ?? 'text'
}

/** True when a file path names a markdown document (rendered, not plain). */
function isMarkdownPath(path: string): boolean {
  const base = path.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
  return ext === 'md' || ext === 'markdown' || ext === 'mdx'
}

/** True when a file path names an HTML document (rendered in a sandbox). */
function isHtmlPath(path: string): boolean {
  const base = path.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
  return ext === 'html' || ext === 'htm'
}

export interface FilePreviewSheetProps {
  /** The file path tapped in the chat (may be relative or absolute). */
  path: string
  /** Owning session id: a relative path resolves against this session's cwd. */
  sessionId: string
  onClose(): void
}

/** Render one file preview sheet with loading / error / content states. */
export function FilePreviewSheet({ path, sessionId, onClose }: FilePreviewSheetProps) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; preview: FilePreview }
  >({ status: 'loading' })

  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    readFile(path, sessionId).then(
      (preview) => { if (alive) setState({ status: 'ready', preview }) },
      (error: unknown) => {
        if (!alive) return
        const message = error instanceof Error ? error.message : '文件不可读'
        setState({ status: 'error', message })
      },
    )
    return () => { alive = false }
  }, [path, sessionId])

  const ready = state.status === 'ready' ? state.preview : null
  const isImage = ready?.kind === 'image'
  const displayName = ready !== null ? ready.name : (path.split(/[\\/]/).pop() ?? path)

  return (
    <Sheet title={displayName} onClose={onClose}>
      {state.status === 'loading' && (
        <div className="fp-loading">正在读取文件…</div>
      )}
      {state.status === 'error' && (
        <div className="fp-error">{state.message}</div>
      )}
      {ready !== null && (
        <>
          <div className="fp-actions">
            <span className="fp-path" title={ready.path}>{ready.path}</span>
            {!isImage && (
              <button type="button" className="fp-copy" onClick={() => { void copyText(ready.text, '已复制文件内容') }}>
                <CopyIcon />
                复制
              </button>
            )}
          </div>
          {isImage ? (
            <div className="fp-image-wrap">
              <img className="fp-image" src={ready.dataUrl} alt={ready.name} draggable={false} />
            </div>
          ) : (
            <TextPreview path={ready.path} text={ready.text} />
          )}
        </>
      )}
    </Sheet>
  )
}

/** Text preview content: markdown/html/code/plain by extension. */
function TextPreview({ path, text }: { path: string; text: string }) {
  const lang = languageForPath(path)
  const highlighted = highlightCodeSync(text, lang)
  const displayName = path.split(/[\\/]/).pop() ?? path
  const markdown = isMarkdownPath(path)
  const htmlDoc = isHtmlPath(path)
  const segments = useMemo(
    () => (markdown ? parseSegments(text) : null),
    [markdown, text],
  )

  if (segments !== null) {
    return (
      <div className="chat-md-body fp-md">
        {segments.map(segment => {
          if (segment.kind === 'think') return null
          if (segment.kind === 'html') {
            return <div key={segment.id} className="md-html" dangerouslySetInnerHTML={{ __html: segment.html }} />
          }
          if (segment.kind === 'code') {
            return <CodeBlock key={segment.id} lang={segment.lang} code={segment.code} />
          }
          return <DiffView key={segment.id} text={segment.text} />
        })}
      </div>
    )
  }
  if (htmlDoc) {
    // Sandboxed iframe: markup and inline styles display, scripts inert.
    return (
      <iframe
        className="fp-html"
        sandbox=""
        title={displayName}
        srcDoc={text}
      />
    )
  }
  if (highlighted !== null) {
    return <div className="fp-body" dangerouslySetInnerHTML={{ __html: highlighted }} />
  }
  return <pre className="fp-body fp-plain">{escapeHtml(text)}</pre>
}
