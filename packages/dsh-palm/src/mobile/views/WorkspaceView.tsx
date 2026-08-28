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
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { WorkspaceView as WorkspaceRow } from '@deepseek-ai/dsh-host-apiproxy/api/workspace'
import { deleteWorkspace, listWorkspaces, listDirectory, createWorkspace, renameWorkspace, type DirectoryListing, type DirectoryEntry } from '../api.ts'
import { errorText } from './App.tsx'
import { compactPath, dominantPathPrefix } from '../ui-text.ts'
import { ThemeToggle } from '../theme-toggle.tsx'
import { Sheet } from '../sheet.tsx'
import { ConfirmDialog, PromptDialog } from '../dialog.tsx'
import { toast } from '../toast.tsx'
import { ClockIcon, FolderIcon, FolderPlusIcon, InboxIcon, PinIcon, PlusIcon, SearchIcon } from '../icons.tsx'

/* ── local preferences (pin / recent) ────────────────────────────────── */

const PINNED_KEY = 'dsh.palm.pinnedWorkspaces'
const RECENT_KEY = 'dsh.palm.recentWorkspace'

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

/** The workspace the user opened last (drives the active rail + jump chip). */
function readRecent(): string | undefined {
  try {
    const value = localStorage.getItem(RECENT_KEY)
    return value === '' ? undefined : value ?? undefined
  } catch {
    return undefined
  }
}

function writeRecent(id: string): void {
  try { localStorage.setItem(RECENT_KEY, id) } catch { /* non-fatal */ }
}

/* ── project-kind classification ─────────────────────────────────────── */

/** Project kind driving icon tint + roster grouping. */
type WorkspaceKind = 'active' | 'test' | 'code' | 'plain'

/** Heuristic split: the last-opened workspace is "active"; paths that look
 * like test rigs (test/spec/benchmark segments) group under 测试项目;
 * workspaces without any session yet stay "plain" gray. */
export function workspaceKind(workspace: WorkspaceRow, recentId: string | undefined): WorkspaceKind {
  if (recentId !== undefined && workspace.workspaceId === recentId) return 'active'
  if (/\b(test|tests|testing|spec|specs|benchmark|e2e)\b/i.test(workspace.path.replace(/[\\/]+/g, ' '))
    || /\b(test|tests|testing|spec|specs|benchmark|e2e)\b/i.test(workspace.title)) return 'test'
  if ((workspace.sessionIds ?? []).length === 0) return 'plain'
  return 'code'
}

const KIND_LABEL: Record<WorkspaceKind, string> = {
  active: '活跃项目',
  code: '代码项目',
  test: '测试项目',
  plain: '其他',
}

const KIND_ICON_CLASS: Record<WorkspaceKind, string> = {
  active: 'ws-icon-active',
  code: 'ws-icon-code',
  test: 'ws-icon-test',
  plain: 'ws-icon-plain',
}

/** Roster group order + the empty-group placeholder copy. */
const GROUP_ORDER: ReadonlyArray<{ kind: WorkspaceKind; placeholder: string | null }> = [
  { kind: 'active', placeholder: null },
  { kind: 'code', placeholder: '暂无代码项目' },
  { kind: 'test', placeholder: '暂无测试项目' },
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
          disabled={listing === undefined || creating}
          onClick={() => void handleCreate()}
        >
          {creating ? '创建中…' : '选择此目录'}
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
}

/**
 * Render the workspace roster.
 * @param props - the pick action.
 * @returns the roster.
 */
