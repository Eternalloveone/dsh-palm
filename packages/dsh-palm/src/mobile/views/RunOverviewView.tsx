/**
 * Global run overview: a full-screen, cross-session view of everything the
 * host is doing right now — plus what just finished.
 *
 * Three signals feed the live part:
 *
 *  1. Background jobs — the per-session `session/jobs` snapshots the mux
 *     stream retains (kept, but folded to one line: the card's action line
 *     already names what is running, the job list is only needed when several
 *     things run at once).
 *  2. Running sessions — sessions whose agent is mid-turn (`session.list`
 *     rows with running:true, kept fresh by live `turn/start` / `turn/end`
 *     frames).
 *  3. Foreground subagents — `subagent.list` for the running sessions only,
 *     polled while this page is open. Each child is a real session, so a row
 *     opens that child's own (read-only) transcript.
 *
 * The card's second/third lines come from one `mobile.logTail` per live
 * session (polled): that page already carries the running tool, the step, the
 * true turn anchor and the newest event time, which is everything "已跑多久 /
 * 在干什么 / 是不是卡住了" needs.
 *
 * "刚结束" is the answer to "跑完了，是哪一个跑完了": finished turns are kept
 * in a small localStorage-backed ledger (see recent-finished.ts) so the card
 * does not simply disappear.
 *
 * @module dsh-palm/mobile/views/RunOverviewView
 */

import { useEffect, useRef, useState } from 'react'
import type { JobView } from '../../api-proxy-types'
import type { MuxFrame } from '../../api-proxy-types'
import type { SessionSummary } from '../../api-proxy-types'
import { listSessions, logTail } from '../api.ts'
import { SUBAGENT_POLL_MS, fetchSubagents, runningSubagents, sortSubagentsRunningFirst, type SubagentFlatNode } from '../subagent-tree.ts'
import { TaskRow } from '../task-status.tsx'
import { InboxIcon } from '../icons.tsx'
import { runningOf, subscribeStatus } from '../session-status-store.ts'
import { RUN_STALE_MS, formatAgo, formatRunDuration, runDetailFromPage, type RunDetail } from '../run-detail.ts'
import {
  clearFinishedRuns,
  finishedRuns,
  mergeHostFinishedRuns,
  recordFinishedRun,
  setFinishedRunsSink,
  shortSessionId,
  subscribeFinishedRuns,
  type FinishedRun,
} from '../recent-finished.ts'
import { appendFinishedRun, fetchFinishedRuns } from '../api.ts'

/** Roster pages fetched at most while building the running-session baseline. */
const ROSTER_PAGE_LIMIT = 8

/** Live sessions this page asks for subagents (bounded fan-out: one
 *  `subagent.list` per live session per tick, at most this many sessions). */
export const SUBAGENT_SESSION_MAX = 4

/** Running subagent rows one card shows before the fold (phone-friendly). */
export const SUBAGENT_VISIBLE_MAX = 3

/** 卡片第二三行（动作/步数/已跑/活动）的刷新间隔：比子代理快一点，
 *  因为"3 秒前有活动"这种字眼看着要跟得上手。 */
export const DETAIL_POLL_MS = 6_000

/** 最多给几个在跑会话拉尾页（正常一屏 1~3 个；多的说明宿主很忙）。 */
export const DETAIL_SESSION_MAX = 6

/** 运行集合的校准间隔（问宿主"这些真的还在跑吗"，顺带纠正花名册的旧旗标）。 */
export const RUNNING_RESYNC_MS = 30_000

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
  if (summary.cwd !== undefined && summary.cwd !== '') {
    // Windows cwd is a backslash path: splitting on '/' alone left the whole
    // `D:\dev\app` in the title, so every session of one directory showed an
    // identical truncated path instead of the directory's name.
    const tail = summary.cwd.split(/[\\/]/).filter(Boolean).at(-1)
    if (tail !== undefined && tail !== '') return tail
  }
  return undefined
}

