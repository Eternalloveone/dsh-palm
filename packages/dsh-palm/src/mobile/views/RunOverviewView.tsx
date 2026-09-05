/**
 * Global run overview: a full-screen, cross-session view of everything the
 * host is doing right now. Two signals feed it:
 *
 *  1. Background jobs — the per-session `session/jobs` snapshots the mux
 *     stream retains. Sessions delegating to subagents, compiling, or running
 *     commands appear with their job rows (live first).
 *  2. Running sessions — sessions whose agent is mid-turn (`session.list`
 *     rows with running:true, kept fresh by live `turn/start` / `turn/end`
 *     frames). A plain conversation that is generating but owns no background
 *     job still shows up as a running session, so "what is happening on the
 *     host" is complete even when nothing is delegating.
 *
 * Pure projection on the phone: no host method, no new RPC beyond the roster
 * list (60 s host TTL) and the page-lifetime mux stream. Rows are read-only;
 * tapping a session opens it (the chat's own run-status sheet shows the
 * fine-grained todo/task detail).
 *
 * @module dsh-palm/mobile/views/RunOverviewView
 */

import { useEffect, useRef, useState } from 'react'
import type { JobView } from '@deepseek-ai/dsh-host-apiproxy/api/jobs'
import type { MuxFrame } from '@deepseek-ai/dsh-host-apiproxy/api/events'
import { listSessions } from '../api.ts'
import { TaskRow } from '../task-status.tsx'
import { InboxIcon } from '../icons.tsx'
import type { SessionSummary } from '@deepseek-ai/dsh-host-apiproxy/api/sessions'

/** Roster pages fetched at most while building the running-session baseline. */
const ROSTER_PAGE_LIMIT = 8

/** Lifecycle states that count as "in flight" (hero count + live grouping). */
const LIVE_STATUSES: ReadonlySet<JobView['status']> = new Set(['running', 'stopping'])

function isLive(job: JobView): boolean {
  return LIVE_STATUSES.has(job.status)
}

/** Derive a row title the same way the session list does (title projection
 *  → cwd tail → generic), so a session card never shows a bare id. */
function titleOf(summary: SessionSummary | undefined): string | undefined {
  if (summary === undefined) return undefined
  const values = summary.projections?.values
  const titleValue = values?.title
  if (typeof titleValue === 'string' && titleValue !== '') return titleValue
  if (summary.cwd !== undefined) {
    const tail = summary.cwd.split('/').filter(Boolean).at(-1)
    if (tail !== undefined && tail !== '') return tail
  }
  return undefined
}

/** A session.list row reduced to what the overview consumes. */
export interface RosterRow {
  sessionId: string
  title?: string
  running: boolean
  blank: boolean
}

/** Page through session.list (bounded) to snapshot running sessions + titles. */
export async function fetchRoster(): Promise<{ rows: RosterRow[]; truncated: boolean }> {
  const rows: RosterRow[] = []
  let cursor: string | undefined
  for (let page = 0; page < ROSTER_PAGE_LIMIT; page++) {
    let pageRows: SessionSummary[]
    let hasMore = false
    try {
      const pageResult = await listSessions(cursor)
      pageRows = pageResult.items
      cursor = pageResult.nextCursor
      hasMore = pageResult.hasMore
    } catch {
      return { rows, truncated: true }
    }
    for (const item of pageRows) {
      rows.push({
        sessionId: String(item.sessionId),
        ...(titleOf(item) !== undefined ? { title: titleOf(item) } : {}),
        running: item.running === true,
        blank: item.blank === true,
      })
    }
    if (!hasMore) return { rows, truncated: false }
  }
  return { rows, truncated: true }
}

/** Row shape: one session's display card. */
interface SessionRun {
  sessionId: string
  title: string
  /** Background-job rows (absent = the session is only running its turn). */
  jobs: readonly JobView[]
  /** Whether the session is doing something right now. */
  live: boolean
  /** True when the session runs but owns no background jobs. */
  runningOnly: boolean
}

