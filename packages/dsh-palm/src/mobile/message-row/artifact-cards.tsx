/**
 * 产物卡片：一轮里模型写过的文件 / 跑过的命令，折叠成一张可展开的卡片。
 *
 * 从 message-row.tsx → artifacts.tsx → 再拆到这里（W2-3）：process.tsx 与
 * artifacts.tsx 都要用它，放在任一侧都会成环。
 *
 * 2026-11-10（方案 C2/C3）：展开后的改动不再是"旧文件全红 + 新文件全绿"，而是
 * **逐文件 + 真 hunk**（`render/line-diff.ts` 只留改动附近几行上下文），
 * 每个文件的路径行可点 → 打开文件预览（`FilePreviewSheet`，文本/图片/markdown 都支持）。
 *
 * @module dsh-palm/mobile/message-row/artifact-cards
 */
import { useEffect, useMemo, useRef, useState, type Ref } from 'react'
import type { ToolCallInfo, ToolDiffView } from '../render/messages.ts'
import { lineDiffRows } from '../render/line-diff.ts'
import { diffTallyOf } from '../render/process-rows.ts'
import { FilePreviewSheet } from '../components/file-preview-sheet.tsx'
import { Button } from '../ui/primitives.tsx'

export function ArtifactCards({ tools, sessionId }: { tools: ToolCallInfo[]; sessionId?: string }) {
  // The merged view must keep a STABLE reference across streaming chunks:
  // the fold keeps the tools array identity while only the text grows, so
  // memoizing on `tools` lets ArtifactCard's tally and ToolDiffCard's rows
  // survive the per-chunk re-render instead of re-deriving the whole diff
  // (and re-reading scrollHeight) on every token.
  const merged = useMemo(() => {
    const cards = tools.filter(tool => tool.view !== undefined)
    if (cards.length === 0) return undefined
    return {
      card: 'diff' as const,
      title: cards.length === 1
        ? (cards[0]?.view?.title ?? cards[0]?.name ?? '')
        : `编辑了 ${cards.length} 个文件`,
      diffs: cards.flatMap(card => card.view?.diffs ?? []),
    }
  }, [tools])
  if (merged === undefined) return null
  return <ArtifactCard tool={{ ...tools.find(tool => tool.view !== undefined)!, view: merged }} {...(sessionId === undefined ? {} : { sessionId })} />
}

/**
 * One collapsible diff artifact: the title row (Write/Edit + file) is
 * always visible with a +/- line tally; the red/green body stays folded
 * until tapped — a long mutation never pushes the reply off screen.
 */
function ArtifactCard({ tool, sessionId }: { tool: ToolCallInfo; sessionId?: string }) {
  const [open, setOpen] = useState(false)
  // 点路径行打开的**文件预览**（C3）：复用 `FilePreviewSheet`，相对路径按会话 cwd 解析。
  const [preview, setPreview] = useState<string | null>(null)
  const diffRef = useRef<HTMLDivElement | null>(null)
  const view = tool.view
  const tally = useMemo(() => diffTallyOf(view), [view])
  // Clamp the diff body to its actual content height with a max-height
  // transition: expanding, collapsing and streamed growth (more files
  // landing mid-turn — "edited N files" 3 → 11) animate smoothly instead
  // of snapping, so the paragraph below the card never jumps. Runs when
  // the open state or the view content changes; a stable view across
  // streaming chunks skips the (synchronous reflow) scrollHeight read.
  useEffect(() => {
    const el = diffRef.current
    if (el !== null) el.style.maxHeight = open ? `${el.scrollHeight}px` : '0px'
  }, [open, view])
  if (view === undefined) return null
  return (
    <div className="chat-artifact">
      <Button
        type="button"
        className="chat-artifact-head"
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className="chat-artifact-title">{view.title ?? tool.name}</span>
        <span className="chat-artifact-summary">
          <span className="chat-artifact-stat chat-artifact-stat-add">+{tally.adds}</span>
          <span className="chat-artifact-stat chat-artifact-stat-del">−{tally.dels}</span>
        </span>
        <span className="chat-artifact-caret" aria-hidden>{open ? '▾' : '▸'}</span>
      </Button>
      {open && (
        <ToolDiffCard
          view={view}
          diffRef={diffRef}
          {...(sessionId === undefined ? {} : { sessionId })}
          {...(sessionId === undefined ? {} : { onOpenFile: (path: string) => { setPreview(absolutePathOf(path, tool.metaPaths)) } })}
        />
      )}
      {preview !== null && sessionId !== undefined && (
        <FilePreviewSheet path={preview} sessionId={sessionId} onClose={() => { setPreview(null) }} />
      )}
    </div>
  )
}