/** 工作区名（cwd 目录名）：同名会话靠它区分，"这是哪个项目在跑"也靠它。 */
function workspaceOf(summary: SessionSummary | undefined): string | undefined {
  if (summary?.cwd === undefined || summary.cwd === '') return undefined
  return summary.cwd.split(/[\\/]/).filter(Boolean).at(-1)
}

/** A session.list row reduced to what the overview consumes. */
export interface RosterRow {
  sessionId: string
  title?: string
  /** 工作区目录名（cwd 尾段），用来区分同名会话。 */
  workspace?: string
  running: boolean
  blank: boolean
}

/** Page through session.list (bounded) to snapshot running sessions + titles.
 *  `onPage` sees each page as it lands: the roster covers hundreds of
 *  sessions and a cold host enumeration can take tens of seconds, so the
 *  running cards must not wait for the last page of unrelated history. */
export async function fetchRoster(
  onPage?: (rows: readonly RosterRow[]) => void,
): Promise<{ rows: RosterRow[]; truncated: boolean }> {
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
    const landed: RosterRow[] = []
    for (const item of pageRows) {
      const workspace = workspaceOf(item)
      const row: RosterRow = {
        sessionId: String(item.sessionId),
        ...(titleOf(item) !== undefined ? { title: titleOf(item) } : {}),
        ...(workspace === undefined ? {} : { workspace }),
        running: item.running === true,
        blank: item.blank === true,
      }
      rows.push(row)
      landed.push(row)
    }
    onPage?.(landed)
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
  /** 工作区名（cwd 尾段），用于区分同名会话。 */
  workspace?: string
}

/** Merge the jobs snapshot with running sessions into one ordered card list.
 *  `titles` is the best title known for a session beyond the roster baseline
 *  (the live `title` projection frame), because a session that started while
 *  this page is open may not be in the roster snapshot at all. */
