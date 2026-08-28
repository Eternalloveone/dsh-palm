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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceView as WorkspaceRow } from '@deepseek-ai/dsh-host-apiproxy/api/workspace'
import type { AgentPresetEntry } from '@deepseek-ai/dsh-host-apiproxy/api/agent-presets'
import type { SessionSummary } from '@deepseek-ai/dsh-host-apiproxy/api/sessions'
import { createSession, history, listAgentPresets, listSessions } from '../api.ts'
import { errorText, formatFullTime, staleHostHint, toSessionView, type SessionView } from './App.tsx'
import { previewSummary } from '../ui-text.ts'
import { foldEvents, type WireEvent } from '../messages.ts'
import { ThemeToggle } from '../theme-toggle.tsx'
import { Sheet } from '../sheet.tsx'
import { ChatBubbleIcon, CheckIcon, ChevronUpIcon, CloseIcon, HelpIcon, SearchIcon } from '../icons.tsx'

/** Props for the session list. */
export interface SessionListViewProps {
  workspace: WorkspaceRow
  onBack(): void
  onPick(session: SessionView): void
  /** Open the mobile settings page (gear in the header). */
  onOpenSettings(): void
}

/** Whether a session belongs to the opened workspace. Sessions carry their
 * working directory (cwd), which is the reliable owner signal — the
 * workspace roster's owned-id set only covers sessions attached through
 * workspace.create and silently drops the rest. Matching is on the
 * workspace directory itself and its children, case-insensitively (Windows
 * paths), so every session created inside the project shows up. */
function belongsToWorkspace(cwd: string | undefined, workspacePath: string): boolean {
  if (typeof cwd !== 'string' || cwd === '') return false
  const path = workspacePath.replace(/[\\/]+$/, '').toLowerCase()
  const normalized = cwd.replace(/[\\/]+$/, '').toLowerCase()
  return normalized === path || normalized.startsWith(path + '\\') || normalized.startsWith(path + '/')
}

/** Rows shown for the opened workspace: its sessions, paged. */
function pageItems(page: SessionSummary[], workspacePath: string): SessionView[] {
  return page
    .filter(item => belongsToWorkspace(item.cwd, workspacePath))
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

/**
 * Pull the last-message preview for one session (best effort): fold the
 * history tail and summarize the newest message's text (or reasoning).
 * Returns undefined on any failure — the row falls back to its stats line.
 */
async function fetchPreview(sessionId: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const page = await history(sessionId, undefined, undefined, signal)
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
export function SessionListView({ workspace, onBack, onPick, onOpenSettings }: SessionListViewProps) {
  const [rows, setRows] = useState<SessionView[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
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
  // In-list search (header morphs into the input) + preview lazy cache.
  const [searchActive, setSearchActive] = useState(false)
  const [search, setSearch] = useState('')
  const previewCacheRef = useRef(new Map<string, string>())
  const [previewTick, setPreviewTick] = useState(0)
  // Unmount guard: preview fetches resolve asynchronously and must not
  // tick state (or spin the tunnel) after the view left the screen.
  const aliveRef = useRef(true)
  useEffect(() => () => { aliveRef.current = false }, [])
  /** Backoff gate after a failed next-page load (sentinel retry storm). */
  const retryBlockedAtRef = useRef(0)

  /** Pull previews for the newest page's sessions (bounded, best effort). */
  const loadPreviews = useCallback((rows: SessionView[]): void => {
    const pending = rows
      .filter(row => !row.blank && row.preview === undefined && !previewCacheRef.current.has(row.sessionId))
      .slice(0, PREVIEW_FETCH_LIMIT)
    if (pending.length === 0) return
    const controller = new AbortController()
    void mapLimited(pending, PREVIEW_CONCURRENCY, async (row) => {
      if (!aliveRef.current) return
      const summary = await fetchPreview(row.sessionId, controller.signal)
      if (summary === undefined || !aliveRef.current) return
      // Bounded cache: evict the oldest entry past the cap so a long-lived
      // list never grows the map without limit.
      if (previewCacheRef.current.size >= PREVIEW_CACHE_LIMIT) {
        const oldest = previewCacheRef.current.keys().next().value
        if (oldest !== undefined) previewCacheRef.current.delete(oldest)
      }
      previewCacheRef.current.set(row.sessionId, summary)
    }).then(() => { setPreviewTick(tick => tick + 1) })
  }, [])

  // First page on mount (this workspace's sessions, paged).
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(undefined)
    void listSessions().then(
      (page) => {
        if (cancelled) return
        const rows = pageItems(page.items, workspace.path)
        setRows(rows)
        loadPreviews(rows)
        cursorRef.current = page.nextCursor
        setHasMore(page.hasMore)
        setLoading(false)
      },
      (reason: unknown) => {
        if (cancelled) return
        setError(errorText(reason))
        setLoading(false)
      },
    )
    return () => { cancelled = true }
  }, [workspace, loadPreviews])

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
        const appended = pageItems(page.items, workspace.path)
        setRows(previous => [...previous, ...appended])
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
        setRows(previous => [view, ...previous])
        onPick(view)
      },
      (reason: unknown) => {
        setCreating(false)
        setCreateError(errorText(reason))
      },
    )
  }, [creating, workspace, onPick, selectedPreset])

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
    const visible = rows.filter(row => {
      if (term === '') return true
      const preview = row.preview ?? previewCacheRef.current.get(row.sessionId) ?? ''
      return row.title.toLowerCase().includes(term) || preview.toLowerCase().includes(term)
    })
    return DAY_BUCKETS
      .map(bucket => ({ bucket, rows: visible.filter(row => dayBucketFor(row.updatedAt) === bucket) }))
      .filter(group => group.rows.length > 0)
    // previewTick: cached previews arrive async — recompute the filter when they land.
  }, [rows, search, previewTick])

  const exitSearch = (): void => {
    setSearchActive(false)
    setSearch('')
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
              placeholder="搜索标题或内容…"
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
              const preview = row.preview ?? previewCacheRef.current.get(row.sessionId)
                ?? (row.turns !== undefined ? `${row.turns} 轮对话` : undefined)
              return (
                <button type="button" key={row.sessionId} className="mobile-row" onClick={() => { onPick(row) }}>
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
        {!loading && search.trim() !== '' && groups.length === 0 && (
          <div className="mobile-empty">
            <div className="empty-icon"><SearchIcon /></div>
            <p className="empty-title">未找到匹配会话</p>
            <p className="empty-desc">换个关键词试试，支持搜索标题和内容预览</p>
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
    </div>
  )
}
