/**
 * Landing level: the workspace roster. The mobile surface opens straight
 * here — no new-session homepage — and every workspace row is a thin
 * fetch from workspace.list (the roster is small; sessions are not loaded
 * until a workspace is opened).
 *
 * UI (2026-08 refactor): a quick-action bar (search / pinned / recent), the
 * roster grouped by project kind (active = last opened, code, test) with a
 * 3px accent rail on the current workspace, type-tinted icons over mono
 * paths, a dashed create card + FAB, and a long-press action menu
 * (pin / rename / delete — rename+delete go through the host workspace RPCs;
 * pinning and the recent marker are local-only preferences).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'

/**
 * 上一次成功取到的工作区列表（跨挂载保留）。
 * workspace.list 在巨型工作区上可以慢到分钟级（宿主会扫描工作区与会话），而"从会话
 * 清单返回工作区列表"每次都会重新挂载并重新拉一次 ⇒ 返回时要干等很久（真机反馈）。
 * 有这份缓存就能先渲染、后台再刷新；首屏那条路同理（SessionListView 给它 2.5s 预算）。
 */
let workspaceRowsCache: WorkspaceRow[] | undefined
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { WorkspaceView as WorkspaceRow } from '../../api-proxy-types'
import { deleteWorkspace, listWorkspaces, listDirectory, createWorkspace, renameWorkspace, searchAll, searchMessages, searchSessions, type DirectoryListing, type DirectoryEntry, type SessionSearchHit } from '../api.ts'
import { errorText } from './App.tsx'
import { compactPath, dominantPathPrefix } from '../ui-text.ts'
import { lastPathSegment, matchText, normalizeTerm, type MatchRanges, type TextMatch } from '../search-match.ts'
import { rememberLocateIntent } from '../locate-intent.ts'
import { ThemeToggle } from '../theme-toggle.tsx'
import { Sheet } from '../sheet.tsx'
import { ConfirmDialog, PromptDialog } from '../dialog.tsx'
import { toast } from '../toast.tsx'
import { CheckIcon, ClockIcon, CloseIcon, FolderIcon, FolderPlusIcon, InboxIcon, PinIcon, PlusIcon, SearchIcon } from '../icons.tsx'

/* ── local preferences (pin / recent) ────────────────────────────────── */

const PINNED_KEY = 'dsh.palm.pinnedWorkspaces'
/** Ordered recent-workspace ids, newest first (v2 list format). */
const RECENTS_KEY = 'dsh.palm.recentWorkspaces'
/** Legacy single-value key (v1); read for one-time migration then dropped. */
const LEGACY_RECENT_KEY = 'dsh.palm.recentWorkspace'
/** First-run welcome card: shown once after pairing, dismissible. */
const WELCOME_KEY = 'dsh.palm.welcomeSeen'
/** How many recents are retained in storage. */
const RECENTS_LIMIT = 5
/** How many recents surface as the 活跃项目 group on the roster. */
export const ACTIVE_RECENT_LIMIT = 3
/** 搜索态每组最多显示几条：一屏之内给「最像的几条」，其余靠细化关键词。 */
const SEARCH_GROUP_LIMIT = 5

/**
 * 只给「连成一整段」的命中上色：子序列命中（「工区」命中「工作区」）会把几个
 * 不相干的单字涂黄，看起来像乱码，所以它只参与排序。
 */
function markable(match: TextMatch | undefined): MatchRanges | undefined {
  return match !== undefined && match.contiguous ? match.ranges : undefined
}

/**
 * 把命中区间标出来。区间来自 {@link matchText}，与排序用的是同一趟匹配，
 * 所以「排在前面的那条一定带黄」。
 */
function Marked({ text, ranges }: { text: string; ranges?: MatchRanges }): ReactElement {
  if (ranges === undefined || ranges.length === 0) return <>{text}</>
  const parts: ReactElement[] = []
  let cursor = 0
  ranges.forEach(([start, end], index) => {
    if (start > cursor) parts.push(<span key={`t${index}`}>{text.slice(cursor, start)}</span>)
    parts.push(<mark key={`m${index}`} className="search-mark">{text.slice(start, end)}</mark>)
    cursor = end
  })
  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>)
  return <>{parts}</>
}

/** Read the pinned workspace id list (localStorage, best effort). */
function readPinned(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY)
    const parsed: unknown = raw === null ? [] : JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writePinned(ids: string[]): void {
  try { localStorage.setItem(PINNED_KEY, JSON.stringify(ids)) } catch { /* non-fatal */ }
}

/** Dedupe an id list preserving first-occurrence order, capped at the limit. */
function capRecents(ids: readonly string[]): string[] {
  const out: string[] = []
  for (const id of ids) {
    if (out.includes(id)) continue
    out.push(id)
    if (out.length >= RECENTS_LIMIT) break
  }
  return out
}

/**
 * Read the ordered recent-workspace list (newest first, bounded). The v1
 * format was a single plain-text id under another key; a v1 value found here
 * migrates once into the list key and the legacy key is removed.
 */
function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) return capRecents(parsed.filter((id): id is string => typeof id === 'string'))
    }
  } catch { /* fall through to migration */ }
  // v1 single-value migration: `recentWorkspace` held one plain id.
  try {
    const legacy = localStorage.getItem(LEGACY_RECENT_KEY)
    if (legacy !== null && legacy !== '') {
      const migrated = capRecents([legacy])
      localStorage.setItem(RECENTS_KEY, JSON.stringify(migrated))
      localStorage.removeItem(LEGACY_RECENT_KEY)
      return migrated
    }
  } catch { /* non-fatal */ }
  return []
}

function writeRecents(ids: readonly string[]): void {
  const capped = capRecents(ids)
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(capped)) } catch { /* non-fatal */ }
}

/** Move one id to the front of the list (a fresh open) and persist. */
function pushRecent(ids: readonly string[], id: string): string[] {
  const next = capRecents([id, ...ids.filter(existing => existing !== id)])
  writeRecents(next)
  return next
}

/** Drop one id (workspace deleted) and persist. */
function removeRecent(ids: readonly string[], id: string): string[] {
  const next = ids.filter(existing => existing !== id)
  writeRecents(next)
  return next
}

/* ── project-kind classification ─────────────────────────────────────── */

/** Project kind driving icon tint + roster grouping. */
type WorkspaceKind = 'active' | 'code' | 'plain'

/**
 * 首页搜索结果拍平后的一行：标题命中没有 message；正文命中的每一行带一条具体消息
 * （同会话的第 1/2 条各自成行，点哪条跳哪条）。`ordinal` 是这个会话内的第几条，
 * 用来显示「2/2」角标 —— 别拿行下标当它，那会显示成「11/2」。
 */
