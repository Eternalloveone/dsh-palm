/**
 * ⑩ 单文件 diff（独立页面，P6 第 2 屏迁移）。
 *
 * 以前在浮层里看 diff：浮层只占半屏、上面压着输入框，翻代码时手势和滚动抢。
 * 这一屏把同一个 `FilePreviewSheet` 的数据与渲染搬进独立页面，返回由页面栈负责。
 *
 * 复用策略：**渲染完全复用 `FilePreviewSheet`**（里面已经处理了加载中/失败/无改动/有 diff
 * 四种状态与行号对齐），这里只提供页面外壳与该有的滚动容器；等 P8 清账时再把浮层外壳摘掉。
 *
 * @module dsh-palm/mobile/views/DiffView
 */
import { FilePreviewSheet } from '../components/file-preview-sheet.tsx'
import { diffLayout } from '../layouts/screens.ts'
import { SlotLayout } from '../ui/slot-layout.tsx'
import { IconButton } from '../ui/primitives.tsx'

/** 从路径取文件名（标题只显示最后一段，路径放到副标题）。 */
function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

/** 路径的目录部分（没有目录时返回空串）。 */
function parentPath(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index <= 0 ? '' : path.slice(0, index)
}

export interface DiffViewProps {
  /** 文件路径（可能相对会话 cwd）。 */
  path: string
  /** 归属会话：相对路径按它的 cwd 解析。 */
  sessionId: string
  onBack(): void
}

/**
 * 渲染单文件 diff 页。
 *
 * @param props - 文件路径、会话 id 与返回回调
 * @returns diff 页
 */
export function DiffView({ path, sessionId, onBack }: DiffViewProps) {
  const parent = parentPath(path)

  return (
    <SlotLayout
      spec={diffLayout}
      className="diff-page"
      slots={{
        header: (
          <header className="mobile-header">
            <div className="mobile-headerSlot">
              <IconButton label="返回" className="mobile-back" onClick={onBack}>‹</IconButton>
            </div>
            <h1 className="mobile-title" title={path}>{baseName(path)}</h1>
            <div className="mobile-headerSlot mobile-headerSlot-right" />
            {parent === '' ? null : <p className="diff-page-path">{parent}</p>}
          </header>
        ),
        diff: (
          <div className="diff-page-body">
            <FilePreviewSheet path={path} sessionId={sessionId} onClose={onBack} />
          </div>
        ),
        pager: (
          <p className="diff-page-hint">
            改动来自宿主的工作区；这里只读，不做编辑。
          </p>
        ),
      }}
    />
  )
}
