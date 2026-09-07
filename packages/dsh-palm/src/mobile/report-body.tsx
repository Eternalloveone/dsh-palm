/**
 * ReportBody: renders a settled "result report" turn as a structured card
 * (status rows with trailing chips, section headings, commit chips with a
 * copy button) while delegating every plain markdown run — paragraphs,
 * fenced code/diff, tables — back to MarkdownText unchanged.
 *
 * Triggering and container live in MessageRow (.chat-msg-report); this
 * component only rewrites the structured LINES, never the prose.
 */
import { Fragment, type ReactNode } from 'react'
import { copyText } from './code-actions.ts'
import { MarkdownText } from './markdown-text.tsx'
import { parseReportLines, type ReportSegment } from './report.ts'

function StatusChip({ status, note }: { status: 'ok' | 'fail' | 'run'; note?: string }) {
  const glyph = status === 'ok' ? '✓' : status === 'fail' ? '✗' : '●'
  return (
    <span className={`rpt-chip rpt-${status}`}>
      <span aria-hidden>{glyph}</span>
      {note !== undefined && note !== '' ? ` ${note}` : status === 'ok' ? ' 通过' : status === 'fail' ? ' 失败' : ' 进行中'}
    </span>
  )
}

export function ReportBody({ text }: { text: string }) {
  // Group consecutive plain lines into one run so fences/tables/paragraphs
  // keep flowing through MarkdownText per contiguous chunk.
  const parts: ReactNode[] = []
  let plain: string[] = []
  let key = 0
  const flush = (): void => {
    if (plain.length > 0) {
      const body = plain.join('\n')
      if (body.trim() !== '') {
        parts.push(<MarkdownText key={`t${key}`} text={body} pending={false} />)
        key += 1
      }
      plain = []
    }
  }
  const push = (node: ReactNode): void => {
    flush()
    parts.push(node)
    key += 1
  }

  for (const segment of parseReportLines(text)) {
    switch (segment.type) {
      case 'status': {
        push(
          <div className="rpt-line" key={`s${key}`}>
            <span className="rpt-label">{segment.label}</span>
            <StatusChip status={segment.status} note={segment.note} />
          </div>,
        )
        break
      }
      case 'heading':
        push(
          <div className="rpt-section" key={`h${key}`}>
            <span>{segment.text}</span>
          </div>,
        )
        break
      case 'commit':
        push(
          <div className="rpt-commit" key={`c${key}`}>
            <span className="rpt-commit-hash">{segment.hash}</span>
            <button
              type="button"
              className="rpt-copy"
              onClick={() => { void copyText(segment.hash, '已复制 commit') }}
            >
              复制
            </button>
          </div>,
        )
        break
      default:
        plain.push(segment.text)
    }
  }
  flush()
  return <Fragment>{parts}</Fragment>
}