type HomeSearchRow = { kind: 'title' | 'message'; hit: SessionSearchHit; message?: NonNullable<SessionSearchHit['messages']>[number]; ordinal?: number; copies?: SessionSearchHit[] }

/** Heuristic split: the most-recently opened workspaces (up to
 *  {@link ACTIVE_RECENT_LIMIT}) are "active"; workspaces without any session
 *  yet stay "plain" gray; everything else is a code project.
 *
 *  2026-10-29: 首页不再单列「测试项目」。按 path/title 里的 test/spec/benchmark
 *  分词来分组，实际效果是把正经项目也误判成测试项目（本仓自己的路径里就带一个 test 段），
 *  `test` 段就会掉进那一组），分区标题反而成了噪音 —— 这类工作区现在归到代码项目。 */
export function workspaceKind(workspace: WorkspaceRow, recents: readonly string[]): WorkspaceKind {
  if (recents.slice(0, ACTIVE_RECENT_LIMIT).includes(workspace.workspaceId)) return 'active'
  if ((workspace.sessionIds ?? []).length === 0) return 'plain'
  return 'code'
}

const KIND_LABEL: Record<WorkspaceKind, string> = {
  active: '活跃项目',
  code: '代码项目',
  plain: '其他',
}

const KIND_ICON_CLASS: Record<WorkspaceKind, string> = {
  active: 'ws-icon-active',
  code: 'ws-icon-code',
  plain: 'ws-icon-plain',
}

/** Roster group order + the empty-group placeholder copy. */
const GROUP_ORDER: ReadonlyArray<{ kind: WorkspaceKind; placeholder: string | null }> = [
  { kind: 'active', placeholder: null },
  { kind: 'code', placeholder: '暂无代码项目' },
  { kind: 'plain', placeholder: null },
]

/* ── directory browser (create flow) ─────────────────────────────────── */

/** Props for the directory browser. */
interface DirectoryBrowserProps {
  onCancel(): void
  onPick(workspace: WorkspaceRow): void
}

/**
 * Render the directory browser for creating a new workspace.
 */
