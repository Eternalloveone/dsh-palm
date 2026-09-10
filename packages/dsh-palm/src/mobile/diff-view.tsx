/**
 * DiffView: the interactive diff card for the mobile chat, fed by ```diff
 * fences. Renders the parsed unified diff as a three-column grid — old line
 * numbers / new line numbers / content — with green added lines, red
 * removed lines, and word-level marks on paired add/del lines.
 *
 * Actions: 接受 collapses the block to an applied state, 拒绝 to a rejected
 * state (both with 撤销), and 逐行审阅 enters line-level review — each
 * added line gets a + button (accept the line), each removed line a −
 * button (keep the deletion), context lines are inert, and a footer shows
 * 接受 X 行 / 拒绝 Y 行 / 剩余 Z 行 with a 确认 button. Confirming builds
 * the resulting file text (context + accepted adds + kept deletions) and
 * offers to copy it.
 * @module dsh-palm/mobile/diff-view
 */

import { memo, useMemo, useState } from 'react'
import { applyDiffDecision, parseDiff, type DiffLine, type ParsedDiff } from './diff.ts'
import { copyText } from './code-actions.ts'
import { escapeHtml } from './markdown.ts'
import { toast } from './toast.tsx'

/** Rendered-row cap for a diff card: beyond this the middle hunks fold. */
const DIFF_MAX_LINES = 200
/** Hunks shown at the head of a capped diff. */
const DIFF_HEAD_HUNKS = 2
/** Hunks shown at the tail of a capped diff. */
const DIFF_TAIL_HUNKS = 2

