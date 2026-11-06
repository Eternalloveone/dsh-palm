/**
 * Pure helpers behind {@link SessionListView}: the paged-row filter, the live
 * mux deltas and the roster's day buckets. Every hook and side effect stays in
 * the view — this module is plain data in, plain data out.
 */

import type { MuxFrame, SessionSummary, WorkspaceView as WorkspaceRow } from '../../../api-proxy-types'
import type { MuxClient } from '../../mux.ts'
import { toSessionView, type SessionView } from '../../shared/session-view.ts'
import { resolveSessionRunning } from '../../shared/session-state.ts'

/** Rows shown for the opened workspace: its sessions, paged. The roster
 * filters by the workspace's OWNED id set (workspace.sessionIds) — the same
 * attach relationship the desktop GUI uses — so sessions created without a
 * workspace attach (standalone sessions) never appear here, keeping the
 * phone and desktop rosters identical. */
export function pageItems(page: SessionSummary[], ownedIds: ReadonlySet<string>): SessionView[] {
  return page
    .filter(item => ownedIds.has(String(item.sessionId)))
    .map(item => toSessionView(item))
}

/**
 * Live session-list deltas, mirrored from the host's `api-session/*` events
 * (see `session/added` … in the mux frame union). The fetched page stays the
 * baseline; these patch it until the next fetch — without them the roster only
 * moves when `sessions.list` is called again, so a session the desktop just
 * created, finished or deleted would sit stale on the phone.
 */
export interface LiveListState {
  added: Map<string, SessionView>
  status: Map<string, boolean>
  /** 每条 status 是 mux 帧什么时候写下的。宿主那份运行集合自带 30 秒缓存，
   *  比刚到的帧还旧；没有这个时间戳，一次核对就会把刚亮的绿点抹掉。 */
  statusAt: Map<string, number>
  /** 最近一次被**宿主运行集合 / 尾页边界**确认为"在跑"的时刻。
   *
   *  mux 只推**当前打开会话**的事件；一个正在等子代理搬砖的父会话可以十几分钟
   *  没有任何帧，绿点就按 5 分钟的静默规则灭了（真机 2026-11-04）。
   *  宿主的一次确认应当像一帧活动一样给它续命。 */
  confirmedAt: Map<string, number>
  /**
   * 宿主 `mobile.runningSessions` 的**最近一次答复**（会话 → 在跑？）。
   *
   * 桌面端的绿点就是这么来的：`running: ctx.agents.get(id)?.status === 'running'`
   * （dsh `packages/api/session-controller/src/list.ts`）。手机端以前靠"帧 + 尾页边界 +
   * 5 分钟静默"自己推断，两个方向都会错：
   *  - 父会话等子代理时十几分钟没有事件 ⇒ 被静默规则误判成已结束（绿点灭）；
   *  - 老的、边界一直开着的会话 ⇒ 尾页核实永远"在跑"（绿点长亮，实测 9 月的会话还亮着）。
   * 有了这份快照，绿点只回答一个问题：**宿主说它在跑吗。**
   */
  host: Map<string, boolean>
  activity: Map<string, number>
  error: Map<string, string>
  removed: Set<string>
}

export function emptyLiveState(): LiveListState {
  return {
    added: new Map(), status: new Map(), statusAt: new Map(), confirmedAt: new Map(),
    host: new Map(),
    activity: new Map(), error: new Map(), removed: new Set(),
  }
}

/** Whether a `session/added` summary belongs to the workspace on screen. The
 *  roster filter is the workspace's owned id set, which predates a session
 *  created after this list mounted — its cwd decides that case. */
export function belongsToWorkspace(summary: SessionSummary, workspace: WorkspaceRow): boolean {
  if (workspace.sessionIds.includes(summary.sessionId)) return true
  return summary.cwd !== undefined && summary.cwd === workspace.path
}

/** Fold one mux frame into the live deltas; false when it is not a list frame. */
export function applyListFrame(live: LiveListState, frame: MuxFrame, workspace: WorkspaceRow): boolean {
  switch (frame.type) {
    case 'session/added': {
      const summary = frame.summary
      if (summary === null || typeof summary !== 'object') return false
      const id = String(summary.sessionId)
      if (!belongsToWorkspace(summary, workspace)) return false
      live.added.set(id, toSessionView(summary))
      live.removed.delete(id)
      return true
    }
    case 'session/removed': {
      const id = String(frame.sessionId)
      live.added.delete(id)
      live.status.delete(id)
      live.activity.delete(id)
      live.error.delete(id)
      live.removed.add(id)
      return true
    }
    // The host bus publishes `session/status`; the plugin's own turn-boundary
    // inference publishes `session/turn-boundary` (same payload, different
    // source). Both move the same badge — the split exists so a client can
    // arbitrate by source instead of seeing two "status" frames fight.
    case 'session/status':
    case 'session/turn-boundary': {
      const id = String(frame.sessionId)
      live.status.set(id, frame.running)
      live.statusAt.set(id, Date.now())
      // A session that runs again has moved past its failure.
      if (frame.running) live.error.delete(id)
      return true
    }
    case 'session/activity': {
      const id = String(frame.sessionId)
      live.activity.set(id, frame.updatedAt)
      // 有动静就说明它真的还在跑：给那条"在跑"的标记续命，否则静默一阵子
      // 就会被上面的过期判断误杀。
      if (live.status.get(id) === true) live.statusAt.set(id, Date.now())
      return true
    }
    case 'session/error': {
      live.error.set(String(frame.sessionId), frame.message)
      return true
    }
    default:
      return false
  }
}