/** Merge the jobs snapshot with running sessions into one ordered card list. */
function buildRows(
  jobsSnapshot: ReadonlyArray<{ sessionId: string; jobs: readonly JobView[] }>,
  roster: ReadonlyMap<string, RosterRow>,
  liveSessionIds: ReadonlySet<string>,
): SessionRun[] {
  const cards = new Map<string, SessionRun>()
  const add = (sessionId: string): void => {
    if (cards.has(sessionId)) return
    cards.set(sessionId, {
      sessionId,
      title: roster.get(sessionId)?.title ?? `会话 ${sessionId.slice(0, 6)}`,
      jobs: [],
      live: false,
      runningOnly: false,
    })
  }
  for (const row of jobsSnapshot) {
    if (row.jobs.length === 0) continue
    add(row.sessionId)
    const card = cards.get(row.sessionId)!
    card.jobs = row.jobs
    card.live = row.jobs.some(job => isLive(job))
  }
  // Running sessions with no retained jobs still belong in the overview.
  for (const sessionId of liveSessionIds) {
    add(sessionId)
    const card = cards.get(sessionId)!
    card.live = true
    if (card.jobs.length === 0) card.runningOnly = true
    // A title known from the roster improves the fallback short id.
    if (card.title.startsWith('会话 ')) {
      const rosterRow = roster.get(sessionId)
      if (rosterRow?.title !== undefined) card.title = rosterRow.title
    }
  }
  const rows = [...cards.values()]
  rows.sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1
    if (a.runningOnly !== b.runningOnly) return a.runningOnly ? -1 : 1
    return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0
  })
  return rows
}

/** Props for the global run-overview page. */
export interface RunOverviewViewProps {
  /** The page-lifetime mux client (its jobs snapshots are the data source). */
  mux?: RunOverviewMux | undefined
  onBack(): void
  /** Open one session in the chat surface (title best-effort). */
  onOpenSession(hit: { sessionId: string; title?: string }): void
}

/** The MuxClient surface this page consumes (structural, for test stubs). */
export interface RunOverviewMux {
  jobsSnapshot(): Array<{ sessionId: string; jobs: readonly JobView[] }>
  /** Sessions whose turn is open, tracked for the mux's whole lifetime. */
  runningSessionsSnapshot(): string[]
  onFrame(listener: (frame: MuxFrame) => void): () => void
}

