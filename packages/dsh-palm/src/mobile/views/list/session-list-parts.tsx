/**
 * Header, create row and filter chips for {@link SessionListView}. Presentation
 * only: every piece of state and every side effect stays in the view.
 */

import type { AgentPresetEntry, WorkspaceView as WorkspaceRow } from '../../../api-proxy-types'
import type { SessionFoldersView } from '../../api.ts'
import { HelpIcon } from '../../components/icons.tsx'
import { ThemeToggle } from '../../components/theme-toggle.tsx'
import { Button } from '../../ui/primitives.tsx'

export interface SessionListHeaderProps {
  workspace: WorkspaceRow
  onBack(): void
  onOpenSettings(): void
}

/** Header: back, workspace title/path, settings gear and the theme toggle. */
export function SessionListHeader({ workspace, onBack, onOpenSettings }: SessionListHeaderProps) {
  return (
      <header className="mobile-header">
        <div className="mobile-headerSlot">
          <Button type="button" className="mobile-back" aria-label="返回" onClick={onBack}>‹</Button>
        </div>
        <div className="mobile-titleWrap">
          <h1 className="mobile-title mobile-titleInline">{workspace.title}</h1>
          {/* Subordinate metadata: one mono line, ellipsized on overflow. */}
          <p className="mobile-titlePath">{workspace.path}</p>
        </div>
        <div className="mobile-headerSlot mobile-headerSlot-right">
          <Button type="button" className="mobile-iconbtn" aria-label="设置" onClick={onOpenSettings}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
                </svg>
              </Button>
          <ThemeToggle />
        </div>
      </header>
  )
}

export interface SessionListCreateProps {
  presets: readonly AgentPresetEntry[]
  selectedPreset: string | undefined
  selectedPresetEntry: AgentPresetEntry | undefined
  creating: boolean
  presetsLoading: boolean
  createError: string | undefined
  createHint: string | undefined
  onCreate(): void
  onOpenPicker(): void
  onOpenHelp(): void
}

/** Agent-mode card + the filled "new session" button. */
export function SessionListCreate({
  presets, selectedPreset, selectedPresetEntry, creating, presetsLoading, createError, createHint,
  onCreate, onOpenPicker, onOpenHelp,
}: SessionListCreateProps) {
  return (
      <>
      <div className="mobile-create">
        {presets.length > 0 && (
          <div className="mobile-presetCard">
            <Button
              type="button"
              className="mobile-presetTrigger"
              aria-label="Agent 模式"
              // 不再因为「当前没有选中项」而禁用：宿主返回的预设可能全是坏行，
              // 那样用户点它毫无反应、也不知道为什么。打开面板就能看到每个模式的状态。
              onClick={() => { onOpenPicker() }}
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
            </Button>
            <span className="mobile-presetCaret" aria-hidden>▾</span>
            <Button
              type="button"
              className="mobile-presetHelp"
              aria-label="模式说明"
              // 不要因为「这个模式没写说明」就 disabled：禁用按钮按下没有任何反馈，
              // 真机上就是「点问号没反应」（2026-10-29 反馈）。没说明时面板里
              // 给通用解释，总比一个点不动的图标强。
              onClick={() => { onOpenHelp() }}
            >
              <HelpIcon />
            </Button>
          </div>
        )}
        <Button
          type="button"
          className="mobile-new"
          disabled={creating || presetsLoading}
          onClick={() => { onCreate() }}
        >
          {creating ? '创建中…' : '新建会话'}
        </Button>
      </div>
      {createError !== undefined && (
        <p className="mobile-error mobile-pad">
          {createError}
          {createHint !== undefined && <span className="mobile-hint">{createHint}</span>}
        </p>
      )}
      </>
  )
}

/**
 * Fixed filters shown ahead of the host-side folders (F1). "待确认" reads the
 * mux pending mirror — the same source the run-overview page uses — so it needs
 * no extra host method.
 */
const FIXED_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'running', label: '运行中' },
  { id: 'pending', label: '待确认' },
] as const

export interface SessionListFiltersProps {
  folderFilter: string
  folders: SessionFoldersView | undefined
  onSelect(folderId: string): void
}

/** F1: the three fixed filters plus the host-side folder chips. */
export function SessionListFilters({ folderFilter, folders, onSelect }: SessionListFiltersProps) {
  // F1: fixed filters + host-side folders. An old host has no folders, so only
  // the three fixed chips render and the list is unchanged.
  return (
      <div className="sess-filters" role="tablist" aria-label="会话筛选">
        {FIXED_FILTERS.map(entry => (
          <Button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={folderFilter === entry.id}
            className={`sess-chip${folderFilter === entry.id ? ' sess-chip-on' : ''}`}
            onClick={() => { onSelect(entry.id) }}
          >
            {entry.label}
          </Button>
        ))}
        {(folders?.folders ?? []).map(folder => (
          <Button
            key={folder.id}
            type="button"
            role="tab"
            aria-selected={folderFilter === folder.id}
            className={`sess-chip${folderFilter === folder.id ? ' sess-chip-on' : ''}`}
            onClick={() => { onSelect(folder.id) }}
          >
            {folder.name}
          </Button>
        ))}
      </div>
  )
}