export function WorkspaceView({ initialWorkspaceId, onPick }: WorkspaceViewProps) {
  const [items, setItems] = useState<WorkspaceRow[] | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  // Bumped by the retry button to re-run the roster fetch effect.
  const [reload, setReload] = useState(0)
  const [isCreating, setIsCreating] = useState(false)
  // Quick-bar state: search field, pinned-only filter, recent jump.
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [pinned, setPinned] = useState<string[]>(() => readPinned())
  const [recentId, setRecentId] = useState<string | undefined>(() => readRecent())
  // Long-press menu + confirm/prompt dialogs.
  const [menu, setMenu] = useState<MenuTarget | undefined>(undefined)
  const [renaming, setRenaming] = useState<WorkspaceRow | undefined>(undefined)
  const [deleting, setDeleting] = useState<WorkspaceRow | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  // Long-press detection: 500ms touch hold, cancelled on move/end.
  const pressTimerRef = useRef<number | undefined>(undefined)

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
        setItems(rows)
      },
      (reason: unknown) => {
        if (cancelled) return
        setError(errorText(reason))
      },
    )
    return () => { cancelled = true }
  }, [initialWorkspaceId, onPick, reload])

  /** Open a workspace: remember it as the recent/active one first. */
  const pick = useCallback((workspace: WorkspaceRow) => {
    writeRecent(workspace.workspaceId)
    setRecentId(workspace.workspaceId)
    onPick(workspace)
  }, [onPick])

  /** Jump straight into the last-opened workspace. */
  const jumpRecent = useCallback(() => {
    const target = items?.find(workspace => workspace.workspaceId === recentId)
    if (target === undefined) {
      toast('还没有访问记录')
      return
    }
    pick(target)
  }, [items, recentId, pick])

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

  const term = search.trim().toLowerCase()
  const visible = (items ?? [])
    .filter(workspace => term === '' || workspace.title.toLowerCase().includes(term) || workspace.path.toLowerCase().includes(term))
    .filter(workspace => !pinnedOnly || pinned.includes(workspace.workspaceId))
  // Path compression: hide the parent prefix most roster rows share.
  const pathPrefix = dominantPathPrefix((items ?? []).map(workspace => workspace.path))
  // Pinned workspaces float to the top inside their kind group.
  const ordered = [...visible].sort((a, b) => {
    const pinA = pinned.includes(a.workspaceId) ? 0 : 1
    const pinB = pinned.includes(b.workspaceId) ? 0 : 1
    return pinA - pinB
  })
  const groups: Array<{ kind: WorkspaceKind; rows: WorkspaceRow[] }> = GROUP_ORDER
    .map(({ kind }) => ({ kind, rows: ordered.filter(workspace => workspaceKind(workspace, recentId) === kind) }))
    .filter(group => group.rows.length > 0)
  const emptyPlaceholders = GROUP_ORDER.filter(({ kind, placeholder }) =>
    placeholder !== null && !ordered.some(workspace => workspaceKind(workspace, recentId) === kind))
  const pinnedCount = pinned.length

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
        return (
          <div className="mobile-empty">
            <div className="empty-icon"><SearchIcon /></div>
            <p className="empty-title">没有匹配的工作区</p>
            <p className="empty-desc">换个关键词试试，支持名称和路径搜索</p>
          </div>
        )
      }
      return (
        <div className="mobile-empty">
          <div className="empty-icon"><FolderPlusIcon /></div>
          <p className="empty-title">暂无工作区</p>
          <p className="empty-desc">新建一个工作区，把项目目录挂进来就能开始会话</p>
        </div>
      )
    }
    return (
      <ul className="mobile-list">
        {groups.map(group => (
          <li key={group.kind} style={{ listStyle: 'none' }}>
            <div className="mobile-groupTitle">{KIND_LABEL[group.kind]}</div>
            {group.rows.map(workspace => {
              const kind = workspaceKind(workspace, recentId)
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
                      <span className="card-titleText">{workspace.title}</span>
                      {isPinned && <span className="ws-pin" aria-label="已固定"><PinIcon /></span>}
                    </span>
                    <span className="card-subtitle">{compactPath(workspace.path, pathPrefix)}</span>
                  </span>
                  <span className="card-action">
                    {count > 0 && <span className="card-badge">{count} 会话</span>}
                    <span className="mobile-chevron" aria-hidden>›</span>
                  </span>
                </button>
              )
            })}
          </li>
        ))}
        {!pinnedOnly && term === '' && emptyPlaceholders.map(({ kind, placeholder }) => (
          <li key={`empty-${kind}`} style={{ listStyle: 'none' }}>
            <div className="mobile-groupTitle">{KIND_LABEL[kind]}</div>
            <div className="mobile-empty-group">
              <span>{placeholder}</span>
              <button type="button" className="mobile-empty-groupBtn" onClick={() => setIsCreating(true)}>创建</button>
            </div>
          </li>
        ))}
        {!pinnedOnly && (
          <li style={{ listStyle: 'none' }}>
            <button type="button" className="mobile-createCard" onClick={() => setIsCreating(true)}>
              <PlusIcon />
              + 新建工作区
            </button>
          </li>
        )}
      </ul>
    )
  })()

  return (
    <div className="mobile">
      <header className="mobile-header">
        <div className="mobile-headerSlot" />
        <h1 className="mobile-title">工作区</h1>
        <div className="mobile-headerSlot mobile-headerSlot-right">
          <ThemeToggle />
        </div>
      </header>
      <div className="mobile-quickbar" role="toolbar" aria-label="快捷操作">
        <button
          type="button"
          className={`mobile-quickchip${searchOpen ? ' mobile-quickchip-on' : ''}`}
          aria-pressed={searchOpen}
          onClick={() => { setSearchOpen(value => !value); setSearch('') }}
        >
          <SearchIcon />
          搜索
        </button>
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
      </div>
      {searchOpen && (
        <div className="mobile-search">
          <input
            type="search"
            className="mobile-searchInput"
            placeholder="搜索工作区名称或路径…"
            aria-label="搜索工作区"
            value={search}
            onChange={(event) => { setSearch(event.target.value) }}
          />
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