/** Render the cross-session run overview (full-screen page). */
export function RunOverviewView({ mux, onBack, onOpenSession }: RunOverviewViewProps) {
  const [snapshot, setSnapshot] = useState<Array<{ sessionId: string; jobs: readonly JobView[] }>>(
    () => mux?.jobsSnapshot() ?? [],
  )
  /** Roster baseline: titles + running flags (fetched once per page open). */
  const [roster, setRoster] = useState<ReadonlyMap<string, RosterRow>>(new Map())
  /** Session ids known to be running (baseline ∪ live turn/start frames). */
  const [liveSessions, setLiveSessions] = useState<ReadonlySet<string>>(() => {
    const initial = new Set<string>()
    for (const id of mux?.runningSessionsSnapshot() ?? []) initial.add(id)
    return initial
  })
  const liveRef = useRef<Set<string>>(new Set(mux?.runningSessionsSnapshot() ?? []))
  const updateLive = (sessionId: string, running: boolean): void => {
    const next = new Set(liveRef.current)
    if (running) next.add(sessionId)
    else next.delete(sessionId)
    liveRef.current = next
    setLiveSessions(next)
  }

  // Roster baseline: running sessions + display titles, once per page open.
  useEffect(() => {
    let cancelled = false
    void fetchRoster().then(
      ({ rows }) => {
        if (cancelled) return
        const map = new Map<string, RosterRow>()
        const running = new Set(liveRef.current)
        for (const row of rows) {
          map.set(row.sessionId, row)
          // Seed the running set from the roster unless a live frame already
          // decided otherwise (a turn/end may have cleared a just-finished one).
          if (row.running === true && !row.blank) running.add(row.sessionId)
        }
        liveRef.current = running
        setRoster(map)
        setLiveSessions(running)
      },
      () => { if (!cancelled) setLiveSessions(new Set(liveRef.current)) },
    )
    return () => { cancelled = true }
  }, [])

  // Live stream: jobs snapshots refresh the cards; turn boundaries move a
  // session in and out of the running set without a roster re-fetch.
  useEffect(() => {
    if (mux === undefined) return
    const onFrame = (frame: MuxFrame): void => {
      if (frame.type === 'session/jobs' || frame.type === 'session/subscribed') {
        setSnapshot(mux.jobsSnapshot())
        return
      }
      if (frame.type === 'session/event') {
        const eventType = (frame.event as { type?: string }).type
        const sessionId = String(frame.sessionId)
        if (eventType === 'turn/start') updateLive(sessionId, true)
        else if (eventType === 'turn/end') updateLive(sessionId, false)
      }
    }
    const unsubscribe = mux.onFrame(onFrame)
    setSnapshot(mux.jobsSnapshot())
    return unsubscribe
  }, [mux])

  const rows = buildRows(snapshot, roster, liveSessions)
  const liveCount = rows.reduce((sum, row) => sum + row.jobs.filter(job => isLive(job)).length, 0)
  const runningSessionCount = rows.filter(row => row.live).length
  const liveRows = rows.filter(row => row.live)
  const settled = rows.filter(row => !row.live)

  return (
    <div className="mobile">
      <header className="mobile-header" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 4px)' }}>
        <div className="mobile-headerSlot">
          <button type="button" className="mobile-back" aria-label="返回" onClick={onBack}>‹</button>
        </div>
        <h1 className="mobile-title">运行中</h1>
        <div className="mobile-headerSlot mobile-headerSlot-right" />
      </header>

      <div className="runov-page">
        {rows.length === 0 && (
          <div className="mobile-empty" style={{ paddingTop: 28 }}>
            <div className="empty-icon"><InboxIcon /></div>
            <p className="empty-title">当前没有运行中的会话或任务</p>
            <p className="empty-desc">会话输出、子代理委派、命令运行会实时显示在这里</p>
          </div>
        )}
        {rows.length > 0 && (
          <div className="runov-scroll">
            <div className="runov-hero">
              <span className="chat-status-dot chat-status-dot-live" aria-hidden />
              <span className="runov-hero-copy">
                <span className="runov-hero-t">
                  {liveCount > 0 || runningSessionCount > 0
                    ? `${runningSessionCount} 个会话正在运行 · ${liveCount} 个后台任务`
                    : `${rows.length} 个会话有近期后台任务`}
                </span>
                <span className="runov-hero-s">跨全部工作区 · 实时同步</span>
              </span>
            </div>

            {liveRows.length > 0 && (
              <>
                <div className="runov-group-title">正在运行 · {runningSessionCount}</div>
                {liveRows.map(row => (
                  <SessionCard key={row.sessionId} row={row} onOpen={() => { onOpenSession({ sessionId: row.sessionId, title: row.title }) }} />
                ))}
              </>
            )}

            {settled.length > 0 && (
              <>
                <div className="runov-group-title">最近结束</div>
                {settled.map(row => (
                  <SessionCard key={row.sessionId} row={row} onOpen={() => { onOpenSession({ sessionId: row.sessionId, title: row.title }) }} />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** One session card: title head + its task rows (TaskRow visual grammar). */
function SessionCard({ row, onOpen }: { row: SessionRun; onOpen(): void }) {
  return (
    <div className="runov-sess">
      <button type="button" className="runov-sess-head" onClick={onOpen}>
        {row.live && <span className="runov-sess-live"><span className="chat-status-dot chat-status-dot-live" aria-hidden />{row.runningOnly ? '回合中' : '运行中'}</span>}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="runov-sess-title">{row.title}</span>
          <span className="runov-sess-sub">{row.sessionId}</span>
        </span>
        <span className="runov-sess-chev">›</span>
      </button>
      {row.jobs.length > 0 && (
        <div className="runov-jobs" role="list" aria-label={`${row.title} 的后台任务`}>
          {row.jobs.map(job => <TaskRow key={job.id} job={job} />)}
        </div>
      )}
      {row.runningOnly && (
        <div className="runov-jobs" role="status">
          <div className="chat-task-row">
            <span className="chat-task-dot chat-task-dot-running" aria-hidden />
            <span className="chat-task-copy">
              <span className="chat-task-label">回合运行中</span>
              <span className="chat-task-meta">正在生成回复 · 点击进入查看</span>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
