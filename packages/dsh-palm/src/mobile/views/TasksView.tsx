/**
 * 「任务」页（2026-11-11 落地）：把「进行中」和「刚完成」的会话收进一屏。
 *
 * 用户的抱怨是：以前能在一个界面看全哪些在跑、哪些刚跑完，现在只能靠抽屉里那行小状态条
 * 一个个翻 —— 而且「刚完成」十分钟后就混进普通会话，看不出哪些是刚才跑完的。
 *
 * 数据全是现成的，这个页面不改宿主：
 * - `mobile.runningSessions` → 在跑的会话 id（没有开始时间，所以只写「运行中」，不编秒数）；
 * - `mobile.finishedRuns({op:'read'})` → 标题 / 结束时间 / 结果 / 耗时；
 * - `session.list` → 把 id 换成会话标题与工作区。
 *
 * @module dsh-palm/mobile/views/TasksView
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { HostFinishedRun } from '../mobile-types.ts'
import { cwdTail, toSessionView, type SessionView } from '../shared/session-view.ts'
import { loadCwdIndex, loadTaskFeed } from '../session/task-feed.ts'
import { clearHostFinishedRuns, fetchFinishedRuns } from '../data/usage.ts'
import { errorText } from '../shared/error-text.ts'
import { settingsLayout } from '../layouts/screens.ts'
import { SlotLayout } from '../ui/slot-layout.tsx'
import { Button, IconButton } from '../ui/primitives.tsx'
import { EmptyState } from '../ui/empty-state.tsx'
import { RowsIcon } from '../components/icons.tsx'

/** 进行中轮询间隔：足够看到「开跑 / 跑完」，又不至于一直打宿主。 */
const POLL_MS = 5_000
/** 「刚完成」保留的窗口：一天。再早的属于历史，去抽屉里翻。 */
const FRESH_MS = 86_400_000

/**
 * 没有标题的会话（宿主没给 title，或者那条记录本来就没存）：用 id 的尾巴顶上。
 *
 * @param sessionId - 会话 id
 * @returns 8 个字符以内的短标识
 */
function shortId(sessionId: string): string {
  return sessionId.replace(/^session-/, '').slice(0, 8)
}

export interface TasksViewProps {
  /** 返回上一页。 */
  onBack(): void
  /** 点某一行：回到那个会话。 */
  onOpen(session: SessionView): void
}

/** 一条任务的完整样子（进行中与刚完成共用一个渲染）。 */
interface TaskRow {
  sessionId: string
  title: string
  /** 一句话状态：`运行中` / `完成 · 1 分 30 秒` / `出错 · 40 秒`。 */
  status: string
  /**
   * 会话所属工作目录的名字（`dsh-palm` / `ICNT9388`）。
   *
   * 任务页把所有工作区在跑的会话聚在一屏，没有这一格就分不清"这是哪个项目的活"
   * —— 两个陌生标题挨着排，用户点进去之前完全不知道要去哪儿。
   */
  where?: string
  running: boolean
}

/**
 * 毫秒 → 「1 分 30 秒」；不足 1 秒写「不到 1 秒」。
 *
 * @param ms - 耗时（毫秒）
 * @returns 短文本
 */
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 1) return '不到 1 秒'
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes === 0) return `${seconds} 秒`
  return seconds === 0 ? `${minutes} 分` : `${minutes} 分 ${seconds} 秒`
}

/**
 * 结束结果翻成中文。
 *
 * @param status - 宿主给的 done / error / stopped
 * @returns 一个词
 */
function statusWord(status: HostFinishedRun['status']): string {
  if (status === 'error') return '出错'
  if (status === 'stopped') return '中止'
  return '完成'
}

/**
 * 渲染任务页。
 *
 * @param props - 返回 / 打开会话 / 新建
 * @returns 页面
 */