/**
 * One file mutation (write/edit) rendered as removed/added lines — the
 * phone's take on the desktop diff card. The host presenter ships the
 * change as `{ path, oldText, newText }` per file; every old-side line
 * draws red, every new-side line green, reusing the DiffView palette.
 */
function ToolDiffCard({ view, diffRef, sessionId, onOpenFile }: {
  view: ToolDiffView
  diffRef?: Ref<HTMLDivElement>
  sessionId?: string
  onOpenFile?: (path: string) => void
}) {
  // 逐文件算真 hunk：只留改动附近几行（`render/line-diff.ts`），不再是"整份文件全红/全绿"。
  const files = useMemo(() => view.diffs.map(diff => {
    const rows = lineDiffRows(diff.oldText ?? '', diff.newText)
    return {
      path: diff.path,
      rows,
      adds: rows.filter(row => row.kind === 'add').length,
      dels: rows.filter(row => row.kind === 'del').length,
    }
  }), [view])
  return (
    <div ref={diffRef} className="chat-tool-diff" style={{ maxHeight: 0 }}>
      {files.map(file => (
        <div key={file.path} className="chat-tool-diff-file" data-path={file.path}>
          {/* 路径行：点开文件预览（C3）。没有会话 id 时不可点（老调用点）。 */}
          <Button
            type="button"
            className="chat-tool-diff-row chat-tool-diff-path"
            aria-label={`预览文件：${file.path}`}
            {...(sessionId === undefined || onOpenFile === undefined
              ? {}
              : { onClick: () => { onOpenFile(file.path) } })}
          >
            <span className="chat-tool-diff-text">{file.path}</span>
            <span className="chat-artifact-stat chat-artifact-stat-add">+{file.adds}</span>
            <span className="chat-artifact-stat chat-artifact-stat-del">−{file.dels}</span>
          </Button>
          {file.rows.map((row, index) => (
            <div
              key={index}
              className={'chat-tool-diff-row' + (row.kind === 'del' ? ' chat-tool-diff-del' : row.kind === 'add' ? ' chat-tool-diff-add' : '')}
            >
              {row.kind === 'del' || row.kind === 'add'
                ? <span className="chat-tool-diff-sign" aria-hidden>{row.kind === 'del' ? '−' : '+'}</span>
                : null}
              <span className="chat-tool-diff-text">{row.text}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Last path segment (a deliverable's label when the host gave no description). */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/**
 * Everything before the last segment, with the workspace root trimmed to `…`.
 * The full absolute path is unreadable on a phone and identical for every file
 * of one turn, so the card shows the file name first and this as the quiet line.
 */
export function parentPath(path: string): string {
  const parts = path.split(/[\\/]/)
  if (parts.length <= 1) return ''
  const dir = parts.slice(0, -1).join('/')
  return dir.length > 34 ? '…' + dir.slice(-33) : dir
}

/** 绝对路径判定：Windows 盘符、UNC、POSIX 根都算。 */
function isAbsolutePath(path: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|[\\/]{1,2}[^\\/]|\\\\)/u.test(path)
}

/**
 * 交付卡里的路径可能是**相对工具自己工作目录**的形式（`ui/sheet.tsx`），而预览请求
 * 要的是宿主上的真路径。工具的 `metaPaths` 里通常是绝对路径，按后缀配上就换成它；
 * 配不上原样返回，交给宿主端按会话 cwd / 工作区 / 后缀兜底去找。
 *
 * @param path - diff 视图给的路径
 * @param absolutePaths - 同一个工具结果里的绝对路径（meta）
 * @returns 能确定时返回绝对路径，否则原样
 */
export function absolutePathOf(path: string, absolutePaths: readonly string[] | undefined): string {
  if (isAbsolutePath(path) || absolutePaths === undefined || absolutePaths.length === 0) return path
  const tail = pathSegments(path)
  if (tail.length === 0) return path
  // 按**路径段**比后缀，不是按字符串：ui/sheet.tsx 不能配到 xui/sheet.tsx。
  const hit = absolutePaths.find(candidate => {
    const full = pathSegments(candidate)
    if (full.length < tail.length) return false
    const start = full.length - tail.length
    return tail.every((segment, index) => full[start + index] === segment)
  })
  return hit ?? path
}

/** 路径 → 归一化的小写段数组（去空段、认两种分隔符）。 */
function pathSegments(path: string): string[] {
  return path
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .toLowerCase()
    .split('/')
    .filter(segment => segment !== '')
}