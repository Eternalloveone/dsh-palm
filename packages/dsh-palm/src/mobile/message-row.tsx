/**
 * MessageRow: one rendered message row — the assistant/user/command card
 * with its reasoning disclosure, tool disclosure, markdown body, diff
 * artifacts, fail tag and footer (time).
 *
 * Memoized: live streaming updates exactly one message object per frame, so
 * unchanged rows skip re-rendering their markdown/sub-components.
 * @module dsh-palm/mobile/message-row
 */

import { memo, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import { formatTime } from './views/App.tsx'
import type { RenderMessage, ToolCallInfo, ToolDiffView } from './messages.ts'
import { CollapsibleText, MarkdownText, ReasoningDisclosure } from './markdown-text.tsx'
import { ChevronUpIcon } from './icons.tsx'

export const MessageRow = memo(function MessageRow({ message, showToolCalls, showSystemMessages, showTime = true }: {
  message: RenderMessage
  showToolCalls: boolean
  showSystemMessages: boolean
  /** Timestamp de-dup: hidden when a later row shares this row's minute. */
  showTime?: boolean
}) {
  // Injected user messages (sourceKind defined and not 'user') hide behind
  // the system-message toggle.
  if (message.kind === 'user'
    && message.sourceKind !== undefined
    && message.sourceKind !== 'user'
    && !showSystemMessages) {
    return null
  }
  // Command cards render before the empty-text guard: a running card has no
  // result text yet but must stay visible (it is the in-stream feedback).
  if (message.kind === 'command') {
    return (
      <div
        data-mid={message.id}
        className={'chat-command' + (message.commandPhase === 'error' ? ' chat-command-error' : '')}
        role="status"
      >
        <span className="chat-command-name">{message.commandLine ?? '命令'}</span>
        <span className="chat-command-result">
          {message.commandPhase === 'running' ? '执行中…' : message.text}
        </span>
      </div>
    )
  }
  const hasReasoning = message.kind === 'assistant' && message.reasoning !== undefined && message.reasoning !== ''
  const hasTools = showToolCalls && message.kind === 'assistant' && message.tools !== undefined && message.tools.length > 0
  const hasText = message.text !== ''
  const hasFailTag = message.failed === true

  if (!hasReasoning && !hasTools && !hasText && !hasFailTag) {
    return null
  }
  return (
    <div
      data-mid={message.id}
      className={`chat-msg chat-msg-${message.kind}${message.pending === true ? ' chat-msg-pending' : ''}${message.failed === true ? ' chat-msg-failed' : ''}`}
    >
      {message.kind === 'assistant' && message.reasoning !== undefined && message.reasoning !== '' && (
        <ReasoningDisclosure text={message.reasoning} pending={message.pending === true} />
      )}
      {showToolCalls && message.kind === 'assistant' && message.tools !== undefined && message.tools.length > 0 && (
        <ToolDisclosure tools={message.tools} />
      )}
      {message.kind === 'assistant' && message.flow !== undefined && message.flow.length > 0 ? (
        // Pending rows ride the same interleaved body as the settled ones:
        // the flow already records where each tool was called, so rendering
        // the streamed chunks in flow order keeps the exact DOM structure
        // that the final render will use. A pending→settled switch then
        // never re-lays the message (no tail-card→inline-card jump).
        <FlowBody message={message} />
      ) : message.kind === 'assistant' ? (
        <>
          <MarkdownText text={message.text} pending={message.pending === true} />
          {message.tools !== undefined && <ArtifactCards tools={message.tools} />}
        </>
      ) : (
        <CollapsibleText text={message.text} />
      )}
      {message.failed === true && <span className="chat-msg-failtag">本次回复失败</span>}
      <span className="chat-msg-footer">
        {showTime && <span className="chat-msg-time">{formatTime(message.time)}</span>}
      </span>
    </div>
  )
})

/** Collapsed-by-default tool-call disclosure: pill tag summary + card details (#529). */
function ToolDisclosure({ tools }: { tools: ToolCallInfo[] }) {
  const [open, setOpen] = useState(false)
  const uniqueNames = [...new Set(tools.map(tool => tool.name))]
  return (
    <div className={`chat-disclosure chat-tooldisc${open ? ' chat-disclosure-open' : ''}`}>
      <button
        type="button"
        className="chat-disclosure-head"
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className="chat-disclosure-label">工具</span>
        {!open && (
          <span className="chat-disclosure-summary chat-tool-pills">
            {uniqueNames.map(name => (
              <span key={name} className="chat-tool-pill">{name}</span>
            ))}
          </span>
        )}
        <span className="chat-disclosure-count">{tools.length} 次</span>
        <span className="chat-disclosure-caret" aria-hidden><ChevronUpIcon /></span>
      </button>
      {open && (
        <div className="chat-disclosure-body chat-tooldisc-body">
          {tools.map((tool, index) => (
            <div className="chat-tool-card" key={`${tool.callId}-${index}`}>
              <span className="chat-tool-pill">{tool.name}</span>
              {/* Diff artifacts render in the message body (ArtifactCards);
                  the disclosure keeps only the name for those calls. */}
              {tool.view === undefined && tool.arguments !== undefined && (
                <pre className="chat-tool-args">{tool.arguments}</pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The settled message body rendered in event order: text runs and diff
 * artifacts interleaved at their call time points (a write mid-turn shows
 * its diff right where the model called it, not stacked at the end).
 * Consecutive tool parts merge into one artifact card (multi-file edits
 * stay a single card); tool parts without a diff view render nothing.
 */
function FlowBody({ message }: { message: RenderMessage }) {
  // Index tools by callId once per render: the flow can carry many tool
  // parts and a linear find per part is O(parts × tools).
  const toolsById = useMemo(
    () => new Map((message.tools ?? []).map(tool => [tool.callId, tool] as const)),
    [message.tools],
  )
  const parts: ReactNode[] = []
  let pendingTools: ToolCallInfo[] = []
  let key = 0
  const flush = (): void => {
    if (pendingTools.length > 0) {
      parts.push(<ArtifactCards key={key} tools={pendingTools} />)
      key += 1
      pendingTools = []
    }
  }
  for (const part of message.flow ?? []) {
    if (part.kind === 'text') {
      flush()
      parts.push(<MarkdownText key={key} text={part.text} pending={message.pending === true} />)
      key += 1
    } else {
      const tool = toolsById.get(part.callId)
      if (tool !== undefined && tool.view !== undefined) pendingTools.push(tool)
    }
  }
  flush()
  return <>{parts}</>
}

/**
 * Diff artifacts (write/edit) rendered directly in the message body — the
 * phone's take on the desktop diff card, visible without expanding the
 * tool disclosure. The tool disclosure keeps the call name only.
 *
 * Every diff view of the turn merges into ONE card: a single head with the
 * file tally, per-file diffs below (each file keeps its path header). A
 * multi-file edit no longer stacks one folded card per write call.
 */
function ArtifactCards({ tools }: { tools: ToolCallInfo[] }) {
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
  const tally = useMemo(() => {
    if (view === undefined) return { adds: 0, dels: 0 }
    let adds = 0
    let dels = 0
    for (const diff of view.diffs) {
      if (diff.oldText !== null) dels += toolDiffLines(diff.oldText).length
      adds += toolDiffLines(diff.newText).length
    }
    return { adds, dels }
  }, [view])
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
      <button
        type="button"
        className="chat-artifact-head"
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className="chat-artifact-title">{view.title ?? tool.name}</span>
        <span className="chat-artifact-summary">+{tally.adds} −{tally.dels}</span>
        <span className="chat-artifact-caret" aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
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

/** Split one diff side into content lines (a trailing newline is a terminator). */
function toolDiffLines(text: string): string[] {
  if (text === '') return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}