export function TasksView(props: TasksViewProps) {
  const [running, setRunning] = useState<SessionView[]>([])
  const [done, setDone] = useState<HostFinishedRun[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  /**
   * 会话 id → 工作目录。
   *
   * 进行中的行自带 cwd；「刚完成」只有 id（收工账本不带 cwd），得回查 session.list。
   * 用 ref 而不是 state：查过一次就该一直复用，轮询时不必再翻页，也不需要额外一次重渲染。
   */
  const cwdCache = useRef(new Map<string, string>())

  /** 拉一次：在跑的 id + 刚完成的记录 + 会话标题。 */
  const load = useCallback(async (): Promise<void> => {
    try {
      // 三个请求**并行**发：串行要等最慢那个的两倍时间，真机上就是一直停在「正在读任务…」。
      const [feed, finished] = await Promise.all([
        loadTaskFeed(),
        fetchFinishedRuns().catch(() => [] as HostFinishedRun[]),
      ])
      const page = feed.sessions
      const runningIds = feed.running
      // 宿主的 `session.list` 回分页对象（items 是 SessionSummary），标题藏在 projections 里：
      // 用 toSessionView 统一转成前端那套（标题优先 projections.title，退回 cwd 尾巴）。
      const sessionRows: SessionView[] = Array.isArray(page)
        ? page
        : (page.items ?? []).map(item => toSessionView(item as Parameters<typeof toSessionView>[0]))
      const byId = new Map(sessionRows.map(session => [session.sessionId, session]))
      const ids = new Set(runningIds.sessionIds)
      // 运行中的会话可能还没进 session.list（刚新建）：标题退回 id，至少能点进去。
      const live = runningIds.sessionIds.map(id => byId.get(id) ?? {
        sessionId: id, title: id, updatedAt: 0, running: true, blank: false,
      })
      // 首页带 cwd 的行直接进缓存；账本里那些不在首页的 id 补一次翻页索引（只补缺的）。
      for (const session of sessionRows) {
        if (session.cwd !== undefined && session.cwd !== '') cwdCache.current.set(session.sessionId, session.cwd)
      }
      const missing = finished
        .map(run => String(run.sessionId))
        .filter(id => !cwdCache.current.has(id))
      if (missing.length > 0) {
        const extra = await loadCwdIndex(missing).catch(() => new Map<string, string>())
        for (const [id, cwd] of extra) cwdCache.current.set(id, cwd)
      }
      setRunning(live)
      // 已经结束的不再算「进行中」（宿主两边都记着的时候以 running 为准）。
      // 只留最近一天、按结束时间倒序：宿主的 finishedRuns 是累积文件，不筛会把半年前的也铺出来。
      setDone(finished
        .filter(run => !ids.has(run.sessionId))
        .filter(run => Number.isFinite(run.finishedAt) && Date.now() - run.finishedAt < FRESH_MS)
        .sort((a, b) => b.finishedAt - a.finishedAt))
      setError(undefined)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { void load() }, POLL_MS)
    return () => { window.clearInterval(timer) }
  }, [load])

  /** 清空「刚完成」的记录（只清这张表，不动会话）。 */
  const clearDone = (): void => {
    if (busy) return
    setBusy(true)
    void clearHostFinishedRuns().then(
      () => { setDone([]); setBusy(false) },
      (reason: unknown) => { setBusy(false); setError(errorText(reason)) },
    )
  }

  /** 进行中在前、刚完成按结束时间倒序。 */
  const rows: TaskRow[] = [
    ...running.map(session => ({ sessionId: session.sessionId, title: session.title, status: '运行中', where: cwdTail(session.cwd), running: true })),
    ...done.map(run => ({
      sessionId: run.sessionId,
      title: run.title.trim() === '' ? shortId(run.sessionId) : run.title,
      status: `${statusWord(run.status)}${run.durationMs === undefined ? '' : ` · ${formatDuration(run.durationMs)}`}`,
      where: cwdTail(cwdCache.current.get(run.sessionId)),
      running: false,
    })),
  ]
  const byId = new Map([...running, ...done.map(run => ({ sessionId: run.sessionId, title: run.title }))].map(item => [item.sessionId, item]))

  return (
    <SlotLayout
      spec={settingsLayout}
      className="tasks-page"
      slots={{
        header: (
          <header className="mobile-header">
            <div className="mobile-headerSlot">
              <IconButton label="返回" className="mobile-back" onClick={props.onBack}>‹</IconButton>
            </div>
            <h1 className="mobile-title">任务</h1>
            <div className="mobile-headerSlot mobile-headerSlot-right" />
          </header>
        ),
        groups: (
          <div className="tasks-page-body">
            {!loaded && error === undefined ? (
              <p className="settings-note" aria-busy="true">
                <span className="settings-skeleton" aria-hidden />
                正在读任务…
              </p>
            ) : null}
            {error !== undefined ? <p className="settings-note">读取任务失败：{error}</p> : null}
            {loaded && rows.length === 0 ? (
              <EmptyState
                icon={<RowsIcon />}
                title="现在没有在跑的任务"
                hint="发起一次对话后，正在跑和刚跑完的会话都会出现在这里。"
              />
            ) : null}
            {running.length > 0 ? (
              <section className="tasks-group" aria-label="进行中">
                <h2 className="tasks-group-head">进行中 {running.length}</h2>
                <ul className="tasks-list">
                  {rows.filter(row => row.running).map(row => (
                    <li key={row.sessionId}>
                      <Button
                        className="tasks-row"
                        onClick={() => {
                          const session = byId.get(row.sessionId)
                          if (session !== undefined) props.onOpen(session as SessionView)
                        }}
                      >
                        <span className="tasks-dot tasks-dot-live" aria-hidden />
                        <span className="tasks-title">{row.title}</span>
                        {row.where === undefined ? null : <span className="tasks-where">{row.where}</span>}
                        <span className="tasks-meta">{row.status}</span>
                        <span className="tasks-chev" aria-hidden>›</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {done.length > 0 ? (
              <section className="tasks-group" aria-label="刚完成">
                <h2 className="tasks-group-head">刚完成 {done.length}</h2>
                <ul className="tasks-list">
                  {rows.filter(row => !row.running).map(row => (
                    <li key={row.sessionId}>
                      <Button
                        className="tasks-row"
                        onClick={() => {
                          const session = byId.get(row.sessionId)
                          if (session !== undefined) props.onOpen(session as SessionView)
                        }}
                      >
                        <span className="tasks-dot" aria-hidden />
                        <span className="tasks-title">{row.title}</span>
                        {row.where === undefined ? null : <span className="tasks-where">{row.where}</span>}
                        <span className="tasks-meta">{row.status}</span>
                        <span className="tasks-chev" aria-hidden>›</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {done.length > 0 ? (
              <div className="tasks-actions">
                {/* 只留「清除已完成」：任务页是**看**状态的地方，「新建会话」是抽屉第一行
                    那件蓝按钮的活（2026-11-11 用户问「为什么会有新建会话按钮」—— 确实多余）。 */}
                <Button
                  type="button"
                  className="tasks-clear"
                  disabled={busy}
                  onClick={clearDone}
                >{busy ? '清除中…' : '清除已完成'}</Button>
              </div>
            ) : null}
          </div>
        ),
      }}
    />
  )
}
