/**
 * MessageRow: one rendered message row — the assistant/user/command card
 * with its reasoning disclosure, tool disclosure, markdown body, diff
 * artifacts, fail tag and footer (time).
 *
 * Memoized: live streaming updates exactly one message object per frame, so
 * unchanged rows skip re-rendering their markdown/sub-components.
 * @module dsh-palm/mobile/message-row
 */

import { Fragment, memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react'
import { formatTime } from './views/App.tsx'
import type { MessageImage, RenderMessage, ToolCallInfo, ToolDiffView } from './messages.ts'
import { cachedAttachmentUrl, loadAttachmentUrl } from './attachment-images.ts'
import { CollapsibleText, MarkdownText, ReasoningDisclosure } from './markdown-text.tsx'
import { ReportBody } from './report-body.tsx'
import { detectReport } from './report.ts'
import { ChevronUpIcon } from './icons.tsx'

export const MessageRow = memo(function MessageRow({ message, sessionId, showToolCalls, showSystemMessages, showTime = true, focused = false, focusedQuery, style, onRegenerate }: {
  message: RenderMessage
  /**
   * 会话 id：图片字节按会话授权读取（见 attachment-images.ts）。每个真实调用点
   * （ChatView）都传；缺省时带图片的消息只显示文本——测试里折叠图片需显式传。
   */
  sessionId?: string
  showToolCalls: boolean
  showSystemMessages: boolean
  /** Timestamp de-dup: hidden when a later row shares this row's minute. */
  showTime?: boolean
  /** Search-hit locate highlight (one-shot CSS animation). */
  focused?: boolean
  focusedQuery?: string
  /** Optional inline style on the row's root element (e.g. content-visibility). */
  style?: CSSProperties
  /** Regenerate affordance: shown on the last settled assistant reply. */
  onRegenerate?: () => void
}) {
  const focusSeqAttr = message.startSeq ?? message.seq
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
        data-message-id={message.id}
        data-row-seq={focusSeqAttr}
        className={'chat-command' + (message.commandPhase === 'error' ? ' chat-command-error' : '') + (focused ? ' chat-msg-focus' : '')}
        style={style}
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
  // 图片：纯图片消息文本为空，若不算进"有内容"这一关，整行会被下面的空行守卫丢掉。
  const images = sessionId !== undefined && message.images !== undefined && message.images.length > 0
    ? message.images
    : undefined
  const hasImages = images !== undefined
  // Flow rows with at least one non-empty text run carry visible content even
  // when `text` is empty (tool-interleaved turns put their payload in flow).
  const hasFlowText = message.flow !== undefined
    && message.flow.some(part => part.kind === 'text' && part.text !== '')
  // Conditional report card: settled assistant turns whose effective text
  // (message.text, or every flow text run for tool-interleaved turns — those
  // carry the payload in `flow` with an empty `text`) reads like a result
  // report get the card container + structured renderer. Streaming rows and
  // normal prose stay on the plain path.
  const reportSource = message.flow !== undefined && message.flow.length > 0
    ? message.flow.filter(part => part.kind === 'text').map(part => part.text).join('\n')
    : message.text
  const isReport = message.kind === 'assistant' && message.pending !== true && reportSource !== '' && detectReport(reportSource)

  if (!hasReasoning && !hasTools && !hasText && !hasFailTag && !hasFlowText && !hasImages) {
    return null
  }
  return (
    <div
      data-mid={message.id}
      data-message-id={message.id}
      data-row-seq={focusSeqAttr}
      className={`chat-msg chat-msg-${message.kind}${message.pending === true ? ' chat-msg-pending' : ''}${message.failed === true ? ' chat-msg-failed' : ''}${isReport ? ' chat-msg-report' : ''}${focused ? ' chat-msg-focus' : ''}`}
      style={style}
    >
      {message.kind === 'assistant' && message.reasoning !== undefined && message.reasoning !== '' && (
        <ReasoningDisclosure text={message.reasoning} pending={message.pending === true} />
      )}
      {showToolCalls && message.kind === 'assistant' && message.tools !== undefined && message.tools.length > 0 && (
        <ToolDisclosure tools={message.tools} />
      )}
      {message.kind === 'assistant' && message.flow !== undefined && message.flow.length > 0 ? (
        // Report rows render the WHOLE joined flow text through the report
        // renderer — per-part rendering split sections/commits across flow
        // parts — with result artifacts (write/edit diffs) after it. Pending
        // and non-report flows keep the interleaved per-step body below.
        isReport ? (
          <>
            <ReportBody text={reportSource} />
            {message.tools !== undefined && <ArtifactCards tools={message.tools} />}
          </>
        ) : (
          <FlowBody message={message} focusedQuery={focused ? focusedQuery : undefined} report={false} />
        )
      ) : message.kind === 'assistant' ? (
        <>
          {isReport
            ? <ReportBody text={message.text} />
            : <MarkdownText text={message.text} pending={message.pending === true} forceOpen={focused} highlightQuery={focused ? focusedQuery : undefined} />}
          {message.tools !== undefined && <ArtifactCards tools={message.tools} />}
        </>
      ) : (
        <>
          <CollapsibleText text={message.text} forceOpen={focused} highlightQuery={focused ? focusedQuery : undefined} />
          {images !== undefined && sessionId !== undefined && (
            <MessageImages sessionId={sessionId} images={images} />
          )}
        </>
      )}
      {message.failed === true && <span className="chat-msg-failtag">本次回复失败</span>}
      {message.maxTokens === true && <div className="chat-msg-maxtokens">已达到输出 token 上限，回答被截断。发送“继续”可让模型接着输出。</div>}
      <span className="chat-msg-footer">
        {showTime && <span className="chat-msg-time">{formatTime(message.time)}</span>}
        {message.kind === 'assistant' && onRegenerate !== undefined && (
          <button type="button" className="chat-msg-regenerate" onClick={onRegenerate} aria-label="重新生成回复">
            <span className="chat-msg-regenerate-icon" aria-hidden>↻</span>
            重新生成
          </button>
        )}
      </span>
    </div>
  )
})

/**
 * 一条消息里的图片组。
 *
 * 事件里只有引用，字节挂载时按需取（内容寻址缓存，重挂不再请求）。取字节失败
 * 只影响这一张图：显示可点重试的占位，而不是让整行消失。
 */
function MessageImages({ sessionId, images }: { sessionId: string; images: readonly MessageImage[] }) {
  return (
    <div className="chat-msg-images" role="list" aria-label="消息图片">
      {images.map(image => <MessageImageTile key={image.attachmentId} sessionId={sessionId} image={image} />)}
    </div>
  )
}

/** 单张图片：占位 → data URL；点一下由 ChatView 的滚动点击处理开全屏。 */
function MessageImageTile({ sessionId, image }: { sessionId: string; image: MessageImage }) {
  const [url, setUrl] = useState<string | undefined>(() => cachedAttachmentUrl(image.attachmentId))
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const label = image.name !== undefined && image.name !== '' ? image.name : '图片'

  useEffect(() => {
    if (url !== undefined) return
    let cancelled = false
    void loadAttachmentUrl(sessionId, image.attachmentId).then((loaded) => {
      if (cancelled) return
      if (loaded === undefined) setFailed(true)
      else {
        setFailed(false)
        setUrl(loaded)
      }
    })
    return () => { cancelled = true }
  }, [sessionId, image.attachmentId, url, attempt])

  if (url === undefined) {
    return (
      <button
        type="button"
        role="listitem"
        className={`chat-msg-image chat-msg-image-placeholder${failed ? ' chat-msg-image-failed' : ''}`}
        aria-label={failed ? `${label}，加载失败，点击重试` : `${label}，加载中`}
        onClick={() => {
          if (!failed) return
          setFailed(false)
          setAttempt(value => value + 1)
        }}
      >
        {failed ? '图片加载失败，点击重试' : '图片加载中…'}
      </button>
    )
  }
  return (
    <img
      className="chat-msg-image"
      role="listitem"
      src={url}
      alt={label}
      loading="lazy"
      {...(image.width > 0 ? { width: image.width } : {})}
      {...(image.height > 0 ? { height: image.height } : {})}
    />
  )
}

/**
 * Per-step body of a coalesced turn: each folded step renders as its own
 * anchored block (`data-step-seq`) so a search-hit locate can scroll to the
 * exact step. The streaming tail (the pending current step, whose text is the
 * part of `message.text` beyond the joined finalized steps) renders as a
 * final pending block — keeping the same per-step DOM for pending and settled
 * so the turn never re-lays.
 */
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
function FlowBody({ message, focusedQuery, report = false }: { message: RenderMessage; focusedQuery?: string; report?: boolean }) {
  // Index tools by callId once per render: the flow can carry many tool
  // parts and a linear find per part is O(parts × tools).
  const toolsById = useMemo(
    () => new Map((message.tools ?? []).map(tool => [tool.callId, tool] as const)),
    [message.tools],
  )
  const parts: ReactNode[] = []
  let pendingTools: ToolCallInfo[] = []
  let key = 0
  let textIndex = 0
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
      const stepSeq = part.seq ?? message.stepSeqs?.[textIndex]
      // Report rows: each flow text run goes through the report renderer
      // (status chips / sections / commits) — prose runs degrade to plain.
      const body = report
        ? <ReportBody text={part.text} />
        : <MarkdownText text={part.text} pending={message.pending === true} forceOpen={focusedQuery !== undefined} highlightQuery={focusedQuery} />
      const partId = part.partId ?? `text-${textIndex}`
      parts.push(stepSeq === undefined
        ? <Fragment key={key}>{body}</Fragment>
        : <div key={key} className="chat-flow-text" data-step-seq={stepSeq} data-part-id={partId}>{body}</div>)
      textIndex += 1
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
        <span className="chat-artifact-summary">
          <span className="chat-artifact-stat chat-artifact-stat-add">+{tally.adds}</span>
          <span className="chat-artifact-stat chat-artifact-stat-del">−{tally.dels}</span>
        </span>
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
