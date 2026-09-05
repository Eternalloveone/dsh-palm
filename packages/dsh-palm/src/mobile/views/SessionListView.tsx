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

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { WorkspaceView as WorkspaceRow } from '@deepseek-ai/dsh-host-apiproxy/api/workspace'
import type { AgentPresetEntry } from '@deepseek-ai/dsh-host-apiproxy/api/agent-presets'
import type { SessionSummary } from '@deepseek-ai/dsh-host-apiproxy/api/sessions'
import { archiveSession, createSession, history, listAgentPresets, listSessions, listWorkspaces, previews, searchAll, searchMessages, type SessionSearchHit } from '../api.ts'
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
  maintainPersistedCaches,
  savePersistedList,
  savePersistedPreviews,
  savePersistedScroll,
  sessionListCache,
} from '../list-persist.ts'
export { sessionListCache } from '../list-persist.ts'
import { ChatBubbleIcon, CheckIcon, ChevronUpIcon, CloseIcon, HelpIcon, SearchIcon } from '../icons.tsx'

/** Props for the session list. */
export interface SessionListViewProps {
  workspace: WorkspaceRow
  /** Session carried by a notification deep link; opened after the list loads. */
  initialSessionId?: string
  /** Restore the in-list search surface when the app returns here after a
   *  chat opened from that search (one-shot, consumed on apply). */
  initialSearch?: { open: boolean; term: string }
  onBack(): void
  onPick(session: SessionView): void
  /** Open the mobile settings page (gear in the header). */
  onOpenSettings(): void
  /** Locate a search hit living in another workspace (in-app navigation). */
  onLocateSession?(sessionId: string, workspaceId: string, seq?: number, query?: string): void
  /** Open a search-hit session scrolled to one of its matched messages. */
  onPickSeq?(session: SessionView, seq: number, query?: string, messageId?: string, partId?: string): void
  /** Report the live in-list search surface so the app can restore it when
   *  returning from a chat opened out of this list. */
  onSearchSnapshot?(open: boolean, term: string): void
  /** The app cleared its one-shot restore (called after initialSearch is
   *  applied), so a later manual visit does not restore the search again. */
  onSearchApplied?(): void
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

/** Which day bucket a session row falls into (list grouping). */
type DayBucket = '今天' | '昨天' | '更早'

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
/** Cooldown after a failed next-page load before the sentinel retries. */
const LOAD_MORE_BACKOFF_MS = 10_000

/** In-memory roster cache TTL (see list-persist.sessionListCache). */
const LIST_CACHE_TTL_MS = 60_000

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
  savePersistedList(workspaceId, value)
}

