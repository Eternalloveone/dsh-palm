/**
 * 产物卡片：一轮里模型写过的文件 / 跑过的命令，折叠成一张可展开的卡片。
 *
 * 从 message-row.tsx → artifacts.tsx → 再拆到这里（W2-3）：process.tsx 与
 * artifacts.tsx 都要用它，放在任一侧都会成环。
 *
 * @module dsh-palm/mobile/message-row/artifact-cards
 */
import { useEffect, useMemo, useRef, useState, type Ref } from 'react'
import type { ToolCallInfo, ToolDiffView } from '../render/messages.ts'
import { diffTallyOf, toolDiffLines } from '../render/process-rows.ts'
import { Button } from '../ui/primitives.tsx'

export function ArtifactCards({ tools }: { tools: ToolCallInfo[] }) {
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
  return <ArtifactCard tool={{ ...tools.find(tool => tool.view !== undefined)!, view: merged }} />
}

/**
 * One collapsible diff artifact: the title row (Write/Edit + file) is
 * always visible with a +/- line tally; the red/green body stays folded
 * until tapped — a long mutation never pushes the reply off screen.
 */
function ArtifactCard({ tool }: { tool: ToolCallInfo }) {
  const [open, setOpen] = useState(false)
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
      {open && <ToolDiffCard view={view} diffRef={diffRef} />}
    </div>
  )
}

/**
 * One file mutation (write/edit) rendered as removed/added lines — the
 * phone's take on the desktop diff card. The host presenter ships the
 * change as `{ path, oldText, newText }` per file; every old-side line
 * draws red, every new-side line green, reusing the DiffView palette.
 */
function ToolDiffCard({ view, diffRef }: { view: ToolDiffView; diffRef?: Ref<HTMLDivElement> }) {
  const rows = useMemo(() => {
    const out: Array<{ kind: 'path' | 'del' | 'add'; text: string }> = []
    for (const diff of view.diffs) {
      out.push({ kind: 'path', text: diff.path })
      if (diff.oldText !== null) {
        for (const line of toolDiffLines(diff.oldText)) out.push({ kind: 'del', text: line })
      }
      for (const line of toolDiffLines(diff.newText)) out.push({ kind: 'add', text: line })
    }
    return out
  }, [view])
  return (
    <div ref={diffRef} className="chat-tool-diff" style={{ maxHeight: 0 }}>
      {rows.map((row, index) => (
        <div
          key={index}
          className={'chat-tool-diff-row' + (row.kind === 'del' ? ' chat-tool-diff-del' : row.kind === 'add' ? ' chat-tool-diff-add' : ' chat-tool-diff-path')}
        >
          {row.kind !== 'path' && (
            <span className="chat-tool-diff-sign" aria-hidden>{row.kind === 'del' ? '−' : '+'}</span>
          )}
          <span className="chat-tool-diff-text">{row.text}</span>
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

/** Extension label for the file chip, uppercased and capped (`TS`, `MD`, `PNG`). */
export function fileBadgeLabel(path: string): string {
  const name = baseName(path)
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return '·'
  return name.slice(dot + 1, dot + 4).toUpperCase()
}
