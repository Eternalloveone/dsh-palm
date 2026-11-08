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

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react'
import type { WorkspaceView as WorkspaceRow } from '../../api-proxy-types'
import type { AgentPresetEntry } from '../../api-proxy-types'
import type { MuxFrame } from '../../api-proxy-types'
import type { MuxClient } from '../stream/mux.ts'
import { archiveSession, assignSessionFolder, createSession, createSessionFolder, history, listAgentPresets, listSessions, listWorkspaces, logTail, previews, readSessionFolders, renameSession, runningSessions, type SessionFoldersView } from '../data/list.ts'
import { errorText, staleHostHint } from '../shared/error-text.ts'
import type { SessionView } from '../shared/session-view.ts'
import { previewSummary } from '../render/ui-text.ts'
import { foldEvents, type WireEvent } from '../render/messages.ts'
import { removeOutboxForSession } from '../platform/offline.ts'
import { toast } from '../components/toast.tsx'
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
} from '../session/list-persist.ts'
export { sessionListCache } from '../session/list-persist.ts'
import {
  DAY_BUCKETS,
  RUNNING_STALE_MS,
  applyListFrame,
  applyLive,
  dayBucketFor,
  dropStaleRunning,
  emptyLiveState,
  muxRunningIds,
  pageItems,
  type DayBucket,
  type LiveListState,
} from './list/session-list-model.ts'
export { dayBucketFor, RUNNING_STALE_MS } from './list/session-list-model.ts'
import { SessionListCreate, SessionListFilters, SessionListHeader } from './list/session-list-parts.tsx'
import { SessionListRoster, type SessionRowHandlers } from './list/session-list-roster.tsx'
import type { HostBridge } from '../kernels/host-bridge.ts'
import {

  CreateFolderDialog,
  DeleteSessionDialog,
  PresetHelpSheet,
  PresetPickerSheet,
  RenameSessionDialog,
  SessionFolderSheet,
  SessionMenuSheet,
} from './list/session-list-sheets.tsx'
import { fetchSessionPreview, mapLimited } from '../kernels/preview-slice.ts'
import { createListCacheSlice } from '../kernels/list-cache-slice.ts'

/** How many sessions get a lazily-fetched last-message preview. */
export const PREVIEW_FETCH_LIMIT = 12
/** Concurrent preview fetches (small pages; keep the tunnel quiet). */
const PREVIEW_CONCURRENCY = 3
/** Preview cache cap (oldest evicted past this). */
const PREVIEW_CACHE_LIMIT = 200
/** 向宿主核对「进行中」标记的最小间隔（宿主那份集合自带 30 s 缓存）。 */
export const RUNNING_RESYNC_MS = 30_000
/** 停留在列表页时的主动核对间隔（毫秒）：会话在跑但绿点不亮就是靠它收敛。 */
const RUNNING_POLL_MS = 5_000
/** 只有最近这么久内活跃过的行才值得花一次尾读去核实（更老的极不可能还在跑）。 */
export const RUNNING_CANDIDATE_AGE_MS = 10 * 60_000

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






/** 预览切片的依赖注入：读取、折叠、压缩各一件，便于单测替换。 */
const previewDeps = { history, foldEvents, previewSummary }

/** 列表缓存切片：名册页写穿 + 摘要表持久化 + 冷启动播种。 */
const listCache = createListCacheSlice({
  sessionListCache: sessionListCache as never,
  loadPersistedPreviews,
  maintainPersistedCaches: maintainPersistedCaches as never,
  queuePersistedList: queuePersistedList as never,
  queuePersistedPreviews,
})

/** 行摘要缓存（跨挂载存活；导出供测试隔离）。 */
export const sessionPreviewCache = listCache.sessionPreviewCache

