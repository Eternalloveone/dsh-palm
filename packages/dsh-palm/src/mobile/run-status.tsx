/**
 * Run-status strip + sheet: the mobile form of the desktop TodoPanel /
 * background-task dock. One compact strip above the chat toolbar summarizes
 * whatever is live for this session — the todo plan (`todo/write` snapshot)
 * and the background jobs (`session/jobs` snapshot) — and opens a bottom
 * sheet with the details split into two sections.
 *
 * The strip renders nothing while both inputs are empty (absence is how the
 * host expresses "no plan / no tasks"), so the toolbar area stays clean in
 * quiet sessions. Live frames keep flowing into the sheet while it is open:
 * both inputs are plain state projections.
 * @module dsh-palm/mobile/run-status
 */

import { useMemo } from 'react'
import type { JobView } from '@deepseek-ai/dsh-host-apiproxy/api/jobs'
import { Sheet } from './sheet.tsx'
import { TaskRow } from './task-status.tsx'
import type { TodoItem, TodoSnapshot } from './messages.ts'

/** Lifecycle states still in flight (drive the strip's live dot). */
const LIVE_JOB_STATUSES: ReadonlySet<JobView['status']> = new Set(['running', 'stopping'])

function liveJobCount(jobs: readonly JobView[]): number {
  let count = 0
  for (const job of jobs) {
    if (LIVE_JOB_STATUSES.has(job.status)) count += 1
  }
  return count
}

/** `done/total` for the todo list (completed count + total). */
function todoCount(items: readonly TodoItem[]): { done: number; total: number } {
  let done = 0
  for (const item of items) {
    if (item.status === 'completed') done += 1
  }
  return { done, total: items.length }
}

/** One todo row inside the sheet: status marker + content, muted when done. */
function TodoRowItem({ item }: { item: TodoItem }) {
  return (
    <li className={`chat-run-todo chat-run-todo-${item.status}`}>
      <span className="chat-run-todo-mark" aria-hidden>
        {item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '●' : '○'}
      </span>
      <span className="chat-run-todo-content">{item.content}</span>
    </li>
  )
}

/**
 * The strip: one line with a live dot + combined summary; taps open the
 * sheet. null while there is nothing to show.
 */
export function RunStatusBar({
  todo,
  jobs,
  onOpen,
}: {
  todo: TodoSnapshot | undefined
  jobs: readonly JobView[]
  onOpen(): void
}) {
  const text = useMemo(() => {
    const parts: string[] = []
    if (todo !== undefined && todo.items.length > 0) {
      const { done, total } = todoCount(todo.items)
      parts.push(`任务 ${done}/${total}`)
    }
    if (jobs.length > 0) {
      const live = liveJobCount(jobs)
      parts.push(live > 0 ? `后台任务 ${live} 个运行中` : `后台任务 ${jobs.length} 个`)
    }
    return parts
  }, [todo, jobs])
  if (text.length === 0) return null

  const busy = (todo !== undefined && todo.items.some(item => item.status === 'in_progress'))
    || liveJobCount(jobs) > 0

  return (
    <button type="button" className="chat-status-strip" onClick={onOpen}>
      <span className={'chat-status-dot' + (busy ? ' chat-status-dot-live' : '')} aria-hidden />
      <span className="chat-status-text">{text.join(' · ')}</span>
    </button>
  )
}

/**
 * The run-status bottom sheet: 任务清单 + 后台任务 sections, each shown only
 * when it has content. Closed by the shared Sheet chrome (backdrop, drag>
 * threshold, Esc, handle).
 */
export function RunStatusSheet({
  todo,
  jobs,
  onClose,
}: {
  todo: TodoSnapshot | undefined
  jobs: readonly JobView[]
  onClose(): void
}) {
  const hasTodos = todo !== undefined && todo.items.length > 0
  if (!hasTodos && jobs.length === 0) return null

  return (
    <Sheet title="运行状态" onClose={onClose}>
      {hasTodos && (
        <section className="chat-run-section" aria-label="任务清单">
          <div className="chat-run-section-head">
            <span className="chat-run-section-title">任务清单</span>
            <span className="chat-run-section-count">
              {(() => { const { done, total } = todoCount(todo!.items); return `${done}/${total}` })()}
            </span>
          </div>
          <ul className="chat-run-todo-list">
            {todo!.items.map((item, index) => <TodoRowItem key={index} item={item} />)}
          </ul>
        </section>
      )}
      {jobs.length > 0 && (
        <section className="chat-run-section" aria-label="后台任务">
          <div className="chat-run-section-head">
            <span className="chat-run-section-title">后台任务</span>
            <span className="chat-run-section-count">
              {(() => { const live = liveJobCount(jobs); return live > 0 ? `${live} 个运行中` : `${jobs.length} 个` })()}
            </span>
          </div>
          <div className="chat-run-job-list" role="list" aria-label="后台任务列表">
            {/* In-flight jobs first, settled ones after; stable sort keeps the
                host's order within each group. */}
            {[...jobs].sort((a, b) => Number(LIVE_JOB_STATUSES.has(b.status)) - Number(LIVE_JOB_STATUSES.has(a.status))).map(job => (
              <TaskRow key={job.id} job={job} />
            ))}
          </div>
        </section>
      )}
    </Sheet>
  )
}