function buildRows(
  jobsSnapshot: ReadonlyArray<{ sessionId: string; jobs: readonly JobView[] }>,
  roster: ReadonlyMap<string, RosterRow>,
  liveSessionIds: ReadonlySet<string>,
  titles?: ReadonlyMap<string, string>,
): SessionRun[] {
  const cards = new Map<string, SessionRun>()
  const add = (sessionId: string): void => {
    if (cards.has(sessionId)) return
    const title = roster.get(sessionId)?.title ?? titles?.get(sessionId)
    const workspace = roster.get(sessionId)?.workspace
    cards.set(sessionId, {
      sessionId,
      title: title ?? `会话 ${shortSessionId(sessionId)}`,
      jobs: [],
      live: false,
      runningOnly: false,
      ...(workspace === undefined ? {} : { workspace }),
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
    // A title known from the roster (or a live title frame) improves the
    // fallback short id.
    if (card.title.startsWith('会话 ')) {
      const better = roster.get(sessionId)?.title ?? titles?.get(sessionId)
      if (better !== undefined) card.title = better
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
  /** 打开某个子代理自己的会话（只读）。缺省时不渲染可点行。 */
  onOpenSubagent?(hit: { sessionId: string; label?: string; parentTitle?: string }): void
}

/** The MuxClient surface this page consumes (structural, for test stubs). */
export interface RunOverviewMux {
  jobsSnapshot(): Array<{ sessionId: string; jobs: readonly JobView[] }>
  /** Sessions whose turn is open, tracked for the mux's whole lifetime. */
  runningSessionsSnapshot(): string[]
  /** 让 mux 重新问一次宿主（对过期证据逐个复核）。缺省时页面只信快照。 */
  refreshRunning?(): Promise<void>
  onFrame(listener: (frame: MuxFrame) => void): () => void
}

/** 一秒钟的心跳：让"已跑 12分04秒""3 秒前有活动"自己往前走。 */
function useNowGauge(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [active])
  return now
}

/** Render the cross-session run overview (full-screen page). */
export function RunOverviewView({ mux, onBack, onOpenSession, onOpenSubagent }: RunOverviewViewProps) {
  const [snapshot, setSnapshot] = useState<Array<{ sessionId: string; jobs: readonly JobView[] }>>(
    () => mux?.jobsSnapshot() ?? [],
  )
  /** Roster baseline: titles + running flags (fetched once per page open). */
  const [roster, setRoster] = useState<ReadonlyMap<string, RosterRow>>(new Map())
  /** 实时标题：会话标题投影一旦生成，mux 就会推一帧。列表快照可能早于它，
   *  于是卡片只能退回目录名或短 id —— 这就是"标题不正确"的来源。 */
  const [liveTitles, setLiveTitles] = useState<ReadonlyMap<string, string>>(new Map())
  /** Session ids known to be running (baseline ∪ live turn/start frames). */
  const [liveSessions, setLiveSessions] = useState<ReadonlySet<string>>(() => {
    const initial = new Set<string>()
    for (const id of mux?.runningSessionsSnapshot() ?? []) initial.add(id)
    return initial
  })
  const liveRef = useRef<Set<string>>(new Set(mux?.runningSessionsSnapshot() ?? []))
  /** Foreground children per session. A missing key means "the host has not
   *  answered yet" — the card must then keep its background-job rows. */
  const [childrenBySession, setChildrenBySession] = useState<ReadonlyMap<string, readonly SubagentFlatNode[]>>(
    () => new Map(),
  )
  /** 每个在跑会话的"在干什么/第几步/跑了多久"（来自尾页折叠）。 */
  const [details, setDetails] = useState<ReadonlyMap<string, RunDetail>>(() => new Map())
  /** 刚结束的会话（localStorage 账本，跨页面/跨刷新都在）。 */
  const [finished, setFinished] = useState<readonly FinishedRun[]>(() => finishedRuns())
  /** 正在向宿主校准（顶部 2px 细条）：没有它，卡片静悄悄换内容像个 bug。 */
  const [resyncing, setResyncing] = useState(false)
  /**
   * 这一轮到底跑不跑：**共享状态优先**，没有状态才退回花名册/实时帧。
   *
   * 聊天页是唯一生产者（它同时握着实时帧、原子快照和本地意图）。这里问它，
   * 「聊天页说停了、运行中页还挂着」这类跨页矛盾就没有来源了。
   */
  const authoritativeRunning = (sessionId: string, fallback: boolean): boolean => {
    const shared = runningOf(sessionId)
    return shared === undefined ? fallback : shared
  }
  const updateLive = (sessionId: string, running: boolean): void => {
    const next = new Set(liveRef.current)
    if (authoritativeRunning(sessionId, running)) next.add(sessionId)
    else next.delete(sessionId)
    liveRef.current = next
    setLiveSessions(next)
  }

  useEffect(() => subscribeFinishedRuns(setFinished), [])
  // 账本跟机器走：进页面读一次宿主那边那份（换浏览器/清缓存也在），把本地并进去。
  // 之后每条新的收工都上报 —— 只上报一次是幂等的（宿主按会话去重）。
  useEffect(() => {
    let cancelled = false
    void fetchFinishedRuns().then(
      (hostEntries) => {
        if (cancelled) return
        mergeHostFinishedRuns(hostEntries.map(entry => ({
          sessionId: entry.sessionId,
          title: entry.title,
          finishedAt: entry.finishedAt,
          status: entry.status,
          ...(entry.durationMs === undefined ? {} : { durationMs: entry.durationMs }),
          ...(entry.summary === undefined ? {} : { summary: entry.summary }),
        })))
      },
      () => { /* 老宿主没有这个方法：本地账本照常工作 */ },
    )
    setFinishedRunsSink((entry) => { void appendFinishedRun(entry).catch(() => undefined) })
    return () => { cancelled = true }
  }, [])
  // 聊天页发布/收窄结论时同步刷新本页的「在跑」集合（同一份判据，两个视图）。
  useEffect(() => subscribeStatus(() => {
    const ids = new Set(liveRef.current)
    for (const sessionId of roster.keys()) {
      const shared = runningOf(sessionId)
      if (shared === undefined) continue
      if (shared) ids.add(sessionId)
      else ids.delete(sessionId)
    }
    liveRef.current = ids
    setLiveSessions(ids)
  }), [roster])

  // 运行集合的定期校准：花名册那一行会撒谎（跑完半天还写 running=true），
  // 页面开了就不动的话，一张卡能一直挂着数秒。mux 的 refreshRunning 会重新问宿主，
  // 对"证据过期"的会话逐个用 mobile.turnState 复核 —— 与聊天页同一口径。
  useEffect(() => {
    const refresh = mux?.refreshRunning
    if (mux === undefined || typeof refresh !== 'function') return
    let cancelled = false
    const sync = (): void => {
      if (!cancelled) setResyncing(true)
      void refresh.call(mux).then(
        () => {
          if (cancelled) return
          const ids = new Set(mux.runningSessionsSnapshot())
          liveRef.current = ids
          setLiveSessions(ids)
          setResyncing(false)
        },
        () => { /* 校准失败就保持上一份集合，下一轮再试 */ if (!cancelled) setResyncing(false) },
      )
    }
    sync()
    const timer = setInterval(sync, RUNNING_RESYNC_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [mux])

  // Roster baseline: running sessions + display titles, once per page open.
  // 列表是分页拉的，而且宿主冷枚举一次要十几秒；只等最后一页会让"正在运行"
  // 区块跟着无关的历史一起空着。每页落地就先渲染，后面的页继续补齐。
  useEffect(() => {
    let cancelled = false
    const accumulated = new Map<string, RosterRow>()
    const apply = (rows: readonly RosterRow[]): void => {
      if (cancelled) return
      for (const row of rows) accumulated.set(row.sessionId, row)
      const running = new Set(liveRef.current)
      for (const row of accumulated.values()) {
        // Seed the running set from the roster unless a live frame already
        // decided otherwise (a turn/end may have cleared a just-finished one).
        if (row.running === true && !row.blank) running.add(row.sessionId)
      }
      liveRef.current = running
      setRoster(new Map(accumulated))
      setLiveSessions(running)
    }
    void fetchRoster(apply).then(
      () => { if (!cancelled && accumulated.size === 0) setLiveSessions(new Set(liveRef.current)) },
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
        return
      }
      if (frame.type === 'session/projection' && frame.key === 'title') {
        const sessionId = String(frame.sessionId)
        const title: unknown = frame.value
        if (typeof title === 'string' && title !== '') {
          setLiveTitles(previous => new Map(previous).set(sessionId, title))
        }
      }
    }
    const unsubscribe = mux.onFrame(onFrame)
    setSnapshot(mux.jobsSnapshot())
    return unsubscribe
  }, [mux])

  const rows = buildRows(snapshot, roster, liveSessions, liveTitles)

  // Foreground subagents: asked for the running sessions only, while this page
  // is mounted. One `subagent.list` per live session per tick (bounded by
  // SUBAGENT_SESSION_MAX); the effect restarts whenever the live set changes,
  // so a session that starts or stops mid-view is picked up — and a page with
  // nothing running makes no request at all.
  const pollSessionIds = rows.filter(row => row.live).map(row => row.sessionId).slice(0, SUBAGENT_SESSION_MAX)
  const pollKey = pollSessionIds.join('|')
  useEffect(() => {
    if (pollKey === '') return
    const ids = pollKey.split('|')
    let cancelled = false
    const load = (): void => {
      for (const id of ids) {
        void fetchSubagents(id).then(
          (nodes) => {
            if (cancelled || nodes === undefined) return
            setChildrenBySession(previous => new Map(previous).set(id, nodes))
          },
        )
      }
    }
    load()
    const timer = setInterval(load, SUBAGENT_POLL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [pollKey])

  // 卡片第二三行：每个在跑会话读一页尾页，推"在干什么 / 第几步 / 已跑 / 最近活动"。
  // 只在有会话在跑时轮询；页面关掉就停。
  const detailIds = rows.filter(row => row.live).map(row => row.sessionId).slice(0, DETAIL_SESSION_MAX)
  const detailKey = detailIds.join('|')
  useEffect(() => {
    if (detailKey === '') return
    const ids = detailKey.split('|')
    let cancelled = false
    const load = (): void => {
      for (const id of ids) {
        void logTail(id, 25).then(
          (page) => {
            if (cancelled) return
            const detail = runDetailFromPage(page)
            setDetails(previous => new Map(previous).set(id, detail))
          },
          () => { /* 尾页读失败就保持上一次的卡片信息，别把界面清空 */ },
        )
      }
    }
    load()
    const timer = setInterval(load, DETAIL_POLL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [detailKey])

  const runningSubagentCount = pollSessionIds.reduce(
    (sum, id) => sum + runningSubagents(childrenBySession.get(id) ?? []).length,
    0,
  )
  // 子会话自己也会 emit turn/start，于是它也进了运行集合；但它已经以"子代理行"的身份
  // 挂在父卡片下面，再单独占一张卡就是同一个东西出现两次（真机看到的就是
  // "会话 632d7f42"这种没标题的卡）。
  const childSessionIds = (() => {
    const ids = new Set<string>()
    for (const nodes of childrenBySession.values()) {
      for (const node of nodes) ids.add(node.id)
    }
    return ids
  })()
  const liveCount = rows.reduce((sum, row) => sum + row.jobs.filter(job => isLive(job)).length, 0)
  const liveRows = rows.filter(row => row.live
    && !childSessionIds.has(row.sessionId)
    // 尾页说这一轮收工了（最后一条边界就是 turn/end）就退场：花名册那一行经常
    // 还在说 running=true，光信它会留下一张"跑完了还在数秒"的卡（真机现场）。
    && details.get(row.sessionId)?.turnOpen !== false)
  const runningSessionCount = liveRows.length
  // "正在运行"之外的那些会话：刚从上面退场的，也该出现在下面"刚结束"里。
  const effectiveLive = new Set(liveRows.map(row => row.sessionId))
  const visibleFinished = finished.filter(entry => !effectiveLive.has(entry.sessionId))
  // 心跳：卡片上的"已跑"要每秒走；「刚结束」那几行的"X 分钟前"同样要走，
  // 所以不能只在"有会话在跑"时才跑心跳（真机：全部都跑完后时间冻在 19 秒前）。
  const now = useNowGauge(liveRows.length > 0 || visibleFinished.length > 0)
  // 收工账本：谁上一步还在"正在运行"里、现在不在了，就把它的标题/用时/摘要记进
  // 「刚结束」——这样"全部跑完"时页面不会是空的（真机反馈：跑完了，运行中页一片空白）。
  // 已记过的按"会话 + 这一轮起点"记一次，避免每次渲染都重记一遍。
  const recordedRef = useRef<Set<string>>(new Set())
  const prevLiveRef = useRef<Map<string, RunDetail>>(new Map())
  useEffect(() => {
    const current = new Map<string, RunDetail>()
    for (const row of liveRows) {
      const detail = details.get(row.sessionId)
      if (detail !== undefined) current.set(row.sessionId, detail)
    }
    const titleOfId = (sessionId: string): string => {
      const hit = rows.find(candidate => candidate.sessionId === sessionId)
      return hit?.title ?? `会话 ${shortSessionId(sessionId)}`
    }
    for (const [sessionId, detail] of prevLiveRef.current) {
      if (current.has(sessionId)) continue
      // 子代理是"从属行"，不是独立会话：它从列表里消失只是因为它被认出来了，
      // 别把它记成"刚结束的会话"。
      if (childSessionIds.has(sessionId)) continue
      const key = `${sessionId}@${detail.turnStartAt ?? 0}`
      if (recordedRef.current.has(key)) continue
      recordedRef.current.add(key)
      // 用时：优先用收工定格的那个值；尾页还没刷出定格时，用锚点与最新事件时间补算，
      // 免得「刚结束」那一行只剩"已完成 · 19 秒前"、看不到跑了多久。
      const durationMs = detail.durationMs
        ?? (detail.turnStartAt !== undefined && detail.lastEventAt !== undefined
          ? Math.max(0, detail.lastEventAt - detail.turnStartAt)
          : undefined)
      recordFinishedRun({
        sessionId,
        title: titleOfId(sessionId),
        finishedAt: detail.lastEventAt ?? Date.now(),
        status: detail.status ?? 'done',
        ...(durationMs === undefined ? {} : { durationMs }),
        ...(detail.summary === undefined ? {} : { summary: detail.summary }),
      })
    }
    prevLiveRef.current = current
  }, [liveRows, details, rows, finished, childSessionIds])

  // 账本里那条如果是"会话 xxxxx"这种兜底标题（收工那一刻花名册还没答上来），
  // 等标题到位了就把它补成真标题 —— 别让"刚结束"里留一条看不懂的记录。
  useEffect(() => {
    for (const entry of finished) {
      if (!entry.title.startsWith('会话 ')) continue
      const better = roster.get(entry.sessionId)?.title ?? liveTitles.get(entry.sessionId)
      if (better === undefined || better === '') continue
      recordFinishedRun({ ...entry, title: better })
    }
  }, [finished, roster, liveTitles])

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
        {/* 向宿主校准的那一下：顶部 2px 细条。卡片内容会静悄悄换，没这个像 bug。 */}
        {resyncing && <div className="runov-sync-bar" role="progressbar" aria-label="正在校准" />}
        {rows.length === 0 && visibleFinished.length === 0 && (
          <div className="mobile-empty" style={{ paddingTop: 28 }}>
            <div className="empty-icon"><InboxIcon /></div>
            <p className="empty-title">当前没有运行中的会话或任务</p>
            <p className="empty-desc">会话输出、子代理委派、命令运行会实时显示在这里</p>
          </div>
        )}
        {(rows.length > 0 || visibleFinished.length > 0) && (
        <div className="runov-scroll">
            {liveRows.length > 0 ? (
              <div className="runov-group-title">
                正在运行
                <span className="runov-group-cnt">
                  {runningSessionCount} 个会话
                  {runningSubagentCount > 0 ? ` · ${runningSubagentCount} 个子代理` : ''}
                  {liveCount > 0 ? ` · ${liveCount} 个后台任务` : ''}
                </span>
              </div>
            ) : (
              <div className="runov-empty-note">
                当前没有会话在运行{visibleFinished.length > 0 ? `，下面是刚结束的 ${visibleFinished.length} 个` : ''}。
              </div>
            )}

            {liveRows.map(row => (
              <SessionCard
                key={row.sessionId}
                row={row}
                detail={details.get(row.sessionId)}
                children={childrenBySession.get(row.sessionId)}
                now={now}
                onOpenSession={() => { onOpenSession({ sessionId: row.sessionId, title: row.title }) }}
                onOpenSubagent={onOpenSubagent}
              />
            ))}

            {visibleFinished.length > 0 && (
              <>
                <div className="runov-group-title">
                  刚结束
                  <span className="runov-group-cnt">{visibleFinished.length}</span>
                  <button type="button" className="runov-group-action" onClick={() => { clearFinishedRuns() }}>
                    全部清空
                  </button>
                </div>
                <div className="runov-finish">
                  {visibleFinished.map(entry => (
                    <FinishedRow
                      key={`${entry.sessionId}-${entry.finishedAt}`}
                      entry={entry}
                      now={now}
                      onOpen={() => { onOpenSession({ sessionId: entry.sessionId, title: entry.title }) }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** 状态图标：完成/出错/中断，和过程条用同一套语义。 */
export function StatusGlyph({ status }: { status: FinishedRun['status'] }) {
  if (status === 'error') {
    return (
      <span className="rf-ic rf-ic-bad" aria-hidden>
        <svg viewBox="0 0 16 16" width="13" height="13">
          <path d="M8 2.2 14.6 13.4H1.4L8 2.2Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M8 6.4v3.2M8 11.6v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
    )
  }
  if (status === 'stopped') {
    return (
      <span className="rf-ic rf-ic-stop" aria-hidden>
        <svg viewBox="0 0 16 16" width="13" height="13">
          <rect x="4" y="4" width="8" height="8" rx="1.4" fill="currentColor" />
        </svg>
      </span>
    )
  }
  return (
    <span className="rf-ic rf-ic-ok" aria-hidden>
      <svg viewBox="0 0 16 16" width="13" height="13">
        <path d="M13.3 4.3 6.6 11 2.7 7.1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

const STATUS_TEXT: Record<FinishedRun['status'], string> = {
  done: '已完成',
  error: '出错退出',
  stopped: '已中断',
}

/** 刚结束的一行：状态 + 用时 + 多久以前。 */
function FinishedRow({ entry, now, onOpen }: {
  entry: FinishedRun
  now: number
  onOpen(): void
}) {
  return (
    <button type="button" className="rf-row" onClick={onOpen}>
      <StatusGlyph status={entry.status} />
      <span className="rf-body">
        <span className="rf-title">{entry.title}</span>
        <span className="rf-meta">
          <span>{STATUS_TEXT[entry.status]}</span>
          {entry.durationMs !== undefined && <span className="sep">·</span>}
          {entry.durationMs !== undefined && <span className="rf-dur">{formatRunDuration(entry.durationMs)}</span>}
          <span className="sep">·</span>
          <span>{formatAgo(now, entry.finishedAt)}</span>
        </span>
      </span>
      <span className="rf-chev" aria-hidden>›</span>
    </button>
  )
}

/** One session card: title head + its "what is happening" lines + task rows. */
function SessionCard({ row, detail, children, now, onOpenSession, onOpenSubagent }: {
  row: SessionRun
  detail?: RunDetail | undefined
  children?: readonly SubagentFlatNode[] | undefined
  now: number
  onOpenSession(): void
  onOpenSubagent?: ((hit: { sessionId: string; label?: string; parentTitle?: string }) => void) | undefined
}) {
  const [showAllSubagents, setShowAllSubagents] = useState(false)
  const [showJobs, setShowJobs] = useState(false)
  const allChildren = row.live ? sortSubagentsRunningFirst(children ?? []) : []
  const hiddenChildren = Math.max(0, allChildren.length - SUBAGENT_VISIBLE_MAX)
  const visibleChildren = showAllSubagents || hiddenChildren === 0
    ? allChildren
    : allChildren.slice(0, SUBAGENT_VISIBLE_MAX)
  // A live subagent delegation is already named by the 子代理 rows, so its job
  // row would be the same thing twice.
  const liveJobs = row.jobs.filter(job => isLive(job))
  const liveSubagentJobs = liveJobs.filter(job => job.kind === 'subagent')
  const hideSubagentJobs = allChildren.length > 0 && allChildren.length >= liveSubagentJobs.length
  const shownLiveJobs = hideSubagentJobs ? liveJobs.filter(job => job.kind !== 'subagent') : liveJobs
  const elapsed = detail?.turnStartAt === undefined ? undefined : formatRunDuration(now - detail.turnStartAt)
  const stale = detail?.lastEventAt !== undefined && now - detail.lastEventAt > RUN_STALE_MS
  const agentCount = allChildren.length

  return (
    <div className="runov-sess">
      <button type="button" className="runov-sess-head" onClick={onOpenSession}>
        <span className="rs-glyph">
          <span className={stale ? 'rs-dot rs-dot-stale' : 'rs-dot'} aria-hidden />
        </span>
        <span className="rs-body">
          <span className="rs-title">{row.title}</span>
          <span className="rs-meta">
            <span className="rs-action">{detail?.action ?? '等待输出'}</span>
            {detail?.actionHint !== undefined && (
              <>
                <span className="sep">·</span>
                <span className="rs-cmd">{detail.actionHint}</span>
              </>
            )}
            {detail?.step !== undefined && (
              <>
                <span className="sep">·</span>
                <span>第 {detail.step} 步</span>
              </>
            )}
            {elapsed !== undefined && (
              <>
                <span className="sep">·</span>
                <span className="rs-elapsed">已跑 {elapsed}</span>
              </>
            )}
          </span>
          <span className="rs-sub">
            {row.workspace !== undefined && <span>{row.workspace}</span>}
            {row.workspace !== undefined && detail?.lastEventAt !== undefined && <span className="sep">·</span>}
            {detail?.lastEventAt !== undefined && (
              stale
                ? <span className="rs-stale">{formatAgo(now, detail.lastEventAt)}有活动</span>
                : <span>{formatAgo(now, detail.lastEventAt)}有活动</span>
            )}
            {agentCount > 0 && (
              <>
                <span className="sep">·</span>
                <span className="rs-agents-count">{agentCount} 个子代理</span>
              </>
            )}
          </span>
        </span>
        <span className="rs-chev" aria-hidden>›</span>
      </button>

      {visibleChildren.length > 0 && (
        <div className="rs-agents">
          <div className="rs-agents-inner" role="list" aria-label={`${row.title} 的子代理`}>
            {visibleChildren.map(node => {
              // 打不开时渲染成纯展示行：一个 disabled 的按钮看起来像「坏了」，
              // 而它其实只是这条子代理没有可打开的会话（2026-10-29 排查同批问题）。
              const openable = onOpenSubagent !== undefined
              const Row = openable ? 'button' : 'div'
              return (
              <Row
                key={node.id}
                {...(openable ? { type: 'button' as const } : {})}
                className="rs-agent"
                onClick={openable ? () => { onOpenSubagent?.({ sessionId: node.id, label: node.label, parentTitle: row.title }) } : undefined}
              >
                <span className={node.activity === 'running' ? 'rs-agent-dot' : 'rs-agent-dot rs-agent-dot-idle'} aria-hidden />
                <span className="rs-agent-label">{node.label}</span>
                {node.turnStartAt !== undefined && node.activity === 'running' && (
                  <span className="rs-agent-dur">{formatRunDuration(now - node.turnStartAt)}</span>
                )}
                {node.activity !== 'running' && node.lastEventAt !== undefined && (
                  <span className="rs-agent-dur">{formatAgo(now, node.lastEventAt)}</span>
                )}
                {openable && <span className="rs-agent-chev" aria-hidden>›</span>}
              </Row>
              )
            })}
          </div>
        </div>
      )}
      {hiddenChildren > 0 && (
        <button
          type="button"
          className="rs-more"
          aria-expanded={showAllSubagents}
          onClick={() => { setShowAllSubagents(value => !value) }}
        >
          <span>{showAllSubagents ? '收起子代理' : `还有 ${hiddenChildren} 个子代理`}</span>
          <span className="rs-more-chev" aria-hidden>{showAllSubagents ? '▾' : '▸'}</span>
        </button>
      )}

      {shownLiveJobs.length > 0 && (showJobs ? (
        <div className="runov-jobs" role="list" aria-label={`${row.title} 的后台任务`}>
          {shownLiveJobs.map(job => <TaskRow key={job.id} job={job} />)}
        </div>
      ) : (
        <button type="button" className="rs-more" aria-expanded={false} onClick={() => { setShowJobs(true) }}>
          <span>另有 {shownLiveJobs.length} 个后台任务</span>
          <span className="rs-more-chev" aria-hidden>›</span>
        </button>
      ))}

      {row.live && detail === undefined && (
        <div className="rs-sub rs-sub-quiet">正在读取这一轮的进度…</div>
      )}
    </div>
  )
}