/** One row with its live status/activity/error patches applied. */
export function patchRow(row: SessionView, live: LiveListState, now = Date.now()): SessionView {
  const reported = live.status.get(row.sessionId)
  // 宿主有结论时它是唯一的答案（桌面端同源），不再让静默规则参与。
  const hostSaid = live.host.get(row.sessionId)
  // 一个"在跑"的标记必须有东西持续续命。宿主的结束帧丢了、宿主的核对要枚举
  // 几千个会话（冷启动实测 24 秒，手机上根本等不到），只靠这两样，绿点就会
  // 挂着不下来。跑了这么久还没有任何一条关于它的事件，就按没在跑处理。
  //
  // 续命的证据是**帧**，不是 row.updatedAt：那个字段是"最后一条消息的时间"，
  // 一轮跑五分钟它就停在开始处——拿它当心跳会把还在跑的会话误杀。真实的续命
  // 来自会话每推一次事件就刷新的 session/activity；没有活动帧时退回 status 帧
  // 的时间戳（宿主偶尔才发一次，所以它只是兜底，不是主判据）。
  const lastActivity = live.activity.get(row.sessionId)
  // 脉搏 = max(活动帧, status 帧, 宿主/尾页确认)。宿主确认过在跑的会话（比如正等
  // 子代理搬砖，十几分钟没有父会话事件）不会因为手机收不到帧就被判死。
  const confirmedAt = live.confirmedAt.get(row.sessionId) ?? 0
  const heartbeatAt = Math.max(lastActivity ?? 0, live.statusAt.get(row.sessionId) ?? 0, confirmedAt) || undefined
  const quiet = heartbeatAt !== undefined && now - heartbeatAt > RUNNING_STALE_MS
  const running = resolveSessionRunning({ hostSaid, reported, quiet })
  const updatedAt = live.activity.get(row.sessionId)
  const error = live.error.get(row.sessionId)
  // A session that runs again has moved past its failure. The mark may have
  // been baked into the row by an earlier patch, so clearing the delta alone
  // is not enough — this is where it gets dropped.
  const dropError = running === true && row.error !== undefined
  if (running === undefined && updatedAt === undefined && error === undefined && !dropError) return row
  const next: SessionView = { ...row }
  if (running !== undefined) next.running = running
  if (updatedAt !== undefined) next.updatedAt = updatedAt
  if (error !== undefined) next.error = error
  else if (dropError) delete next.error
  return next
}

/**
 * 恢复缓存时先剥掉绿点。
 *
 *  缓存里的 running=true 是"上次渲染时的结论"，不是证据：从列表点进会话、跑完、
 *  再回到列表，缓存里那一行还带着当时的 true，于是列表一挂载就把绿点画出来，等首页
 *  请求回来才被宿主的新数据改成「已完成」——用户看到的就是卡片先绿一小会，而且和
 *  "宿主的集合滞后"无关。恢复时只认这条 mux 连接当前还活着的那几个会话；真正还在
 *  跑的会在随后的首页、宿主核对或日志尾页核实里重新点亮。
 */
export function dropStaleRunning(rows: SessionView[], aliveIds: ReadonlySet<string>): SessionView[] {
  let touched = false
  const next = rows.map((row) => {
    if (row.running !== true || aliveIds.has(String(row.sessionId))) return row
    touched = true
    return { ...row, running: false }
  })
  return touched ? next : rows
}

/** 这条 mux 连接认为还在跑的会话 id。测试里的假 mux 可能没有这个方法。 */
export function muxRunningIds(mux: MuxClient | undefined): Set<string> {
  if (mux === undefined || typeof mux.runningSessionsSnapshot !== 'function') return new Set()
  return new Set(mux.runningSessionsSnapshot().map(String))
}

/** Apply the live deltas to a baseline page, keeping the host's order (the
 *  list is sorted by updatedAt desc — session-controller list.ts:142). */
export function applyLive(rows: SessionView[], live: LiveListState): SessionView[] {
  if (live.added.size === 0 && live.removed.size === 0 && live.status.size === 0
    && live.activity.size === 0 && live.error.size === 0 && live.host.size === 0) {
    return rows
  }
  const out: SessionView[] = []
  for (const row of rows) {
    if (live.removed.has(row.sessionId)) continue
    out.push(patchRow(row, live))
  }
  for (const [id, row] of live.added) {
    if (out.some(existing => existing.sessionId === id)) continue
    out.push(patchRow(row, live))
  }
  return out.sort((left, right) => right.updatedAt - left.updatedAt)
}

/** Which day bucket a session row falls into (list grouping). */
export type DayBucket = '置顶' | '今天' | '昨天' | '更早'

/** Bucket by the row's local calendar date. */
export function dayBucketFor(updatedAt: number, now = new Date()): DayBucket {
  const date = new Date(updatedAt)
  const day = (value: Date): number => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const today = day(now)
  if (day(date) === today) return '今天'
  if (day(date) === today - 86_400_000) return '昨天'
  return '更早'
}

export const DAY_BUCKETS: readonly DayBucket[] = ['今天', '昨天', '更早']

/** 一条「在跑」标记多久没有新活动就作废。宿主的结束帧并不可靠（实测一整轮
 *  零帧），宿主的核对要枚举几千个会话（冷启动实测 24 秒，手机上等不到），
 *  所以绿点还得有自己的心跳：跑着的会话会不断推 session/activity。
 *
 *  窗口必须长于「静默但还在跑」的最长工具：一次构建、一条长命令一分钟都不写事件，
 *  90 秒会把它们判死（用户看到绿点消失，以为跑完了）。5 分钟仍远快于宿主名单的刷新，
 *  又覆盖得住常见的静默工具调用。 */
export const RUNNING_STALE_MS = 5 * 60_000
