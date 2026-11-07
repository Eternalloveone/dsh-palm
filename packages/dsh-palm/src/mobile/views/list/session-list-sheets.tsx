/**
 * Bottom sheets and dialogs for {@link SessionListView} (Agent-mode picker and
 * help, row action menu, delete confirm, folder picker, rename, new folder).
 * Presentation only — the view owns the state, these call back into it.
 */

import type { AgentPresetEntry } from '../../../api-proxy-types'
import type { SessionFoldersView } from '../../api.ts'
import type { SessionView } from '../../shared/session-view.ts'
import { Sheet } from '../../ui/sheet.tsx'
import { ConfirmDialog, PromptDialog } from '../../components/dialog.tsx'
import { presetHelpIsBuiltin, presetHelpText } from '../../platform/agent-preset-help.ts'
import { CheckIcon } from '../../components/icons.tsx'
import { Button } from '../../ui/primitives.tsx'

export interface PresetPickerSheetProps {
  presets: readonly AgentPresetEntry[]
  selectedPreset: string | undefined
  onClose(): void
  onSelect(presetId: string): void
}

/** Agent-mode picker (one option per host preset). */
export function PresetPickerSheet({ presets, selectedPreset, onClose, onSelect }: PresetPickerSheetProps) {
  return (
        <Sheet title="选择 Agent 模式" onClose={onClose}>
          {presets.map((preset, index) => (
            <div key={preset.id}>
              {index > 0 && <div className="sheet-option-divider" aria-hidden />}
              <Button
                type="button"
                className={`sheet-option${preset.id === selectedPreset ? ' sheet-option-selected' : ''}`}
                disabled={preset.broken !== undefined}
                onClick={() => {
                  onSelect(preset.id)
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
              </Button>
            </div>
          ))}
        </Sheet>
  )
}

export interface PresetHelpSheetProps {
  presets: readonly AgentPresetEntry[]
  selectedPreset: string | undefined
  onClose(): void
}

/** Agent-mode explainer: every host preset with its description. */
export function PresetHelpSheet({ presets, selectedPreset, onClose }: PresetHelpSheetProps) {
  return (
        <Sheet title="Agent 模式说明" onClose={onClose}>
          {/* 以前这里只显示"当前选中那个模式"的一句说明，而且宿主没写 description 时
              就只剩一段通用解释 —— 真机上看起来就是「点了问号，什么模式说明都没有」。
              现在把**每个模式**都列出来，各带自己的特点说明。 */}
          {presets.length === 0 ? (
            <p className="sheet-confirm-desc">
              宿主还没返回可用的 Agent 模式。模式决定新会话的系统提示词与可用工具集；
              加载完成后这里会列出每个模式的特点。
            </p>
          ) : (
            <div className="preset-help-list">
              {presets.map(entry => {
                const current = entry.id === selectedPreset
                return (
                  <div key={entry.id} className="preset-help-item">
                    <div className="preset-help-head">
                      <span className="preset-help-name">{entry.name ?? entry.id}</span>
                      {entry.isDefault === true && <span className="preset-help-tag">默认</span>}
                      {current && <span className="preset-help-tag preset-help-tag-current">当前</span>}
                      {entry.broken !== undefined && <span className="preset-help-tag">不可用</span>}
                    </div>
                    <p className="sheet-confirm-desc">
                      {presetHelpText(entry.id, entry.description)
                        ?? '这个模式没有写说明（仍可用：它决定新会话的系统提示词与工具集）。'}
                      {presetHelpIsBuiltin(entry.id, entry.description) ? '（dsh-palm 内置说明）' : ''}
                    </p>
                  </div>
                )
              })}
            </div>
          )}
          <p className="sheet-confirm-desc">
            模式对本工作区生效：切换后新建的会话才用新模式，已有会话保持原样。
          </p>
        </Sheet>
  )
}

export interface SessionMenuSheetProps {
  session: SessionView
  pinned: boolean
  onClose(): void
  onTogglePin(): void
  onRename(): void
  onMoveToFolder(): void
  onDelete(): void
}

/** Long-press row menu: pin, rename, move to folder, delete. */
export function SessionMenuSheet({ session, pinned, onClose, onTogglePin, onRename, onMoveToFolder, onDelete }: SessionMenuSheetProps) {
  return (
        <Sheet title={session.title} onClose={onClose}>
          <div role="menu" aria-label="会话操作">
            <div className="sheet-option-divider" aria-hidden />
            <Button
              type="button"
              role="menuitem"
              className="sheet-option"
              onClick={() => { onTogglePin() }}
            >
              <span className="sheet-option-copy">
                <span className="sheet-option-title">{pinned ? '取消置顶' : '置顶'}</span>
              </span>
            </Button>
            <Button
              type="button"
              role="menuitem"
              className="sheet-option"
              onClick={() => { onRename() }}
            >
              <span className="sheet-option-copy">
                <span className="sheet-option-title">重命名</span>
              </span>
            </Button>
            <Button
              type="button"
              role="menuitem"
              className="sheet-option"
              onClick={() => { onMoveToFolder() }}
            >
              <span className="sheet-option-copy">
                <span className="sheet-option-title">移到分组…</span>
              </span>
            </Button>
            <Button
              type="button"
              role="menuitem"
              className="sheet-option"
              onClick={() => { onDelete() }}
            >
              <span className="sheet-option-copy">
                <span className="sheet-option-title" style={{ color: 'var(--danger)' }}>删除会话</span>
              </span>
            </Button>
          </div>
        </Sheet>
  )
}

export interface DeleteSessionDialogProps {
  session: SessionView
  onCancel(): void
  onConfirm(): void
}

/** Destructive confirm for the row's delete action. */
export function DeleteSessionDialog({ session, onCancel, onConfirm }: DeleteSessionDialogProps) {
  return (
        <ConfirmDialog
          title="删除会话"
          body={<>确定删除「{session.title}」吗？该会话将从所有设备消失（电脑上的会话记录保留，可从桌面找回）。</>}
          confirmLabel="删除"
          tone="danger"
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
  )
}

export interface SessionFolderSheetProps {
  folders: SessionFoldersView | undefined
  onClose(): void
  onAssign(folderId: string | null): void
  onCreateFolder(): void
}

/** "Move to folder" sheet (host-side folders; null removes the assignment). */
export function SessionFolderSheet({ folders, onClose, onAssign, onCreateFolder }: SessionFolderSheetProps) {
  return (
        <Sheet title="移到分组" onClose={onClose}>
          <div role="menu" aria-label="选择分组">
            <div className="sheet-option-divider" aria-hidden />
            <Button
              type="button"
              role="menuitem"
              className="sheet-option"
              onClick={() => { onAssign(null) }}
            >
              <span className="sheet-option-copy">
                <span className="sheet-option-title">移出分组</span>
              </span>
            </Button>
            {(folders?.folders ?? []).map(folder => (
              <Button
                key={folder.id}
                type="button"
                role="menuitem"
                className="sheet-option"
                onClick={() => { onAssign(folder.id) }}
              >
                <span className="sheet-option-copy">
                  <span className="sheet-option-title">{folder.name}</span>
                </span>
              </Button>
            ))}
            <Button
              type="button"
              role="menuitem"
              className="sheet-option"
              onClick={() => { onCreateFolder() }}
            >
              <span className="sheet-option-copy">
                <span className="sheet-option-title">新建分组…</span>
              </span>
            </Button>
          </div>
        </Sheet>
  )
}

export interface RenameSessionDialogProps {
  session: SessionView
  onCancel(): void
  onConfirm(title: string): void
}

/** Rename prompt (host RPC, optimistic row patch happens in the view). */
export function RenameSessionDialog({ session, onCancel, onConfirm }: RenameSessionDialogProps) {
  return (
        <PromptDialog
          title="重命名会话"
          initial={session.title}
          confirmLabel="保存"
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
  )
}

export interface CreateFolderDialogProps {
  onCancel(): void
  onConfirm(name: string): void
}

/** "New folder" prompt. */
export function CreateFolderDialog({ onCancel, onConfirm }: CreateFolderDialogProps) {
  return (
        <PromptDialog
          title="新建分组"
          initial=""
          confirmLabel="创建"
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
  )
}