/** One diff card. */
export const DiffView = memo(function DiffView({ text }: { text: string }) {
  const diff = useMemo(() => parseDiff(text), [text])
  const [mode, setMode] = useState<'view' | 'review' | 'applied' | 'rejected'>('view')
  /** Review decisions, keyed `${hunkIndex}:${lineIndex}`. */
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set())
  const [rejected, setRejected] = useState<ReadonlySet<string>>(new Set())
  /** Whether a capped diff is expanded to its full length. */
  const [expanded, setExpanded] = useState(false)

  const filename = diff.newFile ?? diff.oldFile

  // A huge diff (a whole-file rewrite, a generated-file dump) renders every
  // row at once and janks the phone. Cap the rendered rows: show the first
  // and last hunks (the head carries the file header + first changes, the
  // tail the final edits) and fold the middle behind an expander. The cap
  // counts ROWS, not hunks, so a single 500-line hunk still folds.
  const totalLines = useMemo(() => diff.hunks.reduce((n, hunk) => n + hunk.lines.length, 0), [diff])
  const capped = totalLines > DIFF_MAX_LINES && !expanded
  const visibleHunks = capped
    ? [...diff.hunks.slice(0, DIFF_HEAD_HUNKS), ...diff.hunks.slice(-DIFF_TAIL_HUNKS)]
    : diff.hunks
  const hiddenHunks = capped ? diff.hunks.length - DIFF_HEAD_HUNKS - DIFF_TAIL_HUNKS : 0
  const hiddenLines = capped ? totalLines - visibleHunks.reduce((n, hunk) => n + hunk.lines.length, 0) : 0

  // Review tallies over every add/del line.
  const tallies = useMemo(() => {
    let adds = 0
    let dels = 0
    let acceptedAdds = 0
    let rejectedDels = 0
    diff.hunks.forEach((hunk, hunkIndex) => {
      hunk.lines.forEach((line, lineIndex) => {
        const key = `${hunkIndex}:${lineIndex}`
        if (line.type === 'add') {
          adds += 1
          if (accepted.has(key)) acceptedAdds += 1
        } else if (line.type === 'del') {
          dels += 1
          if (rejected.has(key)) rejectedDels += 1
        }
      })
    })
    return { adds, dels, acceptedAdds, rejectedDels, remaining: adds - acceptedAdds + dels - rejectedDels }
  }, [diff, accepted, rejected])

  /** The resulting file text under the current decisions. */
  const resultText = useMemo(() => {
    if (mode === 'rejected') return ''
    if (mode === 'applied' && accepted.size === 0 && rejected.size === 0) {
      // Whole-diff accept: keep every add, drop every del.
      return applyDiffDecision(diff, allKeys(diff, 'add'), new Set())
    }
    return applyDiffDecision(diff, accepted, rejected)
  }, [diff, mode, accepted, rejected])

  const toggle = (key: string, kind: 'add' | 'del' | 'ctx'): void => {
    if (kind === 'ctx') return
    if (kind === 'add') {
      setAccepted(previous => {
        const next = new Set(previous)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    } else {
      setRejected(previous => {
        const next = new Set(previous)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    }
  }

  const confirmReview = (): void => {
    // An empty confirmation must NOT silently apply the whole diff: the
    // review semantics are "apply exactly my line choices", and no choices
    // means nothing was reviewed. Require at least one decision.
    if (accepted.size === 0 && rejected.size === 0) {
      toast('请先逐行选择要接受或拒绝的行')
      return
    }
    setMode('applied')
  }

  /** Leave review mode without applying anything (decisions are discarded). */
  const cancelReview = (): void => {
    setMode('view')
    setAccepted(new Set())
    setRejected(new Set())
  }

  const undo = (): void => {
    setMode('view')
    setAccepted(new Set())
    setRejected(new Set())
  }

  // The three-column body (interactive in view/review; dimmed after a
  // decision so the applied/rejected result stays visible in context).
  const body = (
    <div className={'diff-body' + (mode === 'review' ? ' diff-reviewing' : '')}>
      {visibleHunks.map((hunk, hunkIndex) => (
        <div className="diff-hunk" key={hunkIndex}>
          {diff.hunks.length > 1 && (
            <div className="diff-hunk-head">
              @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
            </div>
          )}
          {hunk.lines.map((line, lineIndex) => {
            const key = `${hunkIndex}:${lineIndex}`
            return (
              <DiffRow
                key={key}
                line={line}
                reviewing={mode === 'review'}
                accepted={accepted.has(key)}
                rejected={rejected.has(key)}
                onToggle={() => { toggle(key, line.type) }}
              />
            )
          })}
        </div>
      ))}
      {capped && (
        <div className="diff-fold">
          <span className="diff-fold-text">
            … 已折叠 {hiddenHunks} 个 hunk / {hiddenLines} 行
          </span>
          <button type="button" className="diff-fold-btn" onClick={() => { setExpanded(true) }}>
            展开全部
          </button>
        </div>
      )}
      {mode === 'review' && (
        <div className="diff-review-foot">
          <span className="diff-review-summary">
            接受 {tallies.acceptedAdds} 行 / 拒绝 {tallies.rejectedDels} 行 / 剩余 {tallies.remaining} 行
          </span>
          <button type="button" className="diff-confirm diff-cancel" onClick={cancelReview}>取消</button>
          <button type="button" className="diff-confirm" onClick={confirmReview}>确认</button>
        </div>
      )}
    </div>
  )

  return (
    <div className="diff-block" data-lang="diff">
      <div className="diff-head">
        <span className="diff-title">
          <span className="diff-label">变更对比</span>
          {filename !== undefined && <span className="diff-file">{filename}</span>}
        </span>
        <div className="diff-actions">
          {mode === 'view' && (
            <>
              <button type="button" className="diff-btn diff-accept" onClick={() => { setMode('applied') }}>接受</button>
              <button type="button" className="diff-btn diff-reject" onClick={() => { setMode('rejected') }}>拒绝</button>
              <button type="button" className="diff-btn diff-review" onClick={() => { setMode('review') }}>逐行审阅</button>
            </>
          )}
        </div>
      </div>
      {mode === 'applied' || mode === 'rejected' ? (
        <>
          <div className="diff-applied">
            <span className={'diff-applied-tag' + (mode === 'rejected' ? ' diff-applied-tag-rejected' : '')}>
              {mode === 'applied' ? '已应用' : '已拒绝'}
            </span>
            {mode === 'applied' && accepted.size + rejected.size > 0 && (
              <span className="diff-applied-summary">
                接受 {tallies.acceptedAdds} 行 / 拒绝 {tallies.rejectedDels} 行
              </span>
            )}
            {mode === 'applied' && resultText !== '' && (
              <button type="button" className="diff-undo" onClick={() => { void copyText(resultText, '已复制结果代码') }}>复制结果</button>
            )}
            {mode === 'rejected' && (
              <button type="button" className="diff-undo" onClick={undo}>重新生成</button>
            )}
            <button type="button" className="diff-undo" onClick={undo}>撤销</button>
          </div>
          <div className="diff-dimmed">{body}</div>
        </>
      ) : body}
    </div>
  )
})

/** Every line key of one type (whole-diff accept = all adds). */
function allKeys(diff: ParsedDiff, type: 'add' | 'del'): ReadonlySet<string> {
  const keys = new Set<string>()
  diff.hunks.forEach((hunk, hunkIndex) => {
    hunk.lines.forEach((line, lineIndex) => {
      if (line.type === type) keys.add(`${hunkIndex}:${lineIndex}`)
    })
  })
  return keys
}

/** One diff row: optional review action cell + old/new numbers + content. */
function DiffRow({ line, reviewing, accepted, rejected, onToggle }: {
  line: DiffLine
  reviewing: boolean
  accepted: boolean
  rejected: boolean
  onToggle(): void
}) {
  const kindClass = line.type === 'add' ? ' diff-add' : line.type === 'del' ? ' diff-del' : ''
  const decided = (line.type === 'add' && accepted) || (line.type === 'del' && rejected)
  return (
    <div className={'diff-row' + (reviewing ? ' diff-row-review' : '') + kindClass + (decided ? ' diff-decided' : '')}>
      {reviewing && (
        <div className="diff-review-cell">
          {line.type === 'add' && (
            <button
              type="button"
              className={'diff-line-btn diff-line-add-btn' + (accepted ? ' diff-line-btn-on' : '')}
              aria-label="接受该行"
              onClick={onToggle}
            >+</button>
          )}
          {line.type === 'del' && (
            <button
              type="button"
              className={'diff-line-btn diff-line-del-btn' + (rejected ? ' diff-line-btn-on' : '')}
              aria-label="拒绝该行"
              onClick={onToggle}
            >−</button>
          )}
        </div>
      )}
      <span className="diff-oldno">{line.oldNo ?? ''}</span>
      <span className="diff-newno">{line.newNo ?? ''}</span>
      <span className="diff-text" dangerouslySetInnerHTML={{ __html: lineHtml(line) }} />
    </div>
  )
}

/** Render a line's content, wrapping word-level marks in highlight spans. */
function lineHtml(line: DiffLine): string {
  const words = line.words
  if (words === undefined || words.length === 0) return escapeHtml(line.text)
  let out = ''
  for (const word of words) {
    const escaped = escapeHtml(word.text)
    if (word.kind === 'add') out += '<span class="diff-word-add">' + escaped + '</span>'
    else if (word.kind === 'del') out += '<span class="diff-word-del">' + escaped + '</span>'
    else out += escaped
  }
  return out
}
