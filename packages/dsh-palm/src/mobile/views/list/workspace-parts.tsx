/**
 * Presentational pieces of {@link WorkspaceView}: the match highlighter, the
 * directory browser used by the create flow, the long-press action menu and the
 * roster skeleton. The view keeps every hook, fetch and piece of state.
 */

import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { WorkspaceView as WorkspaceRow } from '../../../api-proxy-types'
import { createWorkspace, listDirectory } from '../../data/workspace.ts'
import type { DirectoryEntry, DirectoryListing } from '../../api.ts'
import { errorText } from '../../shared/error-text.ts'
import { toast } from '../../components/toast.tsx'
import { Sheet } from '../../ui/sheet.tsx'
import type { MatchRanges, TextMatch } from '../../render/search-match.ts'
import { Button } from '../../ui/primitives.tsx'

/**
 * 只给「连成一整段」的命中上色：子序列命中（「工区」命中「工作区」）会把几个
 * 不相干的单字涂黄，看起来像乱码，所以它只参与排序。
 */
export function markable(match: TextMatch | undefined): MatchRanges | undefined {
  return match !== undefined && match.contiguous ? match.ranges : undefined
}

/**
 * 把命中区间标出来。区间来自 {@link matchText}，与排序用的是同一趟匹配，
 * 所以「排在前面的那条一定带黄」。
 */
export function Marked({ text, ranges }: { text: string; ranges?: MatchRanges }): ReactElement {
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

/* ── directory browser (create flow) ─────────────────────────────────── */

/** Props for the directory browser. */
interface DirectoryBrowserProps {
  onCancel(): void
  onPick(workspace: WorkspaceRow): void
}

/**
 * Render the directory browser for creating a new workspace.
 */
export function DirectoryBrowser({ onCancel, onPick }: DirectoryBrowserProps) {
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
          <Button type="button" className="mobile-headerAction" onClick={onCancel}>返回</Button>
        </div>
        <h1 className="mobile-title">选择目录</h1>
        <div className="mobile-headerSlot mobile-headerSlot-right" />
      </header>

      {listing !== undefined && (
        <div className="dir-crumbs">
          {listing.crumbs.map((crumb, idx) => (
            <span key={crumb.path}>
              <Button
                type="button"
                className="dir-crumb"
                onClick={() => setPath(crumb.path)}
              >
                {crumb.name || '/'}
              </Button>
              {idx < listing.crumbs.length - 1 && <span className="dir-crumb-separator">/</span>}
            </span>
          ))}
        </div>
      )}

      {error !== undefined ? (
        <div className="mobile-empty">
          <p className="mobile-error">{error}</p>
          <Button type="button" className="mobile-button" onClick={() => setReload(n => n + 1)}>重试</Button>
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
                <Button
                  type="button"
                  className={`mobile-row dir-entry ${entry.hidden ? 'dir-entry-hidden' : ''}`}
                  onClick={() => setPath(entry.path)}
                >
                  <span className="mobile-rowMain">
                    <span className="mobile-rowTitle">{entry.name}</span>
                  </span>
                  <span className="mobile-chevron" aria-hidden>›</span>
                </Button>
              </li>
            ))
          )}
        </ul>
      )}

      <div className="dir-select">
        <Button
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
        </Button>
      </div>
    </div>
  )
}

/* ── long-press action menu ──────────────────────────────────────────── */

/** The workspace the long-press menu is open for. */
export interface MenuTarget {
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
export function WorkspaceMenu({ target, pinned, onClose, onPinnedChange, onRename, onDelete }: WorkspaceMenuProps) {
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
          <Button
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
          </Button>
        ))}
      </div>
    </Sheet>
  )
}

/* ── skeleton + empty states ─────────────────────────────────────────── */

/** Three shimmering placeholder cards while the roster loads. */
export function RosterSkeleton() {
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