/** Publish the live preview map to the persisted store (cheap: bounded). */
function syncPersistedPreviews(): void {
  savePersistedPreviews(sessionPreviewCache)
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
export function SessionListView({ workspace, initialSessionId, initialSearch, onBack, onPick, onOpenSettings, onLocateSession, onPickSeq, onSearchSnapshot, onSearchApplied }: SessionListViewProps) {
  const [rows, setRows] = useState<SessionView[]>([])
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
  // Sentinel watched for automatic next-page loading (the "load more" button
  // stays as the manual fallback).
  const sentinelRef = useRef<HTMLDivElement | undefined>(undefined)
  // In-list search (header morphs into the input) + preview lazy cache
  // (module-level: summaries survive a chat round-trip).
  const [searchActive, setSearchActive] = useState(false)
  const [search, setSearch] = useState('')
  /** Host full-roster search hits (sessions not yet in the loaded pages). */
  const [searchHits, setSearchHits] = useState<SessionSearchHit[]>([])
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchDone, setSearchDone] = useState(false)
  /** How many full-roster hits live outside this workspace (folded away). */
  const [searchForeign, setSearchForeign] = useState(0)
  /** Result cap reached: more hits exist but are folded (refine the query). */
  const [searchHasMore, setSearchHasMore] = useState(false)
  /** The search hit currently locating its first matched message. */
  /** This workspace's owned session ids (fresh roster), for scope narrowing. */
  const ownedRef = useRef<Set<string>>(new Set())
  /** Once per mount: paging for a deep-link target beyond the first page. */
  const deepTargetRef = useRef(false)
  // Restore the in-list search surface once, when the app returns here from
  // a chat that was opened out of this search.
  const appliedInitialSearchRef = useRef(false)
  useEffect(() => {
    if (appliedInitialSearchRef.current) return
    if (initialSearch !== undefined && initialSearch.open) {
      appliedInitialSearchRef.current = true
      setSearchActive(true)
      setSearch(initialSearch.term)
      onSearchApplied?.()
    }
  }, [initialSearch, onSearchApplied])
  // Report the live in-list search surface so the app can restore it on return.
  useEffect(() => {
    onSearchSnapshot?.(searchActive, search)
  }, [searchActive, search, onSearchSnapshot])

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
  /** Backoff gate after a failed next-page load (sentinel retry storm). */
  const retryBlockedAtRef = useRef(0)
  /** Long-press row menu (delete session) + its confirm dialog. */
  const [menuSession, setMenuSession] = useState<SessionView | undefined>(undefined)
  const [deleting, setDeleting] = useState<SessionView | undefined>(undefined)
  const pressTimerRef = useRef<number | undefined>(undefined)
  const pressConsumedRef = useRef<string | undefined>(undefined)

  /** Pull previews for the newest page's sessions (bounded, best effort).
   *  v3.1: ONE batched `mobile.previews` call serves the whole burst from the
   *  host's mux-fed cache (zero per-row log reads on repeat visits); when the
   *  host lacks the method (older plugin) or the call fails, the per-row
   *  history fallback below keeps the list working. */
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
        void mapLimited(pending, PREVIEW_CONCURRENCY, async (row) => {
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
      setRows(cached.rows)
      cursorRef.current = cached.cursor
      setHasMore(cached.hasMore)
      setError(undefined)
      setLoading(false)
    } else {
      setLoading(true)
      setError(undefined)
    }
    void Promise.all([
      listSessions(),
      listWorkspaces().catch(() => [] as WorkspaceRow[]),
    ]).then(
      ([page, workspaces]) => {
        if (cancelled) return
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
        setRows(rows)
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
  }, [workspace])

  /** Pull the next page and append its rows. */
  const loadMore = useCallback(() => {
    if (busyRef.current) return
    // Failed loads gate the sentinel for a cooldown: on a weak link the
    // observer would otherwise hammer the tunnel with immediate retries.
    if (Date.now() - retryBlockedAtRef.current < LOAD_MORE_BACKOFF_MS) return
    const cursor = cursorRef.current
    if (cursor === undefined) return
    busyRef.current = true
    setLoading(true)
    void listSessions(cursor).then(
      (page) => {
        busyRef.current = false
        setLoading(false)
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
        if (cursorRef.current !== undefined && !busyRef.current) void loadMore()
      }
    }, { rootMargin: '240px 0px' })
    observer.observe(sentinel)
    return () => { observer.disconnect() }
  }, [loadMore])

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
   * navigate AND open the menu at once.
   */
  const pressHandlers = (row: SessionView) => ({
    onTouchStart: () => {
      clearPressTimer()
      pressConsumedRef.current = undefined
      pressTimerRef.current = window.setTimeout(() => {
        pressTimerRef.current = undefined
        pressConsumedRef.current = row.sessionId
        setMenuSession(row)
      }, 500)
    },
    onTouchMove: clearPressTimer,
    onTouchEnd: clearPressTimer,
    onClick: (event: ReactMouseEvent) => {
      if (pressConsumedRef.current === row.sessionId) {
        pressConsumedRef.current = undefined
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

  // Date-grouped roster: 今天 → 昨天 → 更早, newest first inside each bucket.
  const groups = useMemo(() => {
    const term = search.trim().toLowerCase()
    // The optimistic blank row (just created) participates: without it the
    // fresh session is invisible in the list until a re-fetch, and the user
    // cannot reopen it from the roster.
    const hitIds = new Set(searchHits.map(hit => hit.sessionId))
    const visible = rows.filter(row => {
      if (term === '') return true
      return row.title.toLowerCase().includes(term) || hitIds.has(row.sessionId)
    })
    return DAY_BUCKETS
      .map(bucket => ({ bucket, rows: visible.filter(row => dayBucketFor(row.updatedAt) === bucket) }))
      .filter(group => group.rows.length > 0)
    // previewTick: cached previews arrive async — recompute the filter when they land.
  }, [rows, search, searchHits, previewTick])

  /** Host full-roster search: debounced, best-effort, narrowed to THIS
   *  workspace's owned sessions (the list page searches what it shows; the
   *  home search covers other workspaces). Hits outside the loaded pages
   *  render as extra rows; a failure keeps the local filter. */
  useEffect(() => {
    const term = search.trim()
    if (term === '') {
      setSearchHits([])
      setSearchForeign(0)
      setSearchHasMore(false)
      setSearchDone(false)
      setSearchBusy(false)
      return
    }
    setSearchBusy(true)
    setSearchDone(false)
    let cancelled = false
    const timer = setTimeout(() => {
      void searchAll(term).then(
        (result) => {
          if (cancelled) return
          const owned = ownedRef.current
          setSearchHits(result.items.filter(hit => owned.has(hit.sessionId)))
          setSearchForeign(result.items.filter(hit => !owned.has(hit.sessionId)).length)
          setSearchHasMore(result.hasMore)
          setSearchDone(true)
          setSearchBusy(false)
        },
        () => {
          if (!cancelled) {
            setSearchDone(true)
            setSearchBusy(false)
          }
        },
      )
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [search])

  const exitSearch = (): void => {
    setSearchActive(false)
    setSearch('')
  }

  /** Open a search hit straight to its first matched message: lazy message
   *  locate for the seq (cached), then open scrolled to it; a missed locate
   *  degrades to a plain session open. A tap on another hit supersedes the
   *  in-flight locate (the loser neither opens nor clears the indicator),
   *  and a late result after the degrade path never double-fires. */
  const openSearchHit = (hit: SessionSearchHit, title: string): void => {
    const session: SessionView = {
      sessionId: hit.sessionId,
      title,
      ...(hit.title === undefined ? { preview: hit.snippet } : {}),
      updatedAt: 0,
      running: false,
      blank: false,
    }
    if (hit.kind === 'message' && hit.seq !== undefined) {
      if (onPickSeq !== undefined) onPickSeq(session, hit.seq, search.trim(), hit.messageId, hit.partId)
      else onPick(session)
      return
    }
    // A message hit without a seq, or a TITLE hit (session name matched):
    // resolve the first message containing the term so the tap still jumps
    // to the relevant message instead of opening the session at the tail.
    void searchMessages(hit.sessionId, search.trim()).then(
      (result) => {
        const first = result.items[0]
        if (first !== undefined && onPickSeq !== undefined) onPickSeq(session, first.seq, search.trim(), first.messageId, first.partId)
        else onPick(session)
      },
      () => { onPick(session) },
    )
  }

  return (
    <div className="mobile">
      <header className="mobile-header">
        <div className="mobile-headerSlot">
          {searchActive
            ? (
              <button type="button" className="mobile-back" aria-label="返回" onClick={exitSearch}>‹</button>
            )
            : (
              <button type="button" className="mobile-back" aria-label="返回" onClick={onBack}>‹</button>
            )}
        </div>
        {searchActive ? (
          <div className="mobile-headerSearch">
            <input
              type="search"
              className="mobile-headerSearchInput"
              placeholder="搜索当前工作区或全部会话…"
              aria-label="搜索会话"
              autoFocus
              value={search}
              onChange={(event) => { setSearch(event.target.value) }}
            />
          </div>
        ) : (
          <div className="mobile-titleWrap">
            <h1 className="mobile-title mobile-titleInline">{workspace.title}</h1>
            {/* Subordinate metadata: one mono line, ellipsized on overflow. */}
            <p className="mobile-titlePath">{workspace.path}</p>
          </div>
        )}
        <div className="mobile-headerSlot mobile-headerSlot-right">
          {searchActive ? (
            <button type="button" className="mobile-iconbtn" aria-label="取消搜索" onClick={exitSearch}>
              <CloseIcon />
            </button>
          ) : (
            <>
              <button type="button" className="mobile-iconbtn" aria-label="搜索会话" onClick={() => { setSearchActive(true) }}>
                <SearchIcon />
              </button>
              <button type="button" className="mobile-iconbtn" aria-label="设置" onClick={onOpenSettings}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
                </svg>
              </button>
              <ThemeToggle />
            </>
          )}
        </div>
      </header>
      {error !== undefined && <p className="mobile-error mobile-pad">{error}</p>}
      <div className="mobile-create">
        {presets.length > 0 && (
          <div className="mobile-presetCard">
            <button
              type="button"
              className="mobile-presetTrigger"
              aria-label="Agent 模式"
              disabled={selectedPreset === undefined}
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
              disabled={presetDescription === undefined}
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
        {groups.map(group => (
          <li key={group.bucket} style={{ listStyle: 'none' }}>
            <div className="mobile-groupTitle">{group.bucket}</div>
            {group.rows.map(row => {
              const matchedHit = searchHits.find(hit => hit.sessionId === row.sessionId && (hit.kind === 'message' || hit.kind === 'title'))
              const preview = row.preview ?? sessionPreviewCache.get(row.sessionId)
                ?? (row.turns !== undefined ? `${row.turns} 轮对话` : undefined)
              return (
                <button type="button" key={row.sessionId} className="mobile-row" {...(matchedHit === undefined ? pressHandlers(row) : { onClick: () => { openSearchHit(matchedHit, row.title) } })}>
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
                      {row.blank && <span className="sess-status">新</span>}
                      {row.running && <span className="sess-status">进行中</span>}
                      <span className="sess-sep" aria-hidden>·</span>
                      <span className="sess-time">{formatFullTime(row.updatedAt)}</span>
                    </span>
                    {preview !== undefined && <span className="card-desc">{preview}</span>}
                  </span>
                  <span className="card-action">
                    <span className="mobile-chevron" aria-hidden>›</span>
                  </span>
                </button>
              )
            })}
          </li>
        ))}
        {!loading && searchBusy && (
          <li style={{ listStyle: 'none' }}>
            <p className="mobile-muted mobile-pad" role="status">正在搜索全部会话…</p>
          </li>
        )}
        {!loading && search.trim() !== '' && !searchBusy && searchHits.some(hit => !rows.some(row => row.sessionId === hit.sessionId)) && (
          <li style={{ listStyle: 'none' }}>
            <div className="mobile-groupTitle">搜索结果（未加载的会话）</div>
            {searchHits.filter(hit => !rows.some(row => row.sessionId === hit.sessionId)).map(hit => {
              const title = (hit.title ?? hit.snippet.trim().slice(0, 24)) || '匹配会话'
              return (
                <li key={`${hit.kind}:${hit.sessionId}`} style={{ listStyle: 'none' }}>
                  <button
                    type="button"
                    className="mobile-row"
                    onClick={() => { void openSearchHit(hit, title) }}
                  >
                    <span className="card-icon">
                      <span className="sess-check" aria-hidden><CheckIcon /></span>
                    </span>
                    <span className="card-main">
                      <span className="sess-titleline">
                        <span className="sess-title">{title}</span>
                        <span className="sess-sep" aria-hidden>·</span>
                        <span className="sess-time">命中内容</span>
                      </span>
                      <span className="card-desc">{hit.snippet}</span>
                    </span>
                    <span className="card-action">
                      <span className="mobile-chevron" aria-hidden>›</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </li>
        )}
        {!loading && search.trim() !== '' && !searchBusy && searchForeign > 0 && (
          <li style={{ listStyle: 'none' }}>
            <p className="search-hitsNote mobile-pad">另有 {searchForeign} 个其他工作区的命中未在此显示，首页搜索可查全部</p>
          </li>
        )}
        {!loading && search.trim() !== '' && !searchBusy && searchHasMore && (
          <li style={{ listStyle: 'none' }}>
            <p className="search-hitsNote mobile-pad">结果较多，仅显示前若干条——请细化关键词</p>
          </li>
        )}
        {!loading && search.trim() !== '' && !searchBusy && searchDone && groups.length === 0 && searchHits.length === 0 && (
          <div className="mobile-empty">
            <div className="empty-icon"><SearchIcon /></div>
            <p className="empty-title">未找到匹配会话</p>
            <p className="empty-desc">已搜索全部会话的标题与内容</p>
          </div>
        )}
        {hasMore && (
          <li style={{ listStyle: 'none' }}>
            <div className="mobile-pad">
              <div ref={ref => { sentinelRef.current = ref ?? undefined }} aria-hidden="true" />
              <button
                type="button"
                className="mobile-button mobile-block"
                disabled={loading}
                onClick={() => { void loadMore() }}
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
            {selectedPresetEntry?.name ?? selectedPreset}
            {presetDescription !== undefined ? '：' + presetDescription : ''}
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