/** Props for the session list. */
export interface SessionListViewProps {
  workspace: WorkspaceRow
  /** The live-event client, for the host's session-list frames. */
  mux?: MuxClient | undefined
  /** P3：全站唯一订阅点；给了它就不再直接订阅 mux。 */
  bridge?: HostBridge | undefined
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

/**
 * Render one workspace's paged session list.
 * @param props - the workspace, back action, and pick action.
 * @returns the session list.
 */
export function SessionListView({ workspace, mux, bridge, initialSessionId, onBack, onPick, onOpenSettings, onLocateSession, onPickSeq }: SessionListViewProps) {
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
        // 只用来熄灯：点亮一律交给宿主那份集合（桌面端口径）。
        // 以前这里凭"尾页最后一条边界是 turn/start"点亮，于是一个几十年前开着的回合
        // 会让绿点长亮（实测 9 月的会话 11 月还标着「进行中」）。
        if (page.turnStartAt !== undefined) return
        const next = false
        // 尾页证据也算一次"脉搏"：宿主确认在跑的会话不该因为手机收不到帧而掉绿点。
        if (next) live.confirmedAt.set(sessionId, Date.now())
        else live.confirmedAt.delete(sessionId)
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
        // 记下"宿主这一次的答复"：绿点以它为准（桌面端同源）。
        // 之前知道过的、这次不在集合里的会话一律记 false —— 熄灯方向永远安全。
        for (const id of new Set([...live.host.keys(), ...host])) {
          live.host.set(id, host.has(id))
        }
        for (const id of host) live.host.set(id, true)
        // 宿主的结论一变，绿点就要跟着变 —— **两个方向**都要重画一次。
        // （以前只在"熄灯"那一支里 setRows，宿主说在跑时界面根本不更新。）
        setRows(previous => applyLive(previous, live))
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
          // 宿主（= 桌面端同源：agent 是否在跑）说在跑，就先给它记一次"脉搏"，
          // 免得尾页读不出边界时又被 5 分钟静默规则判死。
          live.confirmedAt.set(id, now)
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
  /**
   * Host-side grouping (F1). `undefined` means either "not loaded yet" or "the
   * host predates folders" — both render as "no folder chips", so an old host
   * simply shows the flat list it always showed.
   */
  const [folders, setFolders] = useState<SessionFoldersView | undefined>(undefined)
  /** Active filter: all | running | pending | a folder id. */
  const [folderFilter, setFolderFilter] = useState<string>('all')
  /** The session whose "move to folder" sheet is open. */
  const [folderSheetFor, setFolderSheetFor] = useState<SessionView | undefined>(undefined)
  /** The session being renamed (PromptDialog). */
  const [renamingSession, setRenamingSession] = useState<SessionView | undefined>(undefined)
  /** "新建分组" PromptDialog. */
  const [creatingFolder, setCreatingFolder] = useState(false)
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

  // Host-side grouping (F1), fetched once per mount. A host that predates the
  // feature answers `unavailable`; the chips then never render and the list
  // behaves exactly as before.
  useEffect(() => {
    let alive = true
    void readSessionFolders().then(
      (value) => { if (alive) setFolders(value) },
      () => { if (alive) setFolders(undefined) },
    )
    return () => { alive = false }
  }, [])

  /** File one session into a folder (null = remove from its folder). */
  const handleAssignFolder = useCallback((row: SessionView, folderId: string | null): void => {
    setFolderSheetFor(undefined)
    void assignSessionFolder(row.sessionId, folderId).then(
      (value) => { setFolders(value) },
      (reason: unknown) => { toast(`分组未生效：${errorText(reason)}`) },
    )
  }, [])

  /** Rename one session through the host (desktop parity), optimistically. */
  const handleRenameSession = useCallback((title: string): void => {
    const target = renamingSession
    setRenamingSession(undefined)
    if (target === undefined) return
    setRows(previous => previous.map(row => (
      row.sessionId === target.sessionId ? { ...row, title } : row
    )))
    void renameSession(target.sessionId, title).then(
      () => { toast('已重命名') },
      (reason: unknown) => { toast(`重命名未生效：${errorText(reason)}`) },
    )
  }, [renamingSession])

  /** Create a folder from the move sheet. */
  const handleCreateFolder = useCallback((name: string): void => {
    setCreatingFolder(false)
    void createSessionFolder(name).then(
      (value) => { setFolders(value); toast('已新建分组') },
      (reason: unknown) => { toast(errorText(reason)) },
    )
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
        listCache.syncPreviews()
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
          const summary = await fetchSessionPreview(previewDeps, row.sessionId, controller.signal)
          if (summary === undefined || !aliveRef.current) return
          cacheSummaries([{ sessionId: row.sessionId, summary }])
        }).then(() => {
          if (aliveRef.current) {
            listCache.syncPreviews()
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
    const onFrame = (frame: MuxFrame): void => {
      // 新一条连接的基线帧：断线期间丢掉的 session/status 帧不会重放，列表就会
      // 一直挂着「进行中」，而桌面端早就跑完了（真机就是这样卡住的）。基线一到
      // 就用宿主的运行集合把已知行校正一遍。
      if (frame.type === 'session/subscribed' && Date.now() - runningResyncAtRef.current > RUNNING_RESYNC_MS) {
        runningResyncAtRef.current = Date.now()
        resyncRunning()
      }
      if (!applyListFrame(liveRef.current, frame, workspace)) return
      setRows(previous => applyLive(previous, liveRef.current))
    }
    // P3：有 bridge 就走全站唯一订阅点；没有（旧宿主/单测）仍可直接订阅 mux。
    return bridge === undefined
      ? mux.onFrame(onFrame)
      : bridge.onFrame(onFrame as Parameters<typeof bridge.onFrame>[0])
  }, [mux, bridge, workspace, resyncRunning])

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
    listCache.ensureSeeded()
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
        listCache.writeList(key, { rows, cursor: page.nextCursor, hasMore: page.hasMore })
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
            listCache.writeList(String(workspace.workspaceId), { rows: next, cursor: page.nextCursor, hasMore: page.hasMore })
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
            listCache.writeList(String(workspace.workspaceId), { rows: next, cursor: cached.cursor, hasMore: cached.hasMore })
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
  const rowHandlers = (row: SessionView): SessionRowHandlers => ({
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
        listCache.writeList(String(workspace.workspaceId), { rows: next, cursor: cached.cursor, hasMore: cached.hasMore })
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

  // Sessions waiting on this user (approval/question). Read synchronously:
  // the mux mirror is a small Map, frames already re-render this view, and a
  // subscription would just duplicate the list's own frame handler.
  const pendingIds = new Set((mux?.pendingSnapshot?.() ?? []).map(entry => entry.sessionId))
  const folderOf = folders?.assignments ?? {}

  // Date-grouped roster: 置顶 → 今天 → 昨天 → 更早, newest first inside each bucket.
  const groups = useMemo(() => {
    const visible = rows.filter(row => {
      if (folderFilter === 'all') return true
      if (folderFilter === 'running') return row.running === true
      if (folderFilter === 'pending') return pendingIds.has(row.sessionId)
      return folderOf[row.sessionId] === folderFilter
    })
    const pinned = visible.filter(row => pinnedIds.has(row.sessionId))
    const rest = visible.filter(row => !pinnedIds.has(row.sessionId))
    const pinnedGroup = pinned.length > 0 ? [{ bucket: '置顶' as const, rows: pinned }] : []
    const dayGroups = DAY_BUCKETS
      .map(bucket => ({ bucket, rows: rest.filter(row => dayBucketFor(row.updatedAt) === bucket) }))
      .filter(group => group.rows.length > 0)
    return [...pinnedGroup, ...dayGroups]
    // previewTick: cached previews arrive async — recompute the filter when they land.
  }, [rows, previewTick, pinnedIds, folderFilter, folders, pendingIds.size])

  return (
    <div className="mobile">
      <SessionListHeader workspace={workspace} onBack={onBack} onOpenSettings={onOpenSettings} />
      {error !== undefined && <p className="mobile-error mobile-pad">{error}</p>}
      <SessionListCreate
        presets={presets}
        selectedPreset={selectedPreset}
        selectedPresetEntry={selectedPresetEntry}
        creating={creating}
        presetsLoading={presetsLoading}
        createError={createError}
        createHint={createHint}
        onCreate={() => { void handleCreate() }}
        onOpenPicker={() => { setPresetPickerOpen(true) }}
        onOpenHelp={() => { setPresetHelpOpen(true) }}
      />
      <SessionListFilters
        folderFilter={folderFilter}
        folders={folders}
        onSelect={setFolderFilter}
        counts={{
          all: rows.length,
          running: rows.filter(row => row.running).length,
        }}
      />
      <SessionListRoster
        loading={loading}
        rows={rows}
        groups={groups}
        hasMore={hasMore}
        openSwipeId={openSwipeId}
        previewCache={sessionPreviewCache}
        sentinelRef={sentinelRef}
        rowHandlers={rowHandlers}
        keepBottom={SESSION_CV_KEEP_BOTTOM}
        onLoadMore={() => { void loadMore(true) }}
        onDeleteRow={(row) => { setOpenSwipeId(undefined); setDeleting(row) }}
      />
      {presetPickerOpen && (
        <PresetPickerSheet
          presets={presets}
          selectedPreset={selectedPreset}
          onClose={() => { setPresetPickerOpen(false) }}
          onSelect={(id) => { setSelectedPreset(id); setPresetPickerOpen(false) }}
        />
      )}
      {presetHelpOpen && (
        <PresetHelpSheet
          presets={presets}
          selectedPreset={selectedPreset}
          onClose={() => { setPresetHelpOpen(false) }}
        />
      )}
      {menuSession !== undefined && (
        <SessionMenuSheet
          session={menuSession}
          pinned={pinnedIds.has(menuSession.sessionId)}
          onClose={() => { setMenuSession(undefined) }}
          onTogglePin={() => { togglePin(menuSession.sessionId); setMenuSession(undefined) }}
          onRename={() => { setMenuSession(undefined); setRenamingSession(menuSession) }}
          onMoveToFolder={() => { setMenuSession(undefined); setFolderSheetFor(menuSession) }}
          onDelete={() => { setMenuSession(undefined); setDeleting(menuSession) }}
        />
      )}
      {deleting !== undefined && (
        <DeleteSessionDialog
          session={deleting}
          onCancel={() => { setDeleting(undefined) }}
          onConfirm={() => { handleDeleteSession(deleting) }}
        />
      )}
      {folderSheetFor !== undefined && (
        <SessionFolderSheet
          folders={folders}
          onClose={() => { setFolderSheetFor(undefined) }}
          onAssign={(folderId) => { handleAssignFolder(folderSheetFor, folderId) }}
          onCreateFolder={() => { setFolderSheetFor(undefined); setCreatingFolder(true) }}
        />
      )}
      {renamingSession !== undefined && (
        <RenameSessionDialog
          session={renamingSession}
          onCancel={() => { setRenamingSession(undefined) }}
          onConfirm={handleRenameSession}
        />
      )}
      {creatingFolder && (
        <CreateFolderDialog
          onCancel={() => { setCreatingFolder(false) }}
          onConfirm={handleCreateFolder}
        />
      )}
    </div>
  )
}
