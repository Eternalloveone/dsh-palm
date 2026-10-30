/**
 * Sessions level: one workspace's sessions, loaded incrementally — the
 * first page fetches session.list with a cursor, scrolling appends further
 * pages (never the whole list at once). Rows are filtered to the opened
 * workspace by its owned session ids; extra pages are pulled on demand so
 * a workspace with many sessions converges without a full transfer.
 *
 * Creating a session is this level's other action: the workspace's id is
 * sent to session.create (the host attaches the new session to it), the
 * fresh row is prepended optimistically, and the user lands straight in
 * the new chat — the same "new session opens" flow as the desktop UI.
 *
 * UI (2026-08 refactor): compact agent-mode selector, a filled create
 * button, and the roster grouped by day (今天/昨天/更早) with a pulsing
 * status dot on running sessions; the raw session-id tail is gone.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react'
import type { WorkspaceView as WorkspaceRow } from '../../api-proxy-types'
import type { AgentPresetEntry } from '../../api-proxy-types'
import type { MuxFrame } from '../../api-proxy-types'
import type { SessionSummary } from '../../api-proxy-types'
import type { MuxClient } from '../mux.ts'
import { archiveSession, createSession, history, listAgentPresets, listSessions, listWorkspaces, logTail, previews, runningSessions } from '../api.ts'
import { errorText, formatFullTime, staleHostHint, toSessionView, type SessionView } from './App.tsx'
import { previewSummary } from '../ui-text.ts'
import { foldEvents, type WireEvent } from '../messages.ts'
import { removeOutboxForSession } from '../offline.ts'
import { toast } from '../toast.tsx'
import { ThemeToggle } from '../theme-toggle.tsx'
import { Sheet } from '../sheet.tsx'
import { ConfirmDialog } from '../dialog.tsx'
import {
  loadPersistedList,
  loadPersistedScroll,
  loadPersistedPreviews,
  loadPinnedSessions,
  maintainPersistedCaches,
  queuePersistedList,
  queuePersistedPreviews,
  savePersistedScroll,
  savePinnedSessions,
  sessionListCache,
} from '../list-persist.ts'
export { sessionListCache } from '../list-persist.ts'
import { ChatBubbleIcon, CheckIcon, ChevronUpIcon, HelpIcon } from '../icons.tsx'

/** Props for the session list. */
export interface SessionListViewProps {
  workspace: WorkspaceRow
  /** The live-event client, for the host's session-list frames. */
  mux?: MuxClient | undefined
  /** Session carried by a notification deep link; opened after the list loads. */
  initialSessionId?: string
  onBack(): void
  onPick(session: SessionView): void
  /** Open the mobile settings page (gear in the header). */
  onOpenSettings(): void
  /** Locate a session living in another workspace (in-app navigation). */
  onLocateSession?(sessionId: string, workspaceId: string, seq?: number, query?: string): void
  /** Open a session scrolled to one of its matched messages. */
  onPickSeq?(session: SessionView, seq: number, query?: string, messageId?: string, partId?: string): void
}

/** Rows shown for the opened workspace: its sessions, paged. The roster
 * filters by the workspace's OWNED id set (workspace.sessionIds) — the same
 * attach relationship the desktop GUI uses — so sessions created without a
 * workspace attach (standalone sessions) never appear here, keeping the
 * phone and desktop rosters identical. */
