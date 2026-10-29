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

import { useEffect, useMemo, useState } from 'react'
import type { JobView } from '../api-proxy-types'
import { formatRunDuration } from './run-detail.ts'
import { Sheet } from './sheet.tsx'
import { TaskRow } from './task-status.tsx'
import type { TodoItem, TodoSnapshot } from './messages.ts'
import { countRunningSubagents, sortSubagentsRunningFirst, type SubagentFlatNode } from './subagent-tree.ts'

/** 淡出动画时长：内容清空后先留这么久播收起动画，再整条卸载（不占位）。 */
export const STATUS_LEAVE_MS = 320

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

/** One flat subagent row: status dot + label + activity wording. Shared with
 *  the global run-overview page, whose session cards reuse this exact row. */
export function SubagentRow({ node }: { node: SubagentFlatNode }) {
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
  text: textOverride,
  live = false,
  onOpen,
}: {
  todo: TodoSnapshot | undefined
  jobs: readonly JobView[]
  subagents: readonly SubagentFlatNode[]
  /**
   * 外部算好的「这一条该写什么」。
   *
   * 给了就用它（`undefined` = 不显示）；不给才退回本组件自己按 todo/jobs/subagents
   * 推导 —— 这是迁移期的双轨，判据最终只剩 `session-status.ts` 里的 `describeBars`。
   */
  text?: string | undefined
  /** 回合是否在跑：决定左侧圆点是「活的」还是静止（以前只看任务/后台任务）。 */
  live?: boolean
  onOpen(): void
}) {
  const derived = useMemo(() => {
    const parts: string[] = []
    const liveJobs = liveJobCount(jobs)
    const liveSubagents = countRunningSubagents(subagents)
    const { done, total } = todo === undefined ? { done: 0, total: 0 } : todoCount(todo.items)
    // 整轮都收工了、也没有还在跑的后台任务/子代理：这一条没有信息量，收起。
    // 真机反馈：一轮跑完，发送框上凭空挂一条「任务 3/3」，像是刚冒出来的消息。
    // 有后台任务或子代理时仍然显示（那说明还有东西在动，值得占位）。
    const allDone = total > 0 && done === total && liveJobs === 0 && liveSubagents === 0
    if (allDone) return parts
    if (todo !== undefined && todo.items.length > 0) {
      // 在做的第几项也直接说出来：光有 3/7 看不出卡在哪一步（真机反馈：
      // 得点开面板才知道计划停在哪）。
      const activeIndex = todo.items.findIndex(item => item.status === 'in_progress')
      parts.push(activeIndex >= 0 ? `任务 ${done}/${total} · 正在做第 ${activeIndex + 1} 项` : `任务 ${done}/${total}`)
    }
    if (jobs.length > 0) {
      const live = liveJobCount(jobs)
      parts.push(live > 0 ? `后台任务 ${live} 个运行中` : `后台任务 ${jobs.length} 个`)
    }
    const runningSubagents = countRunningSubagents(subagents)
    if (runningSubagents > 0) parts.push(`子代理 ${runningSubagents} 个运行中`)
    return parts
  }, [todo, jobs, subagents])
  // 判据上移：给了 `text` 就照它显示（`undefined` = 不显示），本组件不再自己判断。
  const rawText = textOverride !== undefined
    ? (textOverride === '' ? [] : [textOverride])
    : derived
  // 文案完全由 `describeBars` 决定；本组件不自己造时间（那会和过程条头的用时重复）。
  const text = rawText
  // 淡出：内容清空时不立刻卸载，先播 320ms 的收起动画（否则条子会「啪」地消失，
  // 下面的输入框跟着跳一下）。动画接受后真正卸载，不占位。
  const [shown, setShown] = useState<readonly string[]>(text)
  const [leaving, setLeaving] = useState(false)
  const textKey = text.join('|')
  useEffect(() => {
    if (text.length > 0) {
      setShown(text)
      setLeaving(false)
      return
    }
    setShown(previous => {
      if (previous.length === 0) return previous
      setLeaving(true)
      return previous
    })
  }, [textKey])
  useEffect(() => {
    if (!leaving) return
    const timer = window.setTimeout(() => {
      setShown([])
      setLeaving(false)
    }, STATUS_LEAVE_MS)
    return () => { window.clearTimeout(timer) }
  }, [leaving])
  if (shown.length === 0) return null

  const busy = live
    || (todo !== undefined && todo.items.some(item => item.status === 'in_progress'))
    || liveJobCount(jobs) > 0
    || countRunningSubagents(subagents) > 0

  return (
    <button
      type="button"
      className={'chat-status-strip' + (leaving ? ' chat-status-strip-leaving' : '')}
      onClick={onOpen}
    >
      <span className={'chat-status-dot' + (busy ? ' chat-status-dot-live' : '')} aria-hidden />
      <span className="chat-status-text">{shown.join(' · ')}</span>
    </button>
  )
}

/**
 * 「别的会话跑完了」的顶部条。
 *
 * 原来这条信息是**底部浮层**（`.finish-toast`，`position: fixed; bottom: …`），
 * 而输入区 `.chat-composer` 也钉在底部（z-index 50 < 浮层 60）—— 浮层直接把输入框盖住
 * （真机反馈：挡到打字）。聊天页本来就有顶部状态条（HUD），这条信息放这里信息量一样，
 * 却不占底部任何像素；底部浮层只留给「首页/运行中/设置」这些没有输入区的页面。
 */
export function FinishedElsewhereBar({
  title,
  status,
  durationMs,
  onOpen,
  onDismiss,
}: {
  title: string
  status: 'done' | 'error' | 'stopped'
  durationMs?: number | undefined
  onOpen(): void
  onDismiss(): void
}) {
  const label = status === 'error' ? '出错退出' : status === 'stopped' ? '已中断' : '已完成'
  return (
    <div
      className="chat-status-strip chat-finished-strip"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <span
        className={'chat-finished-ic' + (status === 'error' ? ' is-bad' : status === 'stopped' ? ' is-stop' : '')}
        aria-hidden
      >
        {status === 'error' ? '!' : status === 'stopped' ? '⏸' : '✓'}
      </span>
      <span className="chat-status-text">
        {title}
        {' · '}
        {label}
        {durationMs === undefined ? '' : ` · ${formatRunDuration(durationMs)}`}
      </span>
      <span className="chat-finished-chev" aria-hidden>›</span>
      <button
        type="button"
        className="chat-finished-dismiss"
        aria-label="收起这条提示"
        onClick={(event) => {
          event.stopPropagation()
          onDismiss()
        }}
      >
        ✕
      </button>
    </div>
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
