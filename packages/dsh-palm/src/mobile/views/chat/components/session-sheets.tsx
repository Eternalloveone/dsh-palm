/**
 * 会话操作菜单与它的结果面板：重命名 / 复制 ID / 导出对话 / 查看改动 / 删除。
 *
 * S6e 从 `ChatView` 搬出。这些面板只做"用户选了哪一项"，真正的动作（重命名、删除、
 * 导出、跑 git 读取）都在会话层，通过回调打回去。
 *
 * 两个真机/安全细节原样保留：
 * - 导出面板的提示文案写在面板里（分享出去的文本进 issue/群聊，收不回；脱敏在 redact.ts）；
 * - 删除的确认文案说明"电脑上的会话记录保留"，否则用户以为删了就彻底没了。
 */
import { ConfirmDialog, PromptDialog } from '../../../dialog.tsx'
import { PencilIcon } from '../../../icons.tsx'
import { Sheet } from '../../../sheet.tsx'
import { GitSheet } from '../../../sheets.tsx'
import { Button } from '../../../ui/primitives.tsx'

export interface SessionSheetsProps {
  moreOpen: boolean
  setMoreOpen: (next: boolean) => void
  exportOpen: boolean
  setExportOpen: (next: boolean) => void
  gitOpen: boolean
  setGitOpen: (next: boolean) => void
  renaming: boolean
  setRenaming: (next: boolean) => void
  deleting: boolean
  setDeleting: (next: boolean) => void
  /** 会话标题（重命名回填 / 删除确认文案）。 */
  title: string
  /** 会话工作目录（「查看改动」只在有 cwd 时出现）。 */
  cwd: string | undefined
  onCopySessionId: () => void
  onRename: (value: string) => void
  onDelete: () => void
  onCopyExport: (format: 'md' | 'html') => void
  onDownloadExport: (format: 'md' | 'html') => void
  onDownloadLongImage: () => void
}

export function SessionSheets(props: SessionSheetsProps) {
  const {
    moreOpen, setMoreOpen, exportOpen, setExportOpen, gitOpen, setGitOpen, renaming, setRenaming,
    deleting, setDeleting, title, cwd, onCopySessionId, onRename, onDelete, onCopyExport,
    onDownloadExport, onDownloadLongImage,
  } = props

  return (
    <>
      {moreOpen && (
        <Sheet title={title} onClose={() => { setMoreOpen(false) }}>
          <div role="menu" aria-label="会话操作">
            <Button
              type="button"
              role="menuitem"
              className="sheet-option"
              onClick={() => { setMoreOpen(false); setRenaming(true) }}
            >
              <span className="sheet-option-copy">
                <span className="sheet-option-title">重命名会话</span>
              </span>
              <PencilIcon width={16} height={16} />
            </Button>
            <Button
              type="button"
              role="menuitem"
              className="sheet-option"
              onClick={() => { setMoreOpen(false); onCopySessionId() }}
            >
              <span className="sheet-option-copy">
                <span className="sheet-option-title">复制会话 ID</span>
              </span>
            </Button>
            <Button
              type="button"
              role="menuitem"
              className="sheet-option"
              onClick={() => { setMoreOpen(false); setExportOpen(true) }}
            >
              <span className="sheet-option-copy">
                <span className="sheet-option-title">导出对话</span>
                <span className="sheet-option-desc">Markdown / 单文件 HTML，自动隐藏疑似密钥</span>
              </span>
            </Button>
            {cwd !== undefined && cwd !== '' && (
              <Button
                type="button"
                role="menuitem"
                className="sheet-option"
                onClick={() => { setMoreOpen(false); setGitOpen(true) }}
              >
                <span className="sheet-option-copy">
                  <span className="sheet-option-title">查看改动</span>
                  <span className="sheet-option-desc">分支、未提交的改动、最近提交</span>
                </span>
              </Button>
            )}
            <div className="sheet-option-divider" aria-hidden />
            <Button
              type="button"
              role="menuitem"
              className="sheet-option"
              onClick={() => { setMoreOpen(false); setDeleting(true) }}
            >
              <span className="sheet-option-copy">
                <span className="sheet-option-title" style={{ color: 'var(--danger)' }}>删除会话</span>
              </span>
            </Button>
          </div>
        </Sheet>
      )}
      {exportOpen && (
        <Sheet title="导出对话" onClose={() => { setExportOpen(false) }}>
          {/* 分享出去的文本会进 issue、群聊、邮件 —— 一旦发出去就收不回。
              所以每条路径都先过 redact.ts（不是各调用点自己记得脱敏）。 */}
          <div role="menu" aria-label="导出方式">
            <Button
              type="button"
              role="menuitem"
              className="sheet-option"
              onClick={() => { setExportOpen(false); onCopyExport('md') }}
            >
              <span className="sheet-option-copy">
                <span className="sheet-option-title">复制 Markdown</span>
                <span className="sheet-option-desc">整段对话，适合贴进 issue / 笔记</span>
              </span>
            </Button>
            <Button
              type="button"
              role="menuitem"
              className="sheet-option"
              onClick={() => { setExportOpen(false); onDownloadExport('md') }}
            >
              <span className="sheet-option-copy">
                <span className="sheet-option-title">下载 .md</span>
              </span>
            </Button>
            <Button
              type="button"
              role="menuitem"
              className="sheet-option"
              onClick={() => { setExportOpen(false); onDownloadExport('html') }}
            >
              <span className="sheet-option-copy">
                <span className="sheet-option-title">下载单文件 HTML</span>
                <span className="sheet-option-desc">无需联网、无外部资源，双击即可读</span>
              </span>
            </Button>
            <Button
              type="button"
              role="menuitem"
              className="sheet-option"
              onClick={() => { setExportOpen(false); onDownloadLongImage() }}
            >
              <span className="sheet-option-copy">
                <span className="sheet-option-title">保存长图（PNG）</span>
                <span className="sheet-option-desc">整段对话一张图；超长会自动截断并提示分段</span>
              </span>
            </Button>
          </div>
          <p className="sheet-note">
            导出内容会自动隐藏疑似密钥（sk-…、Bearer、URL 里的密码、私钥块等）。
          </p>
        </Sheet>
      )}
      {gitOpen && cwd !== undefined && cwd !== '' && (
        <GitSheet cwd={cwd} onClose={() => { setGitOpen(false) }} />
      )}
      {renaming && (
        <PromptDialog
          title="重命名会话"
          initial={title}
          confirmLabel="保存"
          onCancel={() => { setRenaming(false) }}
          onConfirm={(value) => { void onRename(value) }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="删除会话"
          body={<>确定删除「{title}」吗？该会话将从所有设备消失（电脑上的会话记录保留，可从桌面找回）。</>}
          confirmLabel="删除"
          tone="danger"
          onCancel={() => { setDeleting(false) }}
          onConfirm={onDelete}
        />
      )}
    </>
  )
}