function pageItems(page: SessionSummary[], ownedIds: ReadonlySet<string>): SessionView[] {
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
interface LiveListState {
  added: Map<string, SessionView>
  status: Map<string, boolean>
  /** 每条 status 是 mux 帧什么时候写下的。宿主那份运行集合自带 30 秒缓存，
   *  比刚到的帧还旧；没有这个时间戳，一次核对就会把刚亮的绿点抹掉。 */
  statusAt: Map<string, number>
  activity: Map<string, number>
  error: Map<string, string>
  removed: Set<string>
}

function emptyLiveState(): LiveListState {
  return {
    added: new Map(), status: new Map(), statusAt: new Map(),
    activity: new Map(), error: new Map(), removed: new Set(),
  }
}

/** Whether a `session/added` summary belongs to the workspace on screen. The
 *  roster filter is the workspace's owned id set, which predates a session
 *  created after this list mounted — its cwd decides that case. */
function belongsToWorkspace(summary: SessionSummary, workspace: WorkspaceRow): boolean {
  if (workspace.sessionIds.includes(summary.sessionId)) return true
  return summary.cwd !== undefined && summary.cwd === workspace.path
}

/** Fold one mux frame into the live deltas; false when it is not a list frame. */
function applyListFrame(live: LiveListState, frame: MuxFrame, workspace: WorkspaceRow): boolean {
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
    case 'session/status': {
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
function patchRow(row: SessionView, live: LiveListState, now = Date.now()): SessionView {
  const reported = live.status.get(row.sessionId)
  // 一个"在跑"的标记必须有东西持续续命。宿主的结束帧丢了、宿主的核对要枚举
  // 几千个会话（冷启动实测 24 秒，手机上根本等不到），只靠这两样，绿点就会
  // 挂着不下来。跑了这么久还没有任何一条关于它的事件，就按没在跑处理。
  //
  // 续命的证据是**帧**，不是 row.updatedAt：那个字段是"最后一条消息的时间"，
  // 一轮跑五分钟它就停在开始处——拿它当心跳会把还在跑的会话误杀。真实的续命
  // 来自会话每推一次事件就刷新的 session/activity；没有活动帧时退回 status 帧
  // 的时间戳（宿主偶尔才发一次，所以它只是兜底，不是主判据）。
  const lastActivity = live.activity.get(row.sessionId)
  const heartbeatAt = lastActivity ?? live.statusAt.get(row.sessionId)
  const quiet = heartbeatAt !== undefined && now - heartbeatAt > RUNNING_STALE_MS
  const running = (reported === true && quiet) ? false : reported
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
function dropStaleRunning(rows: SessionView[], aliveIds: ReadonlySet<string>): SessionView[] {
  let touched = false
  const next = rows.map((row) => {
    if (row.running !== true || aliveIds.has(String(row.sessionId))) return row
    touched = true
    return { ...row, running: false }
  })
  return touched ? next : rows
}

/** 这条 mux 连接认为还在跑的会话 id。测试里的假 mux 可能没有这个方法。 */
function muxRunningIds(mux: MuxClient | undefined): Set<string> {
  if (mux === undefined || typeof mux.runningSessionsSnapshot !== 'function') return new Set()
  return new Set(mux.runningSessionsSnapshot().map(String))
}

/** Apply the live deltas to a baseline page, keeping the host's order (the
 *  list is sorted by updatedAt desc — session-controller list.ts:142). */
function applyLive(rows: SessionView[], live: LiveListState): SessionView[] {
  if (live.added.size === 0 && live.removed.size === 0 && live.status.size === 0
    && live.activity.size === 0 && live.error.size === 0) {
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
type DayBucket = '置顶' | '今天' | '昨天' | '更早'

/** Bucket by the row's local calendar date. */
export function dayBucketFor(updatedAt: number, now = new Date()): DayBucket {
  const date = new Date(updatedAt)
  const day = (value: Date): number => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const today = day(now)
  if (day(date) === today) return '今天'
  if (day(date) === today - 86_400_000) return '昨天'
  return '更早'
}

const DAY_BUCKETS: readonly DayBucket[] = ['今天', '昨天', '更早']

/** How many sessions get a lazily-fetched last-message preview. */
export const PREVIEW_FETCH_LIMIT = 12
/** Concurrent preview fetches (small pages; keep the tunnel quiet). */
const PREVIEW_CONCURRENCY = 3
/** Preview cache cap (oldest evicted past this). */
const PREVIEW_CACHE_LIMIT = 200
/** 向宿主核对「进行中」标记的最小间隔（宿主那份集合自带 30 s 缓存）。 */
export const RUNNING_RESYNC_MS = 30
/** 停留在列表页时的主动核对间隔（毫秒）：会话在跑但绿点不亮就是靠它收敛。 */
const RUNNING_POLL_MS = 5_000
/** 只有最近这么久内活跃过的行才值得花一次尾读去核实（更老的极不可能还在跑）。 */
const RUNNING_CANDIDATE_AGE_MS = 10 * 60_000_000
/** 一条「在跑」标记多久没有新活动就作废。宿主的结束帧并不可靠（实测一整轮
 *  零帧），宿主的核对要枚举几千个会话（冷启动实测 24 秒，手机上等不到），
 *  所以绿点还得有自己的心跳：跑着的会话会不断推 session/activity。
 *
 *  窗口必须长于「静默但还在跑」的最长工具：一次构建、一条长命令一分钟都不写事件，
 *  90 秒会把它们判死（用户看到绿点消失，以为跑完了）。5 分钟仍远快于宿主名单的刷新，
 *  又覆盖得住常见的静默工具调用。 */
export const RUNNING_STALE_MS = 5 * 60_000
/** Cooldown after a failed next-page load before the sentinel retries. */
const LOAD_MORE_BACKOFF_MS = 10_000

/** 首屏/分页请求的看门狗：请求本身没有超时，挂死的连接必须由界面自己解锁。 */
export const FIRST_PAGE_TIMEOUT_MS = 12_000

/**
 * 工作区列表的预算。它只用来算"哪些会话属于本工作区"（归属过滤），却可能极慢 ——
 * 主目录这类巨型工作区（本机 .dsh 下 57 万个文件）能慢到分钟级。给它一个短预算：
 * 超时就先用工作区自带的 sessionIds 渲染，绝不拖死首屏。
 */
const WORKSPACE_LIST_BUDGET_MS = 2_500

/** In-memory roster cache TTL (see list-persist.sessionListCache). */
const LIST_CACHE_TTL_MS = 60_000

/**
 * Rows at the tail that always render with real layout (no content-visibility)
 * in the session roster. The roster is a plain scrollable list; content-
 * visibility lets the browser skip layout/paint of off-screen rows (a big
 * workspace renders hundreds of light rows), but the bottom must stay exact
 * so the IntersectionObserver sentinel (and the manual 加载更多 button) stays
 * reachable. Keeping ~1 viewport real preserves that while the rows above
 * skip layout/paint.
 */
const SESSION_CV_KEEP_BOTTOM = 12

/** Horizontal swipe distance (px) that opens/closes the delete action. */
const SWIPE_TRIGGER_PX = 40

/** Cross-mount preview cache: summaries survive a chat round-trip too
 *  (exported for test isolation). Persisted for PWA cold starts. */
export const sessionPreviewCache = new Map<string, string>()

/** Seed caches once per page life: the persisted store covers PWA cold
 *  starts (memory caches are gone, localStorage survives). */
let persistedSeeded = false
function seedPersistedCaches(): void {
  if (persistedSeeded) return
  persistedSeeded = true
  if (sessionPreviewCache.size === 0) {
    for (const [sessionId, summary] of loadPersistedPreviews()) sessionPreviewCache.set(sessionId, summary)
  }
  maintainPersistedCaches()
}

/** Write-through helper: memory cache + persisted store in one step. */
function setCachedList(
  workspaceId: string,
  value: { rows: SessionView[]; cursor?: string; hasMore: boolean },
): void {
  sessionListCache.set(workspaceId, { ...value, at: Date.now() })
  // Deferred (list-persist): a roster page is a whole-blob rewrite, so it must
  // not run on the fetch/frame that produced it.
  queuePersistedList(workspaceId, value)
}

/** Publish the live preview map to the persisted store. Deferred and coalesced
 *  (list-persist): the map is one blob, and the page-hide hooks flush it. */
function syncPersistedPreviews(): void {
  queuePersistedPreviews(sessionPreviewCache)
}

/**
 * Pull the last-message preview for one session (best effort): fold the
 * history tail's FINAL message only (maxMessages=1 — one message's whole
 * event group, a few KB on the wire instead of the full 25-message tail
 * page, which over weak links is the list page's dominant transfer cost)
 * and summarize its text (or reasoning). Returns undefined on any failure —
 * the row falls back to its stats line.
 */
async function fetchPreview(sessionId: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const page = await history(sessionId, undefined, 1, signal)
    const rendered = foldEvents(page.events.map((entry: { event: WireEvent }) => entry.event))
    for (let i = rendered.length - 1; i >= 0; i--) {
      const message = rendered[i]
      if (message === undefined) continue
      const source = message.text !== '' ? message.text : message.reasoning ?? ''
      const summary = previewSummary(source)
      if (summary !== '') return summary
    }
    return undefined
  } catch {
    return undefined
  }
}

/** Run async jobs with a small concurrency cap (fetch order is irrelevant). */
async function mapLimited<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor]
      cursor += 1
      await run(item)
    }
  })
  await Promise.all(workers)
}

/**
 * Render one workspace's paged session list.
 * @param props - the workspace, back action, and pick action.
 * @returns the session list.
 */