function DirectoryBrowser({ onCancel, onPick }: DirectoryBrowserProps) {
  const [listing, setListing] = useState<DirectoryListing | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [creating, setCreating] = useState(false)
  const [path, setPath] = useState<string | undefined>(undefined)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError(undefined)
    setListing(undefined)
    void listDirectory(path).then(
      (res) => {
        if (cancelled) return
        setListing(res)
      },
      (reason: unknown) => {
        if (cancelled) return
        setError(errorText(reason))
      },
    )
    return () => { cancelled = true }
  }, [path, reload])

  const handleCreate = async () => {
    if (listing === undefined || creating) return
    setCreating(true)
    setError(undefined)
    try {
      const result = await createWorkspace(listing.path)
      onPick(result.workspace)
    } catch (reason: unknown) {
      setCreating(false)
      setError(errorText(reason))
    }
  }

  return (
    <div className="mobile dir-browser">
      <header className="mobile-header">
        <div className="mobile-headerSlot">
          <button type="button" className="mobile-headerAction" onClick={onCancel}>返回</button>
        </div>
        <h1 className="mobile-title">选择目录</h1>
        <div className="mobile-headerSlot mobile-headerSlot-right" />
      </header>

      {listing !== undefined && (
        <div className="dir-crumbs">
          {listing.crumbs.map((crumb, idx) => (
            <span key={crumb.path}>
              <button
                type="button"
                className="dir-crumb"
                onClick={() => setPath(crumb.path)}
              >
                {crumb.name || '/'}
              </button>
              {idx < listing.crumbs.length - 1 && <span className="dir-crumb-separator">/</span>}
            </span>
          ))}
        </div>
      )}

      {error !== undefined ? (
        <div className="mobile-empty">
          <p className="mobile-error">{error}</p>
          <button type="button" className="mobile-button" onClick={() => setReload(n => n + 1)}>重试</button>
        </div>
      ) : listing === undefined ? (
        <div className="mobile-empty">
          <p className="mobile-muted">加载中…</p>
        </div>
      ) : (
        <ul className="mobile-list">
          {listing.entries.length === 0 ? (
            <div className="mobile-empty dir-empty">
              <p className="mobile-muted">空目录</p>
            </div>
          ) : (
            listing.entries.map((entry: DirectoryEntry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  className={`mobile-row dir-entry ${entry.hidden ? 'dir-entry-hidden' : ''}`}
                  onClick={() => setPath(entry.path)}
                >
                  <span className="mobile-rowMain">
                    <span className="mobile-rowTitle">{entry.name}</span>
                  </span>
                  <span className="mobile-chevron" aria-hidden>›</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      <div className="dir-select">
        <button
          type="button"
          className="mobile-button"
          // listing 还没读出来时不再禁用（禁用＝点了没反应，用户不知道该怎么办）：
          // 这时点一下就是**重新读目录**，读到就能建。（2026-10-29 一批死按钮排查）
          disabled={creating}
          onClick={() => {
            if (listing === undefined) {
              toast('还没读到这个目录，正在重试…')
              return
            }
            void handleCreate()
          }}
        >
          {creating ? '创建中…' : listing === undefined ? '重新读取目录' : '选择此目录'}
        </button>
      </div>
    </div>
  )
}

/* ── long-press action menu ──────────────────────────────────────────── */

/** The workspace the long-press menu is open for. */
interface MenuTarget {
  workspace: WorkspaceRow
}

/** Props for the workspace action menu. */
interface WorkspaceMenuProps {
  target: MenuTarget
  pinned: boolean
  onClose(): void
  onPinnedChange(): void
  onRename(workspace: WorkspaceRow): void
  onDelete(workspace: WorkspaceRow): void
}

/** Long-press menu: pin toggle, rename, delete (bottom sheet, one column). */
function WorkspaceMenu({ target, pinned, onClose, onPinnedChange, onRename, onDelete }: WorkspaceMenuProps) {
  const { workspace } = target
  const actions: Array<{ key: string; label: string; danger?: boolean; run(): void }> = [
    {
      key: 'pin',
      label: pinned ? '取消固定' : '固定到顶部',
      run: () => { onPinnedChange() },
    },
    { key: 'rename', label: '重命名', run: () => { onRename(workspace) } },
    { key: 'delete', label: '删除工作区', danger: true, run: () => { onDelete(workspace) } },
  ]
  return (
    <Sheet title={workspace.title} onClose={onClose}>
      <div role="menu" aria-label={`工作区操作：${workspace.title}`}>
        {actions.map(action => (
          <button
            key={action.key}
            type="button"
            role="menuitem"
            className="sheet-option"
            onClick={() => { onClose(); action.run() }}
          >
            <span className="sheet-option-copy">
              <span className="sheet-option-title" style={action.danger ? { color: 'var(--danger)' } : undefined}>
                {action.label}
              </span>
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}

/* ── skeleton + empty states ─────────────────────────────────────────── */

/** Three shimmering placeholder cards while the roster loads. */
function RosterSkeleton() {
  return (
    <div aria-hidden="true" role="presentation">
      {[0, 1, 2].map(index => (
        <div className="skel-row" key={index}>
          <div className="skel skel-icon" />
          <div className="skel-lines">
            <div className="skel skel-line-title" />
            <div className="skel skel-line-sub" />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── workspace roster ────────────────────────────────────────────────── */

/** Props for the workspace roster. */
export interface WorkspaceViewProps {
  /** Workspace carried by the pairing link; opened after the roster loads. */
  initialWorkspaceId?: string
  /** Open one workspace's session list. */
  onPick(workspace: WorkspaceRow): void
  /** Locate a search hit's session (in-app navigation across workspaces). */
  onLocateSession?(sessionId: string, workspaceId: string, seq?: number, query?: string, messageId?: string, partId?: string): void
  /** Open a search hit that belongs to NO workspace (standalone session):
   *  the app opens the chat directly — the last resort for unattributable
   *  hits, instead of a dead label + toast. */
  onOpenDirect?(hit: { sessionId: string; title?: string; snippet?: string }, seq?: number, query?: string, messageId?: string, partId?: string): void
  /** Restore the search surface when the app returns here after a search-hit
   *  locate (open + term). Consumed once on mount. */
  initialSearch?: { open: boolean; term: string }
  /** Report the live search-surface state so the app can restore it the next
   *  time the user returns from a located chat. */
  onSearchSnapshot?(open: boolean, term: string): void
  /** The app cleared its one-shot restore (called after initialSearch is
   *  applied), so a later manual visit does not restore the search again. */
  onSearchApplied?(): void
  /** Open the global run-overview page (cross-session background tasks). */
  onOpenRunOverview?(): void
  /** Current live background-task count across all sessions (badge on the
   *  run-overview quick chip; undefined hides the count). */
  runOverviewLive?: number
}

/**
 * Render the workspace roster.
 * @param props - the pick action.
 * @returns the roster.
 */
export function WorkspaceView({ initialWorkspaceId, onPick, onLocateSession, onOpenDirect, initialSearch, onSearchSnapshot, onSearchApplied, onOpenRunOverview, runOverviewLive }: WorkspaceViewProps) {
  const [items, setItems] = useState<WorkspaceRow[] | undefined>(() => workspaceRowsCache)
  const [error, setError] = useState<string | undefined>(undefined)
  // Bumped by the retry button to re-run the roster fetch effect.
  const [reload, setReload] = useState(0)
  const [isCreating, setIsCreating] = useState(false)
  // Quick-bar state: search field, pinned-only filter, recent jump.
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  // Restore the search surface once, when the app returns from a located chat.
  const appliedInitialSearchRef = useRef(false)
  useEffect(() => {
    if (appliedInitialSearchRef.current) return
    if (initialSearch !== undefined && initialSearch.open) {
      appliedInitialSearchRef.current = true
      setSearchOpen(true)
      setSearch(initialSearch.term)
      onSearchApplied?.()
    }
  }, [initialSearch, onSearchApplied])
  // Report the live search-surface state so the app can restore it on return.
  useEffect(() => {
    onSearchSnapshot?.(searchOpen, search)
  }, [searchOpen, search, onSearchSnapshot])
  /** Global session hits (the home search spans workspaces, with attribution). */
  const [globalHits, setGlobalHits] = useState<SessionSearchHit[]>([])
  const [globalBusy, setGlobalBusy] = useState(false)
  const [globalDone, setGlobalDone] = useState(false)
  /** 还有下一页：底部给「加载更多」，而不是叫用户自己细化关键词。 */
  const [globalMore, setGlobalMore] = useState(false)
  const [globalNextOffset, setGlobalNextOffset] = useState(0)
  const [globalLoadingMore, setGlobalLoadingMore] = useState(false)
  /** 结果缓存（LRU，最多 20 个词）：来回改词不重复请求，也不闪。 */
  const searchCacheRef = useRef<Map<string, { items: SessionSearchHit[]; hasMore: boolean; nextOffset: number }>>(new Map())
  /** 输入法组词期间不发请求：中文拼音打到一半的串搜出来全是噪音。 */
  const [composing, setComposing] = useState(false)
  /** 键盘选中行（上下键 + 回车打开第一条）。 */
  const [activeHit, setActiveHit] = useState(0)
  /** The host's substring backfill covered only the most recent sessions:
   *  an empty (or short) result must not read as "not on host". */
  const [globalPartial, setGlobalPartial] = useState(false)
  /** The search hit currently locating its first matched message. */
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [pinned, setPinned] = useState<string[]>(() => readPinned())
  /** Ordered recent workspace ids (newest first); the first few render as the
   *  活跃项目 group and the jump chip targets the newest. */
  const [recents, setRecents] = useState<readonly string[]>(() => readRecents())
  // Long-press menu + confirm/prompt dialogs.
  const [menu, setMenu] = useState<MenuTarget | undefined>(undefined)
  const [renaming, setRenaming] = useState<WorkspaceRow | undefined>(undefined)
  const [deleting, setDeleting] = useState<WorkspaceRow | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  // Long-press detection: 500ms touch hold, cancelled on move/end.
  const pressTimerRef = useRef<number | undefined>(undefined)

  // First-run welcome card (dismissed once, stored on the device).
  const [welcomeHidden, setWelcomeHidden] = useState(() => {
    try { return localStorage.getItem(WELCOME_KEY) === '1' } catch { return false }
  })
  const dismissWelcome = (): void => {
    setWelcomeHidden(true)
    try { localStorage.setItem(WELCOME_KEY, '1') } catch { /* non-fatal */ }
  }

  /**
   * 一次搜索（首页）：走宿主索引，每个会话最多 2 条命中一起带回来。
   * 索引还没建好（`fallback: true`）就退回旧入口 mobile.searchAll —— 绝不显示空结果
   * 骗用户说「没有」。
   */
  const runSearch = useCallback(async (term: string, offset: number): Promise<{ items: SessionSearchHit[]; hasMore: boolean; nextOffset: number; partial: boolean }> => {
    const indexed = await searchSessions({ query: term, perSession: 2, sessions: 12, offset })
    if (indexed.fallback !== true) {
      // 索引路径的 snippet 声明成可选，落到展示层统一成「必有字符串」，省得每处都判空。
      const items: SessionSearchHit[] = indexed.items.map(item => ({ ...item, snippet: item.snippet ?? '' }))
      return { items, hasMore: indexed.hasMore, nextOffset: indexed.nextOffset ?? offset + 12, partial: false }
    }
    const legacy = await searchAll(term)
    return { items: legacy.items, hasMore: legacy.hasMore, nextOffset: offset + 12, partial: legacy.partial === true }
  }, [])

  const applySearchResult = useCallback((result: { items: SessionSearchHit[]; hasMore: boolean; nextOffset: number; partial: boolean }, append: boolean): void => {
    setGlobalHits(current => {
      if (!append) return result.items
      // 「加载更多」翻页重复：宿主那边的候选池会随页偏移变化，同一会话可能两次都
      // 出现在结果里。列表里出现两行一模一样的结果，用户只会以为搜索坏了；按
      // 「会话 + 消息 seq」去重，翻页只追加真正新的那几条。
      const seen = new Set(current.map(item => `${item.sessionId}#${item.seq ?? ''}#${item.kind}`))
      return [...current, ...result.items.filter(item => {
        const key = `${item.sessionId}#${item.seq ?? ''}#${item.kind}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })]
    })
    setGlobalMore(result.hasMore)
    setGlobalNextOffset(result.nextOffset)
    setGlobalPartial(result.partial)
    setGlobalDone(true)
    setGlobalBusy(false)
    setGlobalLoadingMore(false)
    setActiveHit(0)
  }, [])

  // Global session search: debounced host lookup, independent of the local
  // workspace-name filter; hits render as their own groups with locate links.
  useEffect(() => {
    const term = search.trim()
    if (term === '') {
      setGlobalHits([])
      setGlobalDone(false)
      setGlobalBusy(false)
      setGlobalMore(false)
      setGlobalNextOffset(0)
      setGlobalLoadingMore(false)
      setGlobalPartial(false)
      return
    }
    // 组词中：先亮「正在搜索」，等 compositionend 再真正发请求。
    if (composing) {
      setGlobalBusy(true)
      return
    }
    const cached = searchCacheRef.current.get(term)
    if (cached !== undefined) {
      // 命中缓存：立刻显示，并把这条移到 LRU 末尾。
      searchCacheRef.current.delete(term)
      searchCacheRef.current.set(term, cached)
      applySearchResult({ ...cached, nextOffset: cached.nextOffset, partial: false }, false)
      return
    }
    setGlobalBusy(true)
    setGlobalDone(false)
    setGlobalPartial(false)
    let cancelled = false
    // 150ms：比原来的 250ms 更跟手，又够吃掉连续键入。
    const timer = setTimeout(() => {
      void runSearch(term, 0).then(
        (result) => {
          if (cancelled) return
          searchCacheRef.current.set(term, { items: result.items, hasMore: result.hasMore, nextOffset: result.nextOffset })
          while (searchCacheRef.current.size > 20) {
            const oldest = searchCacheRef.current.keys().next().value
            if (oldest === undefined) break
            searchCacheRef.current.delete(oldest)
          }
          applySearchResult(result, false)
        },
        () => {
          if (!cancelled) {
            setGlobalHits([])
            setGlobalDone(true)
            setGlobalBusy(false)
          }
        },
      )
    }, 150)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [search, composing, runSearch, applySearchResult])

  /** 底部「加载更多」：同一关键词往后翻一页，追加而不是替换。 */
  const loadMoreHits = (): void => {
    const term = search.trim()
    if (term === '' || globalLoadingMore) return
    setGlobalLoadingMore(true)
    void runSearch(term, globalNextOffset).then(
      result => { if (search.trim() === term) applySearchResult(result, true) },
      () => { setGlobalLoadingMore(false) },
    )
  }

  /** Open a search hit straight to its first matched message: lazy message
   *  locate for the seq (cached), then in-app/deep-link navigation. A missed
   *  locate degrades to opening the session. A tap on another hit supersedes
   *  the in-flight locate (the loser neither navigates nor clears the
   *  indicator), and a late locate result after the degrade path never
   *  double-fires the navigation. */
  const locateHit = (hit: SessionSearchHit, term: string): void => {
    // 先把意图记在模块里：这一路要穿过 5 层组件，任何一层丢字段都会变成
    // 「进去了、滚了、但没有高亮」。聊天页挂载时自己来取这一份。
    rememberLocateIntent({ sessionId: hit.sessionId, seq: hit.seq, messageId: hit.messageId, partId: hit.partId, query: term })
    if (hit.kind === 'message' && hit.seq !== undefined) {
      locateSession(hit, hit.seq, term, hit.messageId, hit.partId)
      return
    }
    // A message hit without a seq, or a TITLE hit (session name matched):
    // resolve the first message containing the term so the tap still jumps
    // to the relevant message instead of opening the session at the tail.
    void searchMessages(hit.sessionId, term).then(
      (result) => {
        const first = result.items[0]
        // 标题命中没有 seq：解出第一条正文命中的 seq 之后要**重记**意图，否则
        // 聊天页只能从尾页一路往回追，追不到就是「进去了但没有高亮」。
        rememberLocateIntent({ sessionId: hit.sessionId, seq: first?.seq, messageId: first?.messageId, partId: first?.partId, query: term })
        locateSession(hit, first?.seq, term, first?.messageId, first?.partId)
      },
      () => { locateSession(hit, undefined, term) },
    )
  }

  /** Resolve a search hit's owning workspace: prefer the host attribution,
   *  fall back to the LOCAL roster's attach relation (this phone already
   *  holds every workspace with its sessionIds — immune to host
   *  attribution gaps). The host-resolved workspace title labels the row
   *  even before the roster finishes loading. */
  const resolveOwner = (hit: { sessionId: string; workspaceId?: string; workspaceTitle?: string }): { workspaceId?: string; title?: string } => {
    if (hit.workspaceId !== undefined) {
      const byId = (items ?? []).find(workspace => workspace.workspaceId === hit.workspaceId)
      return { workspaceId: hit.workspaceId, title: byId?.title ?? hit.workspaceTitle }
    }
    const byAttach = (items ?? []).find(workspace =>
      (workspace.sessionIds ?? []).map(String).includes(hit.sessionId))
    return byAttach === undefined
      ? {}
      : { workspaceId: byAttach.workspaceId, title: byAttach.title }
  }

  /** Locate a global search hit: in-app navigation when the parent offers it,
   *  deep link as the standalone fallback. An optional message seq scrolls the
   *  session straight to the matched message. A hit that belongs to NO
   *  workspace (standalone session) opens directly through the parent's
   *  onOpenDirect instead of dying with a toast. */
  const locateSession = (hit: { sessionId: string; workspaceId?: string; title?: string; snippet?: string; messageId?: string; partId?: string }, seq?: number, query?: string, messageId?: string, partId?: string): void => {
    const owner = resolveOwner(hit)
    if (owner.workspaceId !== undefined && onLocateSession !== undefined) {
      const stableMessageId = messageId ?? hit.messageId
      const stablePartId = partId ?? hit.partId
      onLocateSession(
        hit.sessionId,
        owner.workspaceId,
        seq,
        query,
        ...([stableMessageId, stablePartId].some(value => value !== undefined) ? [stableMessageId, stablePartId] : []),
      )
      return
    }
    if (owner.workspaceId === undefined) {
      if (onOpenDirect !== undefined) {
        const stableMessageId = messageId ?? hit.messageId
        const stablePartId = partId ?? hit.partId
        onOpenDirect(
          hit,
          seq,
          query,
          ...([stableMessageId, stablePartId].some(value => value !== undefined) ? [stableMessageId, stablePartId] : []),
        )
        return
      }
      toast('未找到该会话所属的工作区')
      return
    }
    const url = new URL(window.location.href)
    url.searchParams.set('workspace', owner.workspaceId)
    url.searchParams.set('session', hit.sessionId)
    if (seq !== undefined) url.searchParams.set('seq', String(seq))
    window.location.href = `${url.pathname}${url.search}`
  }

  useEffect(() => {
    let cancelled = false
    void listWorkspaces().then(
      (rows) => {
        if (cancelled) return
        const target = initialWorkspaceId === undefined
          ? undefined
          : rows.find(workspace => workspace.workspaceId === initialWorkspaceId)
        if (target !== undefined) {
          onPick(target)
          return
        }
        workspaceRowsCache = rows
        setItems(rows)
      },
      (reason: unknown) => {
        if (cancelled) return
        setError(errorText(reason))
      },
    )
    return () => { cancelled = true }
  }, [initialWorkspaceId, onPick, reload])

  /** Open a workspace: remember it as the most recent one first. */
  const pick = useCallback((workspace: WorkspaceRow) => {
    setRecents(previous => pushRecent(previous, workspace.workspaceId))
    onPick(workspace)
  }, [onPick])

  /** Jump straight into the newest-opened workspace. */
  const jumpRecent = useCallback(() => {
    const newest = recents[0]
    const target = newest === undefined ? undefined : items?.find(workspace => workspace.workspaceId === newest)
    if (target === undefined) {
      toast('还没有访问记录')
      return
    }
    pick(target)
  }, [items, recents, pick])

  const clearPressTimer = useCallback(() => {
    if (pressTimerRef.current !== undefined) {
      clearTimeout(pressTimerRef.current)
      pressTimerRef.current = undefined
    }
  }, [])

  useEffect(() => () => { clearPressTimer() }, [clearPressTimer])

  // The workspace id whose long-press has fired; the browser still emits a
  // trailing click after the touch, which must be swallowed — navigating
  // AND opening the menu is a race the user sees as "the row jumps away".
  const pressConsumedRef = useRef<string | undefined>(undefined)

  /** Long-press (touch) opens the action menu; contextmenu covers mouse. */
  const pressHandlers = (workspace: WorkspaceRow) => ({
    onTouchStart: () => {
      clearPressTimer()
      pressConsumedRef.current = undefined
      pressTimerRef.current = window.setTimeout(() => {
        pressTimerRef.current = undefined
        pressConsumedRef.current = workspace.workspaceId
        setMenu({ workspace })
      }, 500)
    },
    onTouchMove: clearPressTimer,
    onTouchEnd: clearPressTimer,
    onClick: (event: ReactMouseEvent) => {
      if (pressConsumedRef.current === workspace.workspaceId) {
        // Long-press just opened the menu for THIS row: drop the trailing
        // click instead of navigating.
        pressConsumedRef.current = undefined
        event.preventDefault()
        return
      }
      pick(workspace)
    },
    onContextMenu: (event: ReactMouseEvent) => {
      event.preventDefault()
      setMenu({ workspace })
    },
  })

  const togglePin = useCallback((workspace: WorkspaceRow) => {
    const wasPinned = pinned.includes(workspace.workspaceId)
    const next = wasPinned
      ? pinned.filter(id => id !== workspace.workspaceId)
      : [...pinned, workspace.workspaceId]
    setPinned(next)
    writePinned(next)
    toast(wasPinned ? '已取消固定' : '已固定')
  }, [pinned])

  const handleRename = useCallback(async (workspace: WorkspaceRow, title: string) => {
    setBusy(true)
    try {
      const { workspace: updated } = await renameWorkspace(workspace.workspaceId, title)
      setItems(previous => previous?.map(row => row.workspaceId === updated.workspaceId ? updated : row) ?? previous)
      setRenaming(undefined)
      toast('已重命名')
    } catch (reason: unknown) {
      toast(errorText(reason))
    } finally {
      setBusy(false)
    }
  }, [])

  const handleDelete = useCallback(async (workspace: WorkspaceRow) => {
    setBusy(true)
    try {
      await deleteWorkspace(workspace.workspaceId)
      setItems(previous => previous?.filter(row => row.workspaceId !== workspace.workspaceId) ?? previous)
      // Deleting a recent workspace must not leave a dangling entry (the jump
      // chip / active group would point at a workspace that no longer exists).
      setRecents(previous => removeRecent(previous, workspace.workspaceId))
      setDeleting(undefined)
      toast('已删除工作区（目录与会话保留）')
    } catch (reason: unknown) {
      toast(errorText(reason))
    } finally {
      setBusy(false)
    }
  }, [])

  if (isCreating) {
    return (
      <DirectoryBrowser
        onCancel={() => setIsCreating(false)}
        onPick={pick}
      />
    )
  }

  // 搜索态：名称与路径都参与匹配，按打分排序（见 search-match.ts 的分档规则）。
  // 空查询保持原来的分组与最近使用顺序 —— 搜索不该改变「没在搜」时的样子。
  const term = normalizeTerm(search)
  const searchMode = term !== ''
  const matches = new Map<string, { score: number; title?: MatchRanges; path?: MatchRanges }>()
  const visible = (items ?? [])
    .filter(workspace => !pinnedOnly || pinned.includes(workspace.workspaceId))
    .filter((workspace) => {
      if (!searchMode) return true
      const byTitle = matchText(workspace.title, term)
      if (byTitle !== undefined) {
        matches.set(workspace.workspaceId, { score: byTitle.score, ...(byTitle.contiguous ? { title: byTitle.ranges } : {}) })
        return true
      }
      const byPath = matchText(lastPathSegment(workspace.path), term)
      if (byPath === undefined) return false
      matches.set(workspace.workspaceId, { score: byPath.score, path: byPath.ranges })
      return true
    })
  // Path compression: hide the parent prefix most roster rows share.
  const pathPrefix = dominantPathPrefix((items ?? []).map(workspace => workspace.path))
  // Pinned workspaces float to the top inside their kind group; while searching,
  // the match score leads and pinning only breaks ties.
  const ordered = [...visible].sort((a, b) => {
    const pinA = pinned.includes(a.workspaceId) ? 0 : 1
    const pinB = pinned.includes(b.workspaceId) ? 0 : 1
    if (searchMode) {
      const scoreA = matches.get(a.workspaceId)?.score ?? 0
      const scoreB = matches.get(b.workspaceId)?.score ?? 0
      if (scoreA !== scoreB) return scoreB - scoreA
    }
    return pinA - pinB
  })
  // The active group renders in recency order (newest first); pinned rows
  // still lead it. Other groups keep the host's stable order.
  const recentOrder = new Map(recents.map((id, index) => [id, index]))
  const groups: Array<{ kind: WorkspaceKind; rows: WorkspaceRow[] }> = searchMode
    // 搜索态不按项目类型分组：命中多少就排多少（分高的在前），分组会把
    // 「最像的那条」拆到三个标题下面，反而更难找。
    ? (ordered.length === 0
        ? []
        : [{ kind: GROUP_ORDER[0]!.kind, rows: ordered.slice(0, SEARCH_GROUP_LIMIT) }])
    : GROUP_ORDER
      .map(({ kind }) => ({
        kind,
        rows: kind === 'active'
          ? ordered
            .filter(workspace => workspaceKind(workspace, recents) === kind)
            .sort((a, b) => {
              const pinA = pinned.includes(a.workspaceId) ? 0 : 1
              const pinB = pinned.includes(b.workspaceId) ? 0 : 1
              if (pinA !== pinB) return pinA - pinB
              return (recentOrder.get(a.workspaceId) ?? Infinity) - (recentOrder.get(b.workspaceId) ?? Infinity)
            })
          : ordered.filter(workspace => workspaceKind(workspace, recents) === kind),
      }))
      .filter(group => group.rows.length > 0)
  const hiddenWorkspaces = searchMode ? Math.max(0, ordered.length - SEARCH_GROUP_LIMIT) : 0
  const emptyPlaceholders = GROUP_ORDER.filter(({ kind, placeholder }) =>
    placeholder !== null && !ordered.some(workspace => workspaceKind(workspace, recents) === kind))
  const pinnedCount = pinned.length
  // 首页全局结果拍平成「行」：会话名命中一行；正文命中**每条消息一行**（同一会话的
  // 第 1/2/3 条各自可点，直接跳到那一条），这也是「消息」这一组名的本义。
  const globalTitleRows: HomeSearchRow[] = globalHits.filter(hit => hit.kind !== 'message').map(hit => ({ kind: 'title', hit }))
  const globalMessageRows: HomeSearchRow[] = (() => {
    // ordinal 按会话各自计数（1、2…），行下标在整页里是全局的，混用会显示成「11/2」。
    const ordinals = new Map<string, number>()
    const rows: HomeSearchRow[] = []
    for (const hit of globalHits) {
      if (hit.kind !== 'message') continue
      const list = hit.messages !== undefined && hit.messages.length > 0 ? hit.messages : undefined
      if (list === undefined) {
        rows.push({ kind: 'message', hit })
        continue
      }
      for (const message of list) {
        const ordinal = (ordinals.get(hit.sessionId) ?? 0) + 1
        ordinals.set(hit.sessionId, ordinal)
        rows.push({ kind: 'message', hit, message, ordinal })
      }
    }
    // fork 出来的副本会话：同一段历史在几个 session id 下各存一份，索引里就是几条
    // 完全相同的结果（真机「失败」87 个会话命中、第二页 24 行里 39 行和已有行一字不差）。
    // 按「消息 + 摘要」合并成一行，副本数记在副本上；代表行优先取有标题的那份
    // （副本里有的有标题、有的是「未命名会话」，按标题做 key 就合不到一起）。
    const groups = new Map<string, { rows: HomeSearchRow[] }>()
    const order: string[] = []
    for (const row of rows) {
      // 用**正文段落**当 key：副本会话是 fork 出来的副本，message id / seq 会各算各的，
      // 只有正文一模一样。段落是索引按空行切出来的整块，比摘要窗口具体得多。
      const body = (row.message?.paragraph ?? row.hit.paragraph ?? row.message?.snippet ?? row.hit.snippet ?? '').trim()
      const key = body !== '' ? body : `${row.message?.messageId ?? row.hit.seq ?? ''}#${row.hit.sessionId}`
      const bucket = groups.get(key)
      if (bucket === undefined) {
        groups.set(key, { rows: [row] })
        order.push(key)
        continue
      }
      bucket.rows.push(row)
    }
    return order.map(key => {
      const bucket = groups.get(key)!
      const representative = bucket.rows.find(entry => (entry.hit.title ?? '').trim() !== '') ?? bucket.rows[0]!
      const others = bucket.rows.filter(entry => entry !== representative)
      return others.length === 0 ? representative : { ...representative, copies: others.map(entry => entry.hit) }
    })
  })()
  const searchTotal = globalTitleRows.length + globalMessageRows.length

  const body = (() => {
    if (error !== undefined) {
      return (
        <div className="mobile-empty">
          <div className="empty-icon"><InboxIcon /></div>
          <p className="empty-title">加载失败</p>
          <p className="empty-desc">{error}</p>
          <button
            type="button"
            className="mobile-button"
            onClick={() => { setError(undefined); setItems(undefined); setReload(n => n + 1) }}
          >
            重试
          </button>
        </div>
      )
    }
    if (items === undefined) {
      return <RosterSkeleton />
    }
    if (visible.length === 0) {
      if (pinnedOnly && pinnedCount === 0) {
        return (
          <div className="mobile-empty">
            <div className="empty-icon"><PinIcon /></div>
            <p className="empty-title">还没有固定的工作区</p>
            <p className="empty-desc">长按工作区卡片即可固定，固定后会置顶显示</p>
          </div>
        )
      }
      if (term !== '') {
        // The home search spans workspaces: only the empty state once the
        // global session lookup has settled AND found nothing either.
        if (globalBusy) {
          return (
            <div className="mobile-empty">
              <div className="empty-icon"><SearchIcon /></div>
              <p className="empty-title">正在搜索全部会话…</p>
            </div>
          )
        }
        if (globalDone && globalHits.length === 0) {
          return (
            <div className="mobile-empty">
              <div className="empty-icon"><SearchIcon /></div>
              <p className="empty-title">没有匹配的工作区或会话</p>
              <p className="empty-desc">
                工作区按名称与目录名匹配，会话按名称与可见正文匹配
                {globalPartial && <>；更早的会话未在本次扫描范围内</>}
              </p>
            </div>
          )
        }
        // 会话命中存在：落进下方列表渲染（工作区组为空，仅会话组显示）
      } else {
        return (
          <div className="mobile-empty">
            <div className="empty-icon"><FolderPlusIcon /></div>
            <p className="empty-title">暂无工作区</p>
            <p className="empty-desc">新建一个工作区，把项目目录挂进来就能开始会话</p>
          </div>
        )
      }
    }
    return (
      <ul className="mobile-list">
        {groups.map(group => (
          <li key={group.kind} style={{ listStyle: 'none' }}>
            <div className="mobile-groupTitle">{searchMode ? '工作区' : KIND_LABEL[group.kind]}</div>
            {group.rows.map(workspace => {
              const kind = workspaceKind(workspace, recents)
              const isPinned = pinned.includes(workspace.workspaceId)
              const count = (workspace.sessionIds ?? []).length
              return (
                <button
                  type="button"
                  key={workspace.workspaceId}
                  className={`mobile-row${kind === 'active' ? ' mobile-row-active' : ''}`}
                  {...pressHandlers(workspace)}
                >
                  <span className={`ws-icon ${KIND_ICON_CLASS[kind]}`}>
                    <span aria-hidden><FolderIcon /></span>
                  </span>
                  <span className="card-main">
                    <span className="card-title">
                      <span className="card-titleText"><Marked text={workspace.title} ranges={matches.get(workspace.workspaceId)?.title} /></span>
                      {isPinned && <span className="ws-pin" aria-label="已固定"><PinIcon /></span>}
                    </span>
                    <span className="card-subtitle">{compactPath(workspace.path, pathPrefix)}</span>
                  </span>
                  <span className="card-action">
                    {count > 0 && <span className="card-badge">{count} 个会话</span>}
                    <span className="mobile-chevron" aria-hidden>›</span>
                  </span>
                </button>
              )
            })}
          </li>
        ))}
        {hiddenWorkspaces > 0 && (
          <li style={{ listStyle: 'none' }}>
            <p className="search-hitsNote mobile-pad">另有 {hiddenWorkspaces} 个工作区命中——细化关键词可以更快找到</p>
          </li>
        )}
        {!pinnedOnly && term === '' && emptyPlaceholders.map(({ kind, placeholder }) => (
          <li key={`empty-${kind}`} style={{ listStyle: 'none' }}>
            <div className="mobile-groupTitle">{KIND_LABEL[kind]}</div>
            <div className="mobile-empty-group">
              <span>{placeholder}</span>
              <button type="button" className="mobile-empty-groupBtn" onClick={() => setIsCreating(true)}>创建</button>
            </div>
          </li>
        ))}
        {term !== '' && globalBusy && globalHits.length === 0 && (
          <li style={{ listStyle: 'none' }} aria-hidden>
            {[0, 1, 2].map(index => (
              <div key={index} className="mobile-row search-skeletonRow">
                <span className="search-skeletonLine" style={{ width: `${72 - index * 8}%` }} />
                <span className="search-skeletonLine search-skeletonLine-thin" style={{ width: `${46 - index * 6}%` }} />
              </div>
            ))}
          </li>
        )}
        {term !== '' && globalHits.length > 0 && (
          <li style={{ listStyle: 'none' }}>
            {[
              { label: '会话名匹配', rows: globalTitleRows },
              { label: '消息', rows: globalMessageRows },
            ].filter(group => group.rows.length > 0).map(group => (
              <div key={group.label}>
                <div className="mobile-groupTitle">{group.label}</div>
                {group.rows.map((row, index) => {
                  const owner = resolveOwner(row.hit)
                  // 没有标题的会话以前拿摘要前 24 字当标题，下面正文又把同一句再渲染一遍
                  // （用户看到的是「同一句话出现在两行」）。没有标题就直说未命名。
                  const rawTitle = (row.hit.title ?? '').trim()
                  const title = rawTitle !== '' ? rawTitle : '未命名会话'
                  const snippet = row.message?.snippet ?? row.hit.snippet ?? ''
                  // 方案 C：命中段落优先。摘要只有一个窗口宽，用户点进去前看不出是哪句
                  // 话命中；段落是索引侧按空行切出来的整块正文，直接摆出来（最多三行）。
                  const paragraph = row.message?.paragraph ?? row.hit.paragraph
                  const isActive = group.label === '会话名匹配' ? activeHit === index : activeHit === globalTitleRows.length + index
                  return (
                    <button
                      type="button"
                      key={`${row.hit.kind}:${row.hit.sessionId}:${row.message?.seq ?? 'title'}`}
                      className={`mobile-row search-hitRow${isActive ? ' search-hitRow-active' : ''}`}
                      onClick={() => { void locateHit(row.message === undefined ? row.hit : { ...row.hit, ...row.message, kind: 'message' }, term) }}
                    >
                      <span className="card-icon">
                        <span className="sess-check" aria-hidden><CheckIcon /></span>
                      </span>
                      <span className="card-main">
                        <span className="sess-titleline">
                          <span className="sess-title">
                            <Marked text={title} ranges={markable(matchText(title, term))} />
                          </span>
                          {row.message !== undefined && row.hit.messages !== undefined && row.hit.messages.length > 1 && (
                            <span className="search-hitBadge">{row.ordinal ?? 1}/{row.hit.messages.length}</span>
                          )}
                          <span className="sess-sep" aria-hidden>·</span>
                          <span className="sess-time">{owner.title ?? '未分组'}</span>
                          {(row.copies?.length ?? 0) > 0 && (
                            <span className="search-hitBadge" title="同一段历史被 fork 成多个会话">
                              {row.copies!.length + 1} 个副本
                            </span>
                          )}
                        </span>
                        <span className={paragraph === undefined ? 'card-desc' : 'card-desc search-hitPara'}>
                          <Marked text={paragraph ?? snippet} ranges={markable(matchText(paragraph ?? snippet, term))} />
                        </span>
                        {row.message === undefined && (row.hit.hits ?? 0) > 0 && (
                          <span className="search-hitNote">这个会话还有 {row.hit.hits} 条正文命中</span>
                        )}
                      </span>
                      <span className="card-action">
                        <span className="mobile-chevron" aria-hidden>›</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
            {globalMore && (
              <button
                type="button"
                className="search-more"
                disabled={globalLoadingMore}
                onClick={loadMoreHits}
              >
                {globalLoadingMore ? '加载中…' : '加载更多结果'}
              </button>
            )}
            {!globalMore && !globalBusy && (
              <p className="search-hitsNote mobile-pad">
                {globalPartial ? '已扫描最近的会话，更早的会话可能未覆盖' : `以上是全部命中（${searchTotal} 条）`}
              </p>
            )}
          </li>
        )}
        {term !== '' && globalBusy && globalHits.length > 0 && (
          <li style={{ listStyle: 'none' }}>
            <p className="mobile-muted mobile-pad" role="status">正在搜索全部会话…</p>
          </li>
        )}
        {!pinnedOnly && term === '' && (
          <li style={{ listStyle: 'none' }}>
            <button type="button" className="mobile-createCard" onClick={() => setIsCreating(true)}>
              <PlusIcon />
              新建工作区
            </button>
          </li>
        )}
      </ul>
    )
  })()

  return (
    <div className="mobile">
      <header className="mobile-header">
        <div className="mobile-headerSlot">
          {searchOpen
            ? (
              <button type="button" className="mobile-back" aria-label="返回" onClick={() => { setSearchOpen(false); setSearch('') }}>‹</button>
            )
            : (
              <div className="mobile-headerSlot" />
            )}
        </div>
        {searchOpen ? (
          <div className="mobile-headerSearch">
            <input
              type="search"
              className="mobile-headerSearchInput"
              placeholder="搜索工作区或会话…"
              aria-label="搜索工作区和会话"
              autoFocus
              value={search}
              onChange={(event) => { setSearch(event.target.value) }}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={(event) => { setComposing(false); setSearch(event.currentTarget.value) }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setSearchOpen(false)
                  setSearch('')
                  return
                }
                if (searchTotal === 0) return
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setActiveHit(index => Math.min(index + 1, searchTotal - 1))
                  return
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setActiveHit(index => Math.max(index - 1, 0))
                  return
                }
                if (event.key === 'Enter') {
                  const rows = [...globalTitleRows, ...globalMessageRows]
                  const row = rows[Math.min(activeHit, rows.length - 1)]
                  if (row === undefined) return
                  event.preventDefault()
                  void locateHit(row.message === undefined ? row.hit : { ...row.hit, ...row.message, kind: 'message' }, term)
                }
              }}
            />
          </div>
        ) : (
          <h1 className="mobile-title">工作区</h1>
        )}
        <div className="mobile-headerSlot mobile-headerSlot-right">
          {searchOpen ? (
            <button type="button" className="mobile-iconbtn" aria-label="取消搜索" onClick={() => { setSearchOpen(false); setSearch('') }}>
              <CloseIcon />
            </button>
          ) : (
            <>
              <button type="button" className="mobile-iconbtn" aria-label="搜索工作区和会话" onClick={() => { setSearchOpen(true) }}>
                <SearchIcon />
              </button>
              <ThemeToggle />
            </>
          )}
        </div>
      </header>
      <div className="mobile-quickbar" role="toolbar" aria-label="快捷操作">
        <button
          type="button"
          className={`mobile-quickchip${pinnedOnly ? ' mobile-quickchip-on' : ''}`}
          aria-pressed={pinnedOnly}
          onClick={() => { setPinnedOnly(value => !value) }}
        >
          <PinIcon />
          固定{pinnedCount > 0 ? ` ${pinnedCount}` : ''}
        </button>
        <button type="button" className="mobile-quickchip" onClick={jumpRecent}>
          <ClockIcon />
          最近访问
        </button>
        {onOpenRunOverview !== undefined && (
          <button
            type="button"
            className={'mobile-quickchip' + (runOverviewLive !== undefined && runOverviewLive > 0 ? ' mobile-quickchip-live' : '')}
            aria-label={runOverviewLive !== undefined && runOverviewLive > 0 ? `运行中 ${runOverviewLive} 个会话` : '运行中'}
            onClick={onOpenRunOverview}
          >
            <span className={runOverviewLive !== undefined && runOverviewLive > 0 ? 'quick-live-dot' : 'quick-live-dot quick-live-dot-off'} aria-hidden />
            运行中
            {runOverviewLive !== undefined && runOverviewLive > 0 && (
              <span className="quick-live-count">{runOverviewLive}</span>
            )}
          </button>
        )}
      </div>
      {!welcomeHidden && term === '' && (
        <div className="mobile-welcome" role="note">
          <div className="mobile-welcomeCopy">
            <p className="mobile-welcomeTitle">配对成功 🎉 三步上手</p>
            <p className="mobile-welcomeDesc">
              ① 点一个工作区开始对话<br />
              ② 右上角 设置 → 通知：配好任务完成提醒<br />
              ③ 设置 → 用量：随时查看余额与配额
            </p>
          </div>
          <button type="button" className="mobile-welcomeClose" onClick={dismissWelcome}>知道了</button>
        </div>
      )}
      {body}
      {menu !== undefined && (
        <WorkspaceMenu
          target={menu}
          pinned={pinned.includes(menu.workspace.workspaceId)}
          onClose={() => { setMenu(undefined) }}
          onPinnedChange={() => { togglePin(menu.workspace) }}
          onRename={(workspace) => { setMenu(undefined); setRenaming(workspace) }}
          onDelete={(workspace) => { setMenu(undefined); setDeleting(workspace) }}
        />
      )}
      {renaming !== undefined && (
        <PromptDialog
          title="重命名工作区"
          initial={renaming.title}
          confirmLabel="保存"
          busy={busy}
          onCancel={() => { setRenaming(undefined) }}
          onConfirm={(value) => { void handleRename(renaming, value) }}
        />
      )}
      {deleting !== undefined && (
        <ConfirmDialog
          title="删除工作区"
          body={<>确定删除「{deleting.title}」吗？目录、文件与会话记录都会保留，仅移除这里的工作区入口。</>}
          confirmLabel="删除"
          tone="danger"
          busy={busy}
          onCancel={() => { setDeleting(undefined) }}
          onConfirm={() => { void handleDelete(deleting) }}
        />
      )}
    </div>
  )
}
