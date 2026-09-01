/**
 * Task status bar: a collapsible strip above the composer that surfaces the
 * parent session's background jobs (subagent delegations, bash/pwsh runs, …)
 * as the host reports them via `session/jobs` frames. The host pushes a full
 * snapshot after every registry commit (registration, stopping, settlement,
 * owner-disposal), so this component is a pure projection of the latest
 * snapshot — no local lifecycle bookkeeping.
 *
 * The bar renders nothing while the set is empty; absence is how the host
 * expresses "no tasks". Collapsed it shows a one-line summary (running count);
 * expanded it lists each job with its kind, label, status and detail.
 */

import { useState } from 'react'
import type { JobView } from '@deepseek-ai/dsh-host-apiproxy/api/jobs'
import { ChevronDownIcon } from './icons.tsx'

/** Human wording for each job lifecycle state. */
const STATUS_LABEL: Record<JobView['status'], string> = {
  running: '运行中',
  stopping: '停止中',
  completed: '已完成',
  killed: '已终止',
  failed: '失败',
}

/** CSS class suffix per status (drives the status-dot colour). */
const STATUS_CLASS: Record<JobView['status'], string> = {
  running: 'running',
  stopping: 'stopping',
  completed: 'completed',
  killed: 'killed',
  failed: 'failed',
}

/** A short human kind label for the common producers; unknown kinds fall back to the raw kind. */
const KIND_LABEL: Record<string, string> = {
  subagent: '子代理',
  bash: '命令',
  pwsh: '命令',
  'pty-send': '终端',
}

function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind
}

/** Lifecycle states that are still in flight (listed first). */
const ACTIVE_STATUSES: ReadonlySet<JobView['status']> = new Set(['running', 'stopping'])

function isActive(job: JobView): boolean {
  return ACTIVE_STATUSES.has(job.status)
}

/** HH:MM wall clock for a job's start or end instant. */
function clock(epochMs: number): string {
  const date = new Date(epochMs)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** Human duration between two instants, e.g. "45 秒" or "2 分钟". */
function duration(startedAt: number, finishedAt: number): string {
  const seconds = Math.max(0, Math.round((finishedAt - startedAt) / 1000))
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.round(seconds / 60)} 分钟`
}

/** One job row inside the expanded body. Exported for reuse inside the
 * run-status bottom sheet. */
export function TaskRow({ job }: { job: JobView }) {
  const statusClass = STATUS_CLASS[job.status] ?? 'running'
  const time = job.finishedAt !== undefined
    ? `${clock(job.startedAt)} → ${clock(job.finishedAt)} · 用时 ${duration(job.startedAt, job.finishedAt)}`
    : `开始于 ${clock(job.startedAt)}`
  return (
    <div className="chat-task-row" role="listitem">
      <span className={`chat-task-dot chat-task-dot-${statusClass}`} aria-hidden />
      <span className="chat-task-copy">
        <span className="chat-task-label">{job.label}</span>
        <span className="chat-task-meta">
          {kindLabel(job.kind)} · {STATUS_LABEL[job.status] ?? job.status}
          {job.detail !== undefined && job.detail !== '' ? ` · ${job.detail}` : ''}
        </span>
        <span className="chat-task-time">{time}</span>
      </span>
    </div>
  )
}

/**
 * Collapsible background-task strip. `jobs` is the latest `session/jobs`
 * snapshot for the current session; an empty array renders nothing.
 */
export function TaskStatusBar({ jobs }: { jobs: JobView[] }) {
  const [open, setOpen] = useState(false)
  if (jobs.length === 0) return null

  const running = jobs.filter(job => job.status === 'running' || job.status === 'stopping').length
  const summary = running > 0
    ? `${running} 个运行中 · 共 ${jobs.length} 个后台任务`
    : `${jobs.length} 个后台任务`

  return (
    <div className={'chat-taskbar' + (open ? ' chat-taskbar-open' : '')}>
      <button
        type="button"
        className="chat-taskbar-head"
        aria-expanded={open}
        onClick={() => { setOpen(previous => !previous) }}
      >
        <span className="chat-taskbar-label">后台任务</span>
        <span className="chat-taskbar-summary">{summary}</span>
        <span className="chat-disclosure-caret" aria-hidden>
          <ChevronDownIcon width={14} height={14} />
        </span>
      </button>
      {open && (
        <div className="chat-taskbar-body" role="list" aria-label="后台任务列表">
          {/* In-flight jobs first, settled ones after; stable sort keeps the
              host's order within each group. */}
          {[...jobs].sort((a, b) => Number(isActive(b)) - Number(isActive(a))).map(job => (
            <TaskRow key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  )
}
