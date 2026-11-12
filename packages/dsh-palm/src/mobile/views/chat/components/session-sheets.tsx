/**
 * 会话 ⋯ 菜单与导出面板。
 *
 * 2026-11-08 架构收敛：顶栏只剩 `☰ 标题 ⋯`，原来散在顶栏的四个图标收进这里。
 * 菜单只有**有数据源**的项才画：
 * - 这一轮的产物：要当前会话真的产出了文件（`artifactCount > 0`）；
 * - 在本会话内搜索：要有会话（空会话首屏没有可搜的正文）；
 * - 导出会话：同上；
 * - 切换主题：永远可用（主题是本地状态）；
 * - 设置：调用方给了入口才画。
 *
 * 导出仍复用原来的导出面板（Markdown / 单文件 HTML / 长图），文案里说明脱敏。
 */
import { FolderIcon, RowsIcon, SearchIcon, SlidersIcon, UpperRightIcon } from '../../../components/icons.tsx'
import { Sheet } from '../../../ui/sheet.tsx'
import { Button } from '../../../ui/primitives.tsx'

export interface ChatMoreMenuProps {
  open: boolean
  onClose(): void
  /** 这一轮产出的文件数；0 / undefined = 不画「产物」这一项。 */
  artifactCount?: number | undefined
  onOpenArtifacts?: (() => void) | undefined
  /** 会话内搜索；空会话没有这个入口。 */
  onToggleSearch?: (() => void) | undefined
  /** 打开导出面板；空会话没有这个入口。 */
  onOpenExport?: (() => void) | undefined
  /** 任务页入口（进行中 / 刚完成的总览）。 */
  onOpenTasks?: (() => void) | undefined
  onOpenSettings?: (() => void) | undefined
}

/**
 * 渲染 ⋯ 菜单（底部 sheet）。
 *
 * @param props - 各入口是否可用与动作
 * @returns 菜单浮层；`open=false` 时什么都不渲染
 */
export function ChatMoreMenu(props: ChatMoreMenuProps) {
  if (!props.open) return null
  const artifactCount = props.artifactCount ?? 0
  const showArtifacts = props.onOpenArtifacts !== undefined && artifactCount > 0
  return (
    <Sheet title="更多" onClose={props.onClose}>
      <div role="menu" aria-label="会话操作">
        {showArtifacts ? (
          <Button
            type="button"
            role="menuitem"
            className="sheet-option"
            onClick={() => { props.onClose(); props.onOpenArtifacts?.() }}
          >
            <FolderIcon />
            <span className="sheet-option-copy">
              <span className="sheet-option-title">这一轮的产物</span>
            </span>
            <span className="sheet-option-check">{artifactCount} 个文件</span>
          </Button>
        ) : null}
        {props.onToggleSearch === undefined ? null : (
          <Button
            type="button"
            role="menuitem"
            className="sheet-option"
            onClick={() => { props.onClose(); props.onToggleSearch?.() }}
          >
            <SearchIcon />
            <span className="sheet-option-copy">
              <span className="sheet-option-title">在本会话内搜索</span>
            </span>
          </Button>
        )}
        {props.onOpenExport === undefined ? null : (
          <Button
            type="button"
            role="menuitem"
            className="sheet-option"
            onClick={() => { props.onClose(); props.onOpenExport?.() }}
          >
            <UpperRightIcon />
            <span className="sheet-option-copy">
              <span className="sheet-option-title">导出会话</span>
            </span>
            <span className="sheet-option-check">Markdown</span>
          </Button>
        )}
        {/* 「设置」不属于这一轮的内容，用一条细线隔开：上面是"看这一轮"，
            下面是"改这套 App"。分隔线本来就有样式，只是这里没用上。 */}
        {props.onOpenSettings === undefined ? null : <div className="sheet-option-divider" />}
        {/* 「任务」跟「设置」一样是全局功能，不是这一轮的内容：放在分隔线下面。 */}
        {props.onOpenTasks === undefined ? null : (
          <Button
            type="button"
            role="menuitem"
            className="sheet-option"
            onClick={() => { props.onClose(); props.onOpenTasks?.() }}
          >
            <RowsIcon />
            <span className="sheet-option-copy">
              <span className="sheet-option-title">任务</span>
              <span className="sheet-option-desc">进行中 / 刚完成的会话</span>
            </span>
          </Button>
        )}
        {props.onOpenSettings === undefined ? null : (
          <Button
            type="button"
            role="menuitem"
            className="sheet-option"
            onClick={() => { props.onClose(); props.onOpenSettings?.() }}
          >
            <SlidersIcon />
            <span className="sheet-option-copy">
              <span className="sheet-option-title">设置</span>
            </span>
          </Button>
        )}
      </div>
    </Sheet>
  )
}

export interface SessionSheetsProps {
  moreOpen: boolean
  setMoreOpen: (next: boolean) => void
  exportOpen: boolean
  setExportOpen: (next: boolean) => void
  /** ⋯ 菜单的各项数据（不传就没有那一项）。 */
  artifactCount?: number | undefined
  onOpenArtifacts?: (() => void) | undefined
  onToggleSearch?: (() => void) | undefined
  /** 任务页入口（进行中 / 刚完成的总览）。 */
  onOpenTasks?: (() => void) | undefined
  onOpenSettings?: (() => void) | undefined
  onCopyExport: (format: 'md' | 'html') => void
  onDownloadExport: (format: 'md' | 'html') => void
  onDownloadLongImage: () => void
}

export function SessionSheets(props: SessionSheetsProps) {
  const {
    moreOpen, setMoreOpen, exportOpen, setExportOpen, artifactCount, onOpenArtifacts,
    onToggleSearch, onOpenSettings, onCopyExport, onDownloadExport, onDownloadLongImage,
  } = props

  return (
    <>
      <ChatMoreMenu
        open={moreOpen}
        onClose={() => { setMoreOpen(false) }}
        {...(artifactCount === undefined ? {} : { artifactCount })}
        {...(onOpenArtifacts === undefined ? {} : { onOpenArtifacts })}
        {...(onToggleSearch === undefined ? {} : { onToggleSearch })}
        {...(onOpenSettings === undefined ? {} : { onOpenSettings })}
        onOpenExport={() => { setExportOpen(true) }}
      />
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
    </>
  )
}
