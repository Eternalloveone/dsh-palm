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

import { useMemo, useState } from 'react'
import type { JobView } from '@deepseek-ai/dsh-host-apiproxy/api/jobs'
import { Sheet } from './sheet.tsx'
import { TaskRow } from './task-status.tsx'
import type { TodoItem, TodoSnapshot } from './messages.ts'
import { countRunningSubagents, sortSubagentsRunningFirst, type SubagentFlatNode } from './subagent-tree.ts'

/** Rows of the flat subagent list shown before the fold (phone-friendly). */
export const SUBAGENT_VISIBLE_MAX = 5

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

/** One flat subagent row: status dot + label + activity wording. */
function SubagentRow({ node }: { node: SubagentFlatNode }) {
  const running = node.activity === 'running'
  return (
    <div className="chat-subagent-row" role="listitem">
      <span className={'chat-subagent-dot' + (running ? ' chat-subagent-dot-running' : '')} aria-hidden />
      <span className="chat-subagent-copy">
        <span className="chat-subagent-label">{node.label}</span>
        <span className="chat-subagent-meta">{running ? '运行中' : '空闲'}</span>
      </span>
    </div>
  )
}

/**
 * The 子代理 section of the run-status sheet: a flat, running-first list that
 * folds past SUBAGENT_VISIBLE_MAX rows behind an expander (a long delegation
 * chain must not take over the sheet).
 */
function SubagentSection({ nodes }: { nodes: readonly SubagentFlatNode[] }) {
  const [expanded, setExpanded] = useState(false)
  const sorted = useMemo(() => sortSubagentsRunningFirst(nodes), [nodes])
  const hidden = Math.max(0, sorted.length - SUBAGENT_VISIBLE_MAX)
  const visible = expanded || hidden === 0 ? sorted : sorted.slice(0, SUBAGENT_VISIBLE_MAX)
  const running = countRunningSubagents(nodes)
  return (
    <section className="chat-run-section" aria-label="子代理">
      <div className="chat-run-section-head">
        <span className="chat-run-section-title">子代理</span>
        <span className="chat-run-section-count">
          {running > 0 ? `${running} 个运行中` : `${nodes.length} 个`}
        </span>
      </div>
      <div className="chat-subagent-list" role="list" aria-label="子代理列表">
        {visible.map(node => <SubagentRow key={node.id} node={node} />)}
      </div>
      {hidden > 0 && (
        <button type="button" className="chat-run-fold" onClick={() => { setExpanded(value => !value) }}>
          {expanded ? '收起' : `… 还有 ${hidden} 个子代理`}
        </button>
      )}
    </section>
  )
}

/**
 * The strip: one line with a live dot + combined summary; taps open the
 * sheet. null while there is nothing to show.
 */
export function RunStatusBar({
  todo,
  jobs,
  subagents,
  onOpen,
}: {
  todo: TodoSnapshot | undefined
  jobs: readonly JobView[]
  subagents: readonly SubagentFlatNode[]
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
    const runningSubagents = countRunningSubagents(subagents)
    if (runningSubagents > 0) parts.push(`子代理 ${runningSubagents} 个运行中`)
    return parts
  }, [todo, jobs, subagents])
  if (text.length === 0) return null

  const busy = (todo !== undefined && todo.items.some(item => item.status === 'in_progress'))
    || liveJobCount(jobs) > 0
    || countRunningSubagents(subagents) > 0

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
  subagents,
  onClose,
}: {
  todo: TodoSnapshot | undefined
  jobs: readonly JobView[]
  subagents: readonly SubagentFlatNode[]
  onClose(): void
}) {
  const hasTodos = todo !== undefined && todo.items.length > 0
  if (!hasTodos && jobs.length === 0 && subagents.length === 0) return null

  return (
    <Sheet title="运行状态" onClose={onClose}>
      {subagents.length > 0 && <SubagentSection nodes={subagents} />}
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