export function SessionListView({ workspace, mux, initialSessionId, onBack, onPick, onOpenSettings, onLocateSession, onPickSeq }: SessionListViewProps) {
  const [rows, setRows] = useState<SessionView[]>([])
  /** rows 的镜像：resync 需要"当前有哪些行"，但读 state 会把它绑进依赖、频繁重建。 */
  const rowsRef = useRef<readonly SessionView[]>([])
  useEffect(() => { rowsRef.current = rows }, [rows])
  /** Live list deltas (see {@link applyListFrame}), patched onto every page. */
  const liveRef = useRef<LiveListState>(emptyLiveState())

  /** 用日志尾页核实一个"宿主说在跑"的会话。
   *
   *  宿主那份运行集合靠 session/status 帧维护，而真机上那条流几乎不发这类帧
   *  （260 秒监听只见到一条，没有一条 running=false），所以它的"在跑"会残留
   *  很久，绿点就挂着不下来。尾页是服务端折叠出来的（~20 ms），判据只认一件事：
   *  最后一条边界是不是 turn/start。**不拿"事件静默"当收工**：一条编译命令跑三分
   *  钟、一次大文件读写，这段时间日志里一行事件都没有，静默判据会把正在跑的会话
   *  判成已结束（真机上就这么丢过绿点）。读不到就保留宿主结论：宁可多亮一个，
   *  也不悄悄吞掉真实的一轮。 */
  const confirmRunning = useCallback((sessionId: string, live: LiveListState): void => {
    void logTail(sessionId).then(
      (page) => {
        if (!aliveRef.current) return
        const next = page.turnStartAt !== undefined
        if (live.status.get(sessionId) === next) return
        live.status.set(sessionId, next)
        live.statusAt.set(sessionId, Date.now())
        setRows(previous => applyLive(previous, live))
      },
      () => { /* 非致命：读不到尾页就保留宿主的判断 */ },
    )
  }, [])

  /** 首页/缓存到达时，把"宿主说在跑"的行先按没在跑处理，再逐条交给日志尾页核实。
   *
   *  页面上的 running 是宿主那一侧的结论：它的结束帧在真机上几乎不发、它自己的运行
   *  集合还带 30 秒缓存，所以刚跑完的会话很可能仍被标成在跑。以前这里直接把页面的
   *  true 画出来，用户从会话返回列表就会看到卡片先绿一小会、随后被新数据改回「已完成」。
   *  现在只有这条 mux 连接当前也认为在跑的（有活动帧/状态帧）才立刻点灯，其余一律
   *  等尾页核实。
   */
  const seedPageRows = useCallback((rows: SessionView[], live: LiveListState): SessionView[] => {
    const aliveIds = muxRunningIds(mux)
    const seeded = dropStaleRunning(rows, aliveIds)
    for (const row of rows) {
      const sessionId = String(row.sessionId)
      if (row.running === true && !aliveIds.has(sessionId)) confirmRunning(sessionId, live)
    }
    return seeded
  }, [confirmRunning, mux])

  /** 用宿主的运行集合校正列表里的「进行中」标记。
   *
   *  mux 只在会话状态**变化**时推 session/status；断线期间漏掉的那一帧永远
   *  不会重放，于是列表会一直标着一个早就结束的会话——真机上就是这样"桌面端
   *  没会话在跑，手机还显示运行中"。宿主这份集合是权威的，而且它自己带 30 s
   *  缓存，问一次很便宜。 */
  const resyncRunning = useCallback((): void => {
    void runningSessions().then(
      ({ sessionIds }) => {
        if (!aliveRef.current) return
        const host = new Set(sessionIds)
        const live = liveRef.current
        const now = Date.now()
        /** 刚由 mux 帧写下的状态更可信：宿主那份集合自带 30 秒缓存。 */
        const fresh = (id: string): boolean => {
          const writtenAt = live.statusAt.get(id)
          return writtenAt !== undefined && now - writtenAt < RUNNING_RESYNC_MS
        }
        let changed = false
        // 一、"宿主说没在跑"立刻落地。这个方向永远安全，也是手机上最常见的收敛：
        //     mux 的结束帧经常压根没到，全靠这一次核对把绿点熄掉。滚出屏幕的条目也
        //     要对齐，留下旧条目就是留下旧的绿点。
        for (const id of new Set([...live.status.keys(), ...host])) {
          if (host.has(id) || fresh(id)) continue
          if (live.status.get(id) === false) continue
          live.status.set(id, false)
          live.statusAt.set(id, now)
          changed = true
        }
        // 屏幕上的每一行都要有明确结论，不能只是"没被改过"：宿主说它没在跑，
        // 它就一定不亮，哪怕这一行的 running 字段还带着旧快照里的 true。
        setRows((previous) => {
          let touched = changed
          for (const row of previous) {
            const id = row.sessionId
            if (host.has(id) || fresh(id)) continue
            if (row.running === false) continue
            live.status.set(id, false)
            live.statusAt.set(id, now)
            touched = true
          }
          return touched ? applyLive(previous, live) : previous
        })
        // 二、"宿主说在跑"**先不点灯**。
        //
        //     这份集合靠 session/status 帧维护，而真机上那条流几乎不发这类帧（260 秒
        //     监听只见到一条，没有一条 running=false），所以它会把早就跑完的会话留在
        //     集合里很久。以前这里先把绿点亮起来，再拿日志尾页核实——用户看到的就是
        //     卡片先闪一下「进行中」，几十到几百毫秒后才变「已完成」，切换界面时尤其
        //     显眼（列表重挂载／mux 重连都会触发这次核对）。现在核实通过（尾页最后一条
        //     边界是 turn/start）才亮，中间那一闪没有了。
        for (const id of host) {
          if (live.status.get(id) === true && fresh(id)) continue
          confirmRunning(id, live)
        }
        // 三、宿主那份集合会**漏报**：实测正在跑的会话不在里面（真机：会话在跑，
        //     首页那个小点始终是灰的）。所以对「最近活跃的前 8 行」再按尾页证据补核一次
        //     —— 尾页最后一条边界是不是 turn/start，是唯一能证明"正在跑"的东西。
        //     上限 8 行：每行一次尾读，不能因为核对把列表拖慢。
        const nowMs = Date.now()
        const candidates = rowsRef.current
          .filter(row => live.status.get(row.sessionId) === undefined || live.status.get(row.sessionId) === false)
          .filter(row => {
            const at = row.updatedAt === undefined ? Number.NaN : Date.parse(String(row.updatedAt))
            return !Number.isFinite(at) || nowMs - at < RUNNING_CANDIDATE_AGE_MS
          })
          .slice(0, 8)
        for (const row of candidates) {
          if (fresh(row.sessionId)) continue
          confirmRunning(row.sessionId, live)
        }
      },
      () => { /* 非致命：保留 mux 镜像的判断 */ },
    )
  }, [confirmRunning])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  /** The workspace's owned session ids (attach relationship, desktop parity). */
  const ownedIds = useMemo(() => new Set(workspace.sessionIds.map(String)), [workspace])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | undefined>(undefined)
  const [presets, setPresets] = useState<readonly AgentPresetEntry[]>([])
  const [selectedPreset, setSelectedPreset] = useState<string | undefined>(undefined)
  const [presetsLoading, setPresetsLoading] = useState(true)
  const cursorRef = useRef<string | undefined>(undefined)
  const busyRef = useRef(false)
  // 手动重试首屏的信号：自增即重跑首屏加载（见下面 effect 的依赖）。
  const [reloadTick, setReloadTick] = useState(0)
  // 自动补页的轮次额度：见下面 auto-fill 的 effect。用户真正滚动时归零。
  const autoFillRoundsRef = useRef(0)
  // Sentinel watched for automatic next-page loading (the "load more" button
  // stays as the manual fallback).
  const sentinelRef = useRef<HTMLDivElement | undefined>(undefined)
  // 会话列表不再做页内搜索：搜索统一在「工作区首页」（跨工作区、带高亮与分组）。
  /** 本工作区名下的会话 id（新花名册），用于把宿主结果收窄到本列表。 */
  const ownedRef = useRef<Set<string>>(new Set())
  /** 每次挂载只补一次：深链接目标不在第一页时才往后翻。 */
  const deepTargetRef = useRef(false)

  /** Page forward (bounded) until the deep-link session appears, then open
   *  it. Best-effort: a target that never surfaces leaves the list usable. */
  const locateDeepTarget = useCallback(
    async (targetId: string, startCursor: string | undefined, owned: ReadonlySet<string>): Promise<SessionView | undefined> => {
      let cursor = startCursor
      for (let pages = 0; pages < 8 && cursor !== undefined; pages++) {
        const page = await listSessions(cursor)
        const rows = pageItems(page.items, owned)
        const target = rows.find(row => row.sessionId === targetId)
        if (target !== undefined) return target
        if (!page.hasMore) return undefined
        cursor = page.nextCursor
      }
      return undefined
    },
    [],
  )
  const [previewTick, setPreviewTick] = useState(0)
  // Unmount guard: preview fetches resolve asynchronously and must not
  // tick state (or spin the tunnel) after the view left the screen.
  const aliveRef = useRef(true)
  useEffect(() => () => { aliveRef.current = false }, [])
  /** 上一次向宿主核对运行状态的时间（这个核对自带 30 s 的宿主缓存）。 */
  const runningResyncAtRef = useRef(0)
  /** Backoff gate after a failed next-page load (sentinel retry storm). */
  const retryBlockedAtRef = useRef(0)
  /** Long-press row menu (delete session) + its confirm dialog. */
  const [menuSession, setMenuSession] = useState<SessionView | undefined>(undefined)
  const [deleting, setDeleting] = useState<SessionView | undefined>(undefined)
  const pressTimerRef = useRef<number | undefined>(undefined)
  const pressConsumedRef = useRef<string | undefined>(undefined)
  /** Pinned session ids (local preference, persisted in localStorage). */
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => loadPinnedSessions())
  /** The session whose delete action is currently swiped open (at most one). */
  const [openSwipeId, setOpenSwipeId] = useState<string | undefined>(undefined)
  /** Active swipe gesture origin (sessionId + start point). */
  const swipeStartRef = useRef<{ sessionId: string; x: number; y: number } | undefined>(undefined)

  /** Toggle one session's pin state (persisted immediately). */
  const togglePin = useCallback((sessionId: string): void => {
    setPinnedIds(previous => {
      const next = new Set(previous)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      savePinnedSessions(next)
      return next
    })
  }, [])

  /** Pull previews for the newest page's sessions (bounded, best effort).
   *  v3.1: ONE batched `mobile.previews` call serves the whole burst from the
   *  host's mux-fed cache (zero per-row log reads on repeat visits); when the
   *  host lacks the method (older plugin) or the call fails, the per-row
   *  history fallback below keeps the list working. */
  /**
   * 降级路径（逐条读会话尾部）每次最多补几条预览。
   * 批量接口失败时如果整页一起退化成逐条请求，一页 40 条就是几十次跨网往返，
   * 真机表现就是"加载很久很久、卡住"。预览只是装饰，宁可少几条也不拖死整页。
   */
  const PREVIEW_FALLBACK_LIMIT = 6
  const loadPreviews = useCallback((rows: SessionView[]): void => {
    const pending = rows
      .filter(row => !row.blank && row.preview === undefined && !sessionPreviewCache.has(row.sessionId))
      .slice(0, PREVIEW_FETCH_LIMIT)
    if (pending.length === 0) return
    const controller = new AbortController()
    const cacheSummaries = (items: ReadonlyArray<{ sessionId: string; summary: string }>): void => {
      for (const item of items) {
        if (item.summary === '') continue
        // Bounded cache: evict the oldest entry past the cap so a long-lived
        // list never grows the map without limit.
        if (sessionPreviewCache.size >= PREVIEW_CACHE_LIMIT) {
          const oldest = sessionPreviewCache.keys().next().value
          if (oldest !== undefined) sessionPreviewCache.delete(oldest)
        }
        sessionPreviewCache.set(item.sessionId, item.summary)
      }
    }
    void previews(pending.map(row => row.sessionId), controller.signal).then(
      (items) => {
        if (!aliveRef.current) return
        cacheSummaries(items)
        syncPersistedPreviews()
        setPreviewTick(tick => tick + 1)
      },
      () => {
        // Fallback: per-row tail reads (the pre-v3.1 path), same concurrency
        // cap and cache discipline.
        if (!aliveRef.current) return
        // 降级路径必须限量：批量接口失败时会退化成"逐条读尾部"，每一条都是一次
        // 跨网往返。整页 40 条一起退，就是真机反馈的"加载很久很久、卡住"。
        // 预览只是装饰，宁可少显示几条，也不能把整页拖死。
        void mapLimited(pending.slice(0, PREVIEW_FALLBACK_LIMIT), PREVIEW_CONCURRENCY, async (row) => {
          if (!aliveRef.current) return
          const summary = await fetchPreview(row.sessionId, controller.signal)
          if (summary === undefined || !aliveRef.current) return
          cacheSummaries([{ sessionId: row.sessionId, summary }])
        }).then(() => {
          if (aliveRef.current) {
            syncPersistedPreviews()
            setPreviewTick(tick => tick + 1)
          }
        })
      },
    )
  }, [])

  // Live list frames: the host mirrors its `api-session/*` events onto the mux,
  // so the roster tracks the desktop without a re-fetch. Registered before the
  // first page load, so a frame landing mid-fetch is recorded and then applied
  // on top of that page (the fetch itself stays authoritative).
  useEffect(() => {
    if (mux === undefined) return
    return mux.onFrame((frame: MuxFrame) => {
      // 新一条连接的基线帧：断线期间丢掉的 session/status 帧不会重放，列表就会
      // 一直挂着「进行中」，而桌面端早就跑完了（真机就是这样卡住的）。基线一到
      // 就用宿主的运行集合把已知行校正一遍。
      if (frame.type === 'session/subscribed' && Date.now() - runningResyncAtRef.current > RUNNING_RESYNC_MS) {
        runningResyncAtRef.current = Date.now()
        resyncRunning()
      }
      if (!applyListFrame(liveRef.current, frame, workspace)) return
      setRows(previous => applyLive(previous, liveRef.current))
    })
  }, [mux, workspace, resyncRunning])

  // 首屏也校正一次：手机可能是在会话结束之后才打开列表的，它手里根本没有那条
  // 结束帧，只能问宿主。
  useEffect(() => {
    runningResyncAtRef.current = Date.now()
    resyncRunning()
  }, [resyncRunning])

  // 停留期间也要持续核对。
  //
  // 以前只在「首屏」和「mux 基线帧」时核对一次：如果这一轮是在**你已经停在列表页**
  // 之后才开始的（在别的设备发起、或从聊天页返回后 mux 没重连），列表手里没有任何帧，
  // 绿点就一直不亮 —— 真机「会话明明在跑，首页那个小点还是灰的」。
  // 现在页面可见时每 5 秒核对一次；切回前台也立刻核对一次。判断证据仍是尾页边界
  // （turn/start = 在跑），不靠宿主那份自带缓存的集合。
  useEffect(() => {
    const tick = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      runningResyncAtRef.current = Date.now()
      resyncRunning()
    }
    const timer = setInterval(tick, RUNNING_POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [resyncRunning])
  // First page on mount (this workspace's sessions, paged). v3.2: when a
  // previous visit's rows are cached, they render IMMEDIATELY (no skeleton)
  // and the network refresh below re-validates in the background — returning
  // from a chat must not wait on any RPC to show the roster. The workspace
  // prop's sessionIds snapshot predates any session created since this list
  // last mounted (create -> chat -> back remounts the list), so the attach
  // roster is refreshed alongside the page: a freshly created session must
  // survive the owned-row filter without a manual reload. A roster refresh
  // failure falls back to the snapshot — it must never block the list.
  useEffect(() => {
    let cancelled = false
    // Cross-mount restore (v3.2) + PWA cold-start restore (v3.3): seed
    // state from the memory cache, else the persisted store, before any
    // network — then let the refresh below reconcile.
    seedPersistedCaches()
    const key = String(workspace.workspaceId)
    let cached = sessionListCache.get(key)
    if (cached !== undefined && Date.now() - cached.at >= LIST_CACHE_TTL_MS) cached = undefined
    if (cached === undefined) {
      const persisted = loadPersistedList(key)
      if (persisted !== undefined) {
        cached = { rows: persisted.rows, cursor: persisted.cursor, hasMore: persisted.hasMore, at: Date.now() }
        sessionListCache.set(key, cached)
      }
    }
    if (cached !== undefined) {
      // 缓存里的绿点先剥掉：它是上次渲染时的结论，会话可能早就跑完了。
      const aliveIds = muxRunningIds(mux)
      setRows(applyLive(dropStaleRunning(cached.rows, aliveIds), liveRef.current))
      cursorRef.current = cached.cursor
      setHasMore(cached.hasMore)
      setError(undefined)
      setLoading(false)
    } else {
      setLoading(true)
      setError(undefined)
    }
    // 看门狗：这些请求**没有超时**，一旦连接挂死（弱网、隧道被掐断但不报错），
    // loading 会永远为真、列表永久空着 —— 而且此后每次点"加载更多"都会因为
    // cursor 还是 undefined 被静默丢弃。真机反馈的"点击加载失效"就是这条链。
    // 超时不能取消底层请求（传输层无关），但能把"永久锁死"降级为"报错后可重试"。
    const firstPageWatchdog = setTimeout(() => {
      if (cancelled) return
      setLoading(false)
      setError('加载超时了，点一下"加载更多"重试')
    }, FIRST_PAGE_TIMEOUT_MS)
    // 工作区列表单独在后台跑：只用来刷新 ownedRef（续页的归属过滤），失败就当无事发生。
    void listWorkspaces().then(
      (workspaces) => {
        if (cancelled) return
        const fresh = workspaces.find(item => item.workspaceId === workspace.workspaceId)
        if (fresh === undefined) return
        ownedRef.current = new Set(fresh.sessionIds.map(String))
      },
      () => undefined,
    )
    // 会话列表**不再等工作区列表**：listWorkspaces 在"主目录"这类巨型工作区上可以慢到
    // 分钟级，而它原本被 Promise.all 卡在关键路径上 —— 于是"其他工作区首次加载都超时"，
    // 甚至一个会话都没有的工作区（例如把用户主目录当工作区）也照样超时。
    // 现在：会话列表先用工作区自带的 sessionIds 立刻渲染；工作区列表单独在后台跑，
    // 回来后只刷新 ownedRef（供续页的归属过滤使用），永不阻塞首屏。
    const workspacesOrEmpty = Promise.race([
      listWorkspaces().catch(() => [] as WorkspaceRow[]),
      new Promise<WorkspaceRow[]>(resolve => {
        setTimeout(() => resolve([] as WorkspaceRow[]), WORKSPACE_LIST_BUDGET_MS)
      }),
    ])
    void Promise.all([listSessions(undefined, workspace.workspaceId), workspacesOrEmpty]).then(
      ([page, workspaces]) => {
        if (cancelled) return
        clearTimeout(firstPageWatchdog)
        // 成功即清掉旧横幅。少了这一行，看门狗打上的"加载超时"会一直挂在列表顶上
        // （真机截图证实：数据早已毫秒级加载完，红字还在，用户以为又超时了）。
        setError(undefined)
        const fresh = workspaces.find(item => item.workspaceId === workspace.workspaceId)
        const owned = new Set((fresh?.sessionIds ?? workspace.sessionIds).map(String))
        ownedRef.current = owned
        const rows = pageItems(page.items, owned)
        // Notification deep link: open the target session straight away when
        // it is on the first page (the usual case — a just-finished session
        // is recent). A session beyond the first page stays reachable from
        // the list.
        const target = initialSessionId === undefined
          ? undefined
          : rows.find(row => row.sessionId === initialSessionId)
        if (target !== undefined) {
          onPick(target)
          return
        }
        // 这一页是宿主刚给的：它说谁在跑，就从现在开始给谁计时。这样即使那条
        // 结束帧丢了、宿主核对又慢得等不到，绿点也会自己过期。
        const seeded = seedPageRows(rows, liveRef.current)
        const stampAt = Date.now()
        for (const row of seeded) {
          const sessionId = String(row.sessionId)
          if (row.running === true && !liveRef.current.statusAt.has(sessionId)) {
            liveRef.current.statusAt.set(sessionId, stampAt)
          }
        }
        setRows(applyLive(seeded, liveRef.current))
        setCachedList(key, { rows, cursor: page.nextCursor, hasMore: page.hasMore })
        loadPreviews(rows)
        cursorRef.current = page.nextCursor
        setHasMore(page.hasMore)
        setLoading(false)
        // Deep-link target (search locate / notification) not on the loaded
        // pages: page forward (bounded) until it appears, then open it —
        // otherwise the tap lands but the session never opens. When the
        // target never surfaces (a stale search attribution can point at a
        // workspace whose pages do not contain it), open it directly rather
        // than dead-ending on a plain list.
        if (initialSessionId !== undefined && target === undefined && !deepTargetRef.current) {
          deepTargetRef.current = true
          const shell = (): SessionView => ({
            sessionId: initialSessionId,
            title: '定位的会话',
            updatedAt: 0,
            running: false,
            blank: false,
          })
          if (page.hasMore) {
            void locateDeepTarget(initialSessionId, page.nextCursor, owned).then(
              (found) => { onPick(found ?? shell()) },
              () => { /* bounded best-effort; the list stays usable */ },
            )
          } else {
            onPick(shell())
          }
        }
      },
      (reason: unknown) => {
        if (cancelled) return
        // 失败也要拆看门狗：它只负责把「永久锁死」降级成可重试。少了这一行，
        // 12 秒后它照样开火，用「加载超时」把真正的错误（没配对、隧道断了）盖掉，
        // 用户照着错误提示排查，方向从一开始就是错的。
        clearTimeout(firstPageWatchdog)
        // With a cached roster the refresh failure stays silent (the old
        // rows remain); only a cold first load surfaces the error.
        if (cached === undefined) setError(errorText(reason))
        setLoading(false)
      },
    )
    return () => { cancelled = true }
  }, [workspace, initialSessionId, onPick, loadPreviews])

  /**
   * Scroll-position round-trip (v3.2, v3.3): leaving for a chat saves the
   * list's scroll offset, returning (or relaunching the PWA) restores it
   * after the cached rows painted — the user lands exactly where they were
   * instead of at the top. Persisted in localStorage (survives cold start);
   * best effort, a storage failure disables it silently.
   */
  useEffect(() => {
    const key = String(workspace.workspaceId)
    const saved = loadPersistedScroll(key)
    if (saved > 0) {
      requestAnimationFrame(() => {
        try { window.scrollTo(0, saved) } catch { /* jsdom/noop */ }
      })
    }
    return () => {
      savePersistedScroll(key, window.scrollY)
    }
  }, [workspace.workspaceId])

  useEffect(() => {
    let cancelled = false
    setPresets([])
    setSelectedPreset(undefined)
    setPresetsLoading(true)
    void listAgentPresets().then(
      (roster) => {
        if (cancelled) return
        const usable = roster.presets.filter(preset => preset.broken === undefined)
        setPresets(roster.presets)
        setSelectedPreset((usable.find(preset => preset.isDefault) ?? usable[0])?.id)
        setPresetsLoading(false)
      },
      () => {
        if (cancelled) return
        setPresetsLoading(false)
      },
    )
    return () => { cancelled = true }
  }, [workspace, reloadTick])

  /**
   * Pull the next page and append its rows.
   * manual=true 表示这次是用户亲手点的"加载更多"：**不适用失败退避**。
   * 退避（10s）本来是给自动路径（哨兵 observer）防弱网猛打隧道用的，但手动点击
   * 也被它一起静默吞掉时，用户看到的就是"点了没反应、要点好几次"。用户明确
   * 重试的意图必须立刻被执行；防抖只该管自动重试。
   */
  const loadMore = useCallback((manual = false) => {
    if (busyRef.current) return
    // Failed loads gate the sentinel for a cooldown: on a weak link the
    // observer would otherwise hammer the tunnel with immediate retries.
    if (!manual && Date.now() - retryBlockedAtRef.current < LOAD_MORE_BACKOFF_MS) return
    const cursor = cursorRef.current
    if (cursor === undefined) {
      // 首屏还没回来（或已被看门狗判超时）：这里以前是一句静默 return，
      // 用户点多少次都不会有任何反应 —— 真机反馈的"点击加载失效"。
      // 用户明确重试的意图必须被执行：重跑一遍首屏加载。
      if (manual) setReloadTick(tick => tick + 1)
      return
    }
    busyRef.current = true
    setLoading(true)
    // 续页请求同样没有超时。缺了看门狗时，一次挂死的续页会让按钮永久停在
    // "加载中…"（真机截图证实：下拉历史后按钮一直是加载中）。超时即解锁并报错，
    // 用户可以直接再点一次，而不是只能退出重进。
    const watchdog = setTimeout(() => {
      if (!aliveRef.current) return
      busyRef.current = false
      setLoading(false)
      retryBlockedAtRef.current = Date.now()
      setError('加载超时了，再点一次')
    }, FIRST_PAGE_TIMEOUT_MS)
    void listSessions(cursor, workspace.workspaceId).then(
      (page) => {
        busyRef.current = false
        setLoading(false)
        clearTimeout(watchdog)
        // 续页成功同样要清掉看门狗的"再点一次"横幅，否则它一直挂着。
        setError(undefined)
        // 成功即解除退避：下一屏不必再等满 10 秒。
        retryBlockedAtRef.current = 0
        cursorRef.current = page.nextCursor
        setHasMore(page.hasMore)
        const appended = pageItems(page.items, ownedIds)
        setRows(previous => {
          const next = [...previous, ...appended]
          // Keep the cross-mount/persisted caches in step with the roster.
          const cached = sessionListCache.get(String(workspace.workspaceId))
          if (cached !== undefined) {
            setCachedList(String(workspace.workspaceId), { rows: next, cursor: page.nextCursor, hasMore: page.hasMore })
          }
          return next
        })
        loadPreviews(appended)
      },
      (reason: unknown) => {
        busyRef.current = false
        setLoading(false)
        clearTimeout(watchdog)
        retryBlockedAtRef.current = Date.now()
        setError(errorText(reason))
      },
    )
  }, [workspace, loadPreviews])

  // Auto-load the next page when the bottom sentinel enters the viewport,
  // so long lists converge without taps; the manual button stays as the
  // fallback (and for browsers without IntersectionObserver).
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (sentinel === undefined) return
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        // 真实的"进入视野"事件说明用户滚动了：给他重新开一轮自动补页的额度。
        autoFillRoundsRef.current = 0
        if (cursorRef.current !== undefined && !busyRef.current) void loadMore()
      }
    }, { rootMargin: '240px 0px' })
    observer.observe(sentinel)
    return () => { observer.disconnect() }
  }, [loadMore])

  // 追加一页之后，哨兵往往**仍然**在视口/rootMargin 之内 —— IntersectionObserver 只在
  // "进入/离开"这种状态切换时回调，位置没变就不再触发，于是用户必须再滚一下、或再点
  // 一次"加载更多"，真机反馈就是"有时候要点好几次才看到更多会话"。
  // 这里补一次主动几何检查，把列表一次填满；但必须有**硬上限**：一轮最多补
  // AUTO_FILL_MAX_ROUNDS 页，否则一旦环境量不出几何（例如 jsdom 里 rect 全是 0）
  // 且 hasMore 一直为真，就会无限拉页把内存打爆 —— 这是实测踩过的坑。
  // 用户真正滚动（上面的 observer 回调）时会重新开额度。
  // 一轮里最多自动补几页。宿主每页给的是**全局** 40 条，客户端再按工作区过滤
  // （pageItems(page.items, owned)），所以一页里属于本工作区的常常只有几条 ——
  // 上限太小，就会出现"每翻一屏要点好几次加载更多"（真机反馈）。
  // 放宽到 8 页（最多 320 条宿主行，行本身很小），足以把一屏填满；
  // 真正的刹车仍是几何判定：哨兵被顶出视野就立刻停，所以只有在"页面被大量过滤"
  // 时才会连续补。用户真正滚动时额度归零。
  const AUTO_FILL_MAX_ROUNDS = 2
  useEffect(() => {
    if (!hasMore || loading) return
    if (autoFillRoundsRef.current >= AUTO_FILL_MAX_ROUNDS) return
    const sentinel = sentinelRef.current
    if (sentinel === null || sentinel === undefined) return
    const distanceToBottom = sentinel.getBoundingClientRect().top - window.innerHeight
    if (distanceToBottom > 240) return
    autoFillRoundsRef.current += 1
    void loadMore()
  }, [hasMore, loading, rows, loadMore])

  /** Create a blank session in this workspace and open it immediately. */
  const handleCreate = useCallback(() => {
    if (creating) return
    setCreating(true)
    setCreateError(undefined)
    void createSession({
      workspaceId: workspace.workspaceId,
      ...(selectedPreset !== undefined ? { agentPreset: selectedPreset } : {}),
    }).then(
      (created) => {
        setCreating(false)
        const view: SessionView = {
          sessionId: created.sessionId,
          title: '新会话',
          updatedAt: Date.now(),
          running: false,
          blank: true,
        }
        setRows(previous => {
          const next = [view, ...previous]
          const cached = sessionListCache.get(String(workspace.workspaceId))
          if (cached !== undefined) {
            setCachedList(String(workspace.workspaceId), { rows: next, cursor: cached.cursor, hasMore: cached.hasMore })
          }
          return next
        })
        onPick(view)
      },
      (reason: unknown) => {
        setCreating(false)
        setCreateError(errorText(reason))
      },
    )
  }, [creating, workspace, onPick, selectedPreset])

  /** Clear the long-press timer (touch move/end cancels a pending press). */
  const clearPressTimer = useCallback(() => {
    if (pressTimerRef.current !== undefined) {
      clearTimeout(pressTimerRef.current)
      pressTimerRef.current = undefined
    }
  }, [])

  useEffect(() => () => { clearPressTimer() }, [clearPressTimer])

  /**
   * Long-press (touch) opens the row action menu; contextmenu covers mouse.
   * The trailing click after a long-press is swallowed so the row does not
   * navigate AND open the menu at once. A clear horizontal left swipe opens
   * the delete action (right swipe / vertical scroll cancels it); tapping a
   * swiped-open row closes it instead of navigating.
   */
  const rowHandlers = (row: SessionView) => ({
    onTouchStart: (event: ReactTouchEvent) => {
      clearPressTimer()
      pressConsumedRef.current = undefined
      pressTimerRef.current = window.setTimeout(() => {
        pressTimerRef.current = undefined
        pressConsumedRef.current = row.sessionId
        setMenuSession(row)
      }, 500)
      const touch = event.touches[0]
      if (touch !== undefined) swipeStartRef.current = { sessionId: row.sessionId, x: touch.clientX, y: touch.clientY }
    },
    onTouchMove: (event: ReactTouchEvent) => {
      clearPressTimer()
      const swipe = swipeStartRef.current
      if (swipe === undefined || swipe.sessionId !== row.sessionId) return
      const touch = event.touches[0]
      if (touch === undefined) return
      const dx = touch.clientX - swipe.x
      const dy = touch.clientY - swipe.y
      // A decisive horizontal left swipe opens the delete action; a right
      // swipe closes it; a vertical scroll cancels the swipe tracking.
      if (Math.abs(dx) > SWIPE_TRIGGER_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
        setOpenSwipeId(dx < 0 ? row.sessionId : undefined)
        swipeStartRef.current = undefined
      } else if (Math.abs(dy) > SWIPE_TRIGGER_PX) {
        swipeStartRef.current = undefined
      }
    },
    onTouchEnd: () => {
      clearPressTimer()
      swipeStartRef.current = undefined
    },
    onClick: (event: ReactMouseEvent) => {
      if (pressConsumedRef.current === row.sessionId) {
        pressConsumedRef.current = undefined
        event.preventDefault()
        return
      }
      if (openSwipeId === row.sessionId) {
        setOpenSwipeId(undefined)
        event.preventDefault()
        return
      }
      onPick(row)
    },
    onContextMenu: (event: ReactMouseEvent) => {
      event.preventDefault()
      setMenuSession(row)
    },
  })

  /**
   * Delete a session through the host archive RPC (desktop parity): the row
   * leaves the roster and never reappears after a refresh or a re-fetch —
   * the archive set rides workspace.list and this surface's session.list
   * already filters it. The session log stays on disk (restorable from the
   * desktop). The local row drop + outbox cleanup run either way; if the RPC
   * fails the session would otherwise resurrect on reload, so surface why.
   */
  const handleDeleteSession = useCallback((row: SessionView): void => {
    setDeleting(undefined)
    setMenuSession(undefined)
    setRows(previous => {
      const next = previous.filter(item => item.sessionId !== row.sessionId)
      const cached = sessionListCache.get(String(workspace.workspaceId))
      if (cached !== undefined) {
        setCachedList(String(workspace.workspaceId), { rows: next, cursor: cached.cursor, hasMore: cached.hasMore })
      }
      return next
    })
    void removeOutboxForSession(row.sessionId)
    void archiveSession(row.sessionId).catch((reason: unknown) => {
      toast(`删除未生效：${errorText(reason)}`)
    })
  }, [workspace])

  const createHint = createError !== undefined ? staleHostHint(createError) : undefined
  const selectedPresetEntry = presets.find(preset => preset.id === selectedPreset)
  const [presetHelpOpen, setPresetHelpOpen] = useState(false)
  const [presetPickerOpen, setPresetPickerOpen] = useState(false)
  const presetDescription = selectedPresetEntry?.description

  // Date-grouped roster: 置顶 → 今天 → 昨天 → 更早, newest first inside each bucket.
  const groups = useMemo(() => {
    const visible = rows
    const pinned = visible.filter(row => pinnedIds.has(row.sessionId))
    const rest = visible.filter(row => !pinnedIds.has(row.sessionId))
    const pinnedGroup = pinned.length > 0 ? [{ bucket: '置顶' as const, rows: pinned }] : []
    const dayGroups = DAY_BUCKETS
      .map(bucket => ({ bucket, rows: rest.filter(row => dayBucketFor(row.updatedAt) === bucket) }))
      .filter(group => group.rows.length > 0)
    return [...pinnedGroup, ...dayGroups]
    // previewTick: cached previews arrive async — recompute the filter when they land.
  }, [rows, previewTick, pinnedIds])

  return (
    <div className="mobile">
      <header className="mobile-header">
        <div className="mobile-headerSlot">
          <button type="button" className="mobile-back" aria-label="返回" onClick={onBack}>‹</button>
        </div>
        <div className="mobile-titleWrap">
          <h1 className="mobile-title mobile-titleInline">{workspace.title}</h1>
          {/* Subordinate metadata: one mono line, ellipsized on overflow. */}
          <p className="mobile-titlePath">{workspace.path}</p>
        </div>
        <div className="mobile-headerSlot mobile-headerSlot-right">
          <button type="button" className="mobile-iconbtn" aria-label="设置" onClick={onOpenSettings}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
                </svg>
              </button>
          <ThemeToggle />
        </div>
      </header>
      {error !== undefined && <p className="mobile-error mobile-pad">{error}</p>}
      <>
      <div className="mobile-create">
        {presets.length > 0 && (
          <div className="mobile-presetCard">
            <button
              type="button"
              className="mobile-presetTrigger"
              aria-label="Agent 模式"
              // 不再因为「当前没有选中项」而禁用：宿主返回的预设可能全是坏行，
              // 那样用户点它毫无反应、也不知道为什么。打开面板就能看到每个模式的状态。
              onClick={() => { setPresetPickerOpen(true) }}
            >
              <span className="mobile-presetTriggerCopy">
                <span className="mobile-presetTriggerTitle">
                  {selectedPresetEntry?.name ?? selectedPreset ?? '无可用 Agent 模式'}
                  {selectedPresetEntry?.isDefault === true ? '（默认）' : ''}
                </span>
                {selectedPresetEntry?.description !== undefined && (
                  <span className="mobile-presetTriggerDesc">{selectedPresetEntry.description}</span>
                )}
              </span>
            </button>
            <span className="mobile-presetCaret" aria-hidden>▾</span>
            <button
              type="button"
              className="mobile-presetHelp"
              aria-label="模式说明"
              // 不要因为「这个模式没写说明」就 disabled：禁用按钮按下没有任何反馈，
              // 真机上就是「点问号没反应」（2026-10-29 反馈）。没说明时面板里
              // 给通用解释，总比一个点不动的图标强。
              onClick={() => { setPresetHelpOpen(true) }}
            >
              <HelpIcon />
            </button>
          </div>
        )}
        <button
          type="button"
          className="mobile-new"
          disabled={creating || presetsLoading}
          onClick={() => { void handleCreate() }}
        >
          {creating ? '创建中…' : '+ 新建会话'}
        </button>
      </div>
      {createError !== undefined && (
        <p className="mobile-error mobile-pad">
          {createError}
          {createHint !== undefined && <span className="mobile-hint">{createHint}</span>}
        </p>
      )}
      </>
      <ul className="mobile-list">
        {loading && rows.length === 0 && (
          <div aria-hidden="true" role="presentation">
            {[0, 1, 2].map(index => (
              <div className="skel-row" key={index}>
                <span className="skel skel-icon" />
                <div className="skel-lines">
                  <div className="skel skel-line-title" />
                  <div className="skel skel-line-sub" />
                </div>
                <span />
              </div>
            ))}
          </div>
        )}
        {(() => {
          // Flat row index across day-group buckets for the content-visibility
          // tail keep (bottom rows must render real so the sentinel stays
          // reachable; rows above skip layout/paint).
          let flatIndex = 0
          const totalRows = groups.reduce((total, group) => total + group.rows.length, 0)
          return groups.map(group => {
          return (
            <li key={group.bucket} style={{ listStyle: 'none' }}>
              <div className="mobile-groupTitle">{group.bucket}</div>
              {group.rows.map(row => {
                const preview = row.preview ?? sessionPreviewCache.get(row.sessionId)
                  ?? (row.turns !== undefined ? `${row.turns} 轮对话` : undefined)
                // content-visibility: skip layout/paint for rows far above the
                // viewport; keep the tail real so the sentinel stays reachable.
                const cvTail = flatIndex >= totalRows - SESSION_CV_KEEP_BOTTOM
                const cvStyle = cvTail || totalRows < 20
                  ? undefined
                  : { contentVisibility: 'auto' as const, containIntrinsicSize: 'auto 72px' }
                flatIndex += 1
                const swiped = openSwipeId === row.sessionId
                return (
                  <div key={row.sessionId} className="mobile-row-swipe" style={cvStyle}>
                    <button
                      type="button"
                      className="mobile-row-swipe-action"
                      aria-label="删除会话"
                      onClick={() => { setOpenSwipeId(undefined); setDeleting(row) }}
                    >
                      删除
                    </button>
                    <div className={'mobile-row-swipe-inner' + (swiped ? ' swiped' : '')}>
                      <button type="button" className="mobile-row mobile-row-sess" {...rowHandlers(row)}>
                        <span className="card-icon">
                          {row.running ? (
                            <span className="sess-dot sess-dot-running" role="img" aria-label="进行中" />
                          ) : (
                            <span className="sess-check" aria-hidden><CheckIcon /></span>
                          )}
                        </span>
                        <span className="card-main">
                          <span className="sess-titleline">
                            <span className="sess-title">{row.title}</span>
                          </span>
                          <span className="sess-meta">
                            {row.blank && <span className="sess-status">新</span>}
                            {row.running && <span className="sess-status">进行中</span>}
                            {row.error !== undefined && <span className="sess-status" title={row.error}>出错</span>}
                            <span className="sess-time">{formatFullTime(row.updatedAt)}</span>
                          </span>
                          {preview !== undefined && <span className="card-desc">{preview}</span>}
                        </span>
                        <span className="card-action">
                          <span className="mobile-chevron" aria-hidden>›</span>
                        </span>
                      </button>
                    </div>
                  </div>
                )
              })}
            </li>
          )
        })})()}
        {hasMore && (
          <li style={{ listStyle: 'none' }}>
            <div className="mobile-pad">
              <div ref={ref => { sentinelRef.current = ref ?? undefined }} aria-hidden="true" />
              <button
                type="button"
                className="mobile-button mobile-block"
                disabled={loading}
                onClick={() => { void loadMore(true) }}
              >
                {loading ? '加载中…' : '加载更多会话'}
              </button>
            </div>
          </li>
        )}
        {!hasMore && rows.length === 0 && !loading && (
          <div className="mobile-empty">
            <div className="empty-icon"><ChatBubbleIcon /></div>
            <p className="empty-title">还没有会话</p>
            <p className="empty-desc">点上方按钮新建一个，开始这个项目的第一段对话</p>
          </div>
        )}
      </ul>
      {presetPickerOpen && (
        <Sheet title="选择 Agent 模式" onClose={() => { setPresetPickerOpen(false) }}>
          {presets.map((preset, index) => (
            <div key={preset.id}>
              {index > 0 && <div className="sheet-option-divider" aria-hidden />}
              <button
                type="button"
                className={`sheet-option${preset.id === selectedPreset ? ' sheet-option-selected' : ''}`}
                disabled={preset.broken !== undefined}
                onClick={() => {
                  setSelectedPreset(preset.id)
                  setPresetPickerOpen(false)
                }}
              >
                <span className="sheet-option-copy">
                  <span className="sheet-option-title">
                    {preset.name ?? preset.id}
                    {preset.isDefault ? '（默认）' : ''}
                    {preset.trust === 'user' ? '（本地）' : ''}
                    {preset.broken !== undefined ? '（不可用）' : ''}
                  </span>
                  {preset.description !== undefined && (
                    <span className="sheet-option-desc">{preset.description}</span>
                  )}
                  {preset.broken !== undefined && (
                    <span className="sheet-option-desc">不可用：{preset.broken}</span>
                  )}
                </span>
                {preset.id === selectedPreset && (
                  <span className="sheet-option-check" aria-hidden><CheckIcon /></span>
                )}
              </button>
            </div>
          ))}
        </Sheet>
      )}
      {presetHelpOpen && (
        <Sheet title="Agent 模式说明" onClose={() => { setPresetHelpOpen(false) }}>
          <p className="sheet-confirm-desc">
            {selectedPresetEntry?.name ?? selectedPreset ?? '当前模式'}
            {presetDescription !== undefined && presetDescription !== '' ? '：' + presetDescription : ''}
          </p>
          {presetDescription === undefined || presetDescription === '' ? (
            <p className="sheet-confirm-desc">
              这个模式没有写说明。它决定新会话的系统提示词与可用工具集；点上方那一行可以切换，
              选好后再点「新建会话」——改动只影响之后新建的会话，已存在的会话不受影响。
            </p>
          ) : null}
          <p className="sheet-confirm-desc">
            模式对本工作区生效：切换后新建的会话才用新模式，已有会话保持原样。
          </p>
        </Sheet>
      )}
      {menuSession !== undefined && (
        <Sheet title={menuSession.title} onClose={() => { setMenuSession(undefined) }}>
          <div role="menu" aria-label="会话操作">
            <div className="sheet-option-divider" aria-hidden />
            <button
              type="button"
              role="menuitem"
              className="sheet-option"
              onClick={() => { togglePin(menuSession.sessionId); setMenuSession(undefined) }}
            >
              <span className="sheet-option-copy">
                <span className="sheet-option-title">{pinnedIds.has(menuSession.sessionId) ? '取消置顶' : '置顶'}</span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="sheet-option"
              onClick={() => { setMenuSession(undefined); setDeleting(menuSession) }}
            >
              <span className="sheet-option-copy">
                <span className="sheet-option-title" style={{ color: 'var(--danger)' }}>删除会话</span>
              </span>
            </button>
          </div>
        </Sheet>
      )}
      {deleting !== undefined && (
        <ConfirmDialog
          title="删除会话"
          body={<>确定删除「{deleting.title}」吗？该会话将从所有设备消失（电脑上的会话记录保留，可从桌面找回）。</>}
          confirmLabel="删除"
          tone="danger"
          onCancel={() => { setDeleting(undefined) }}
          onConfirm={() => { handleDeleteSession(deleting) }}
        />
      )}
    </div>
  )
}
