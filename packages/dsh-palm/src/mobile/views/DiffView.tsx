/**
 * ⑩ 单文件 diff（独立页面，P6 第 2 屏迁移；2026-11-08 按定版图重做视觉）。
 *
 * 定版图把这一屏画成两层：顶部是**文件名 + 路径**（长路径一行截断），下面是
 * **一张等宽代码卡**——行号在最左，新增行浅绿底、删除行浅红底、上下文行不染色，
 * 窄屏不出现横向滚动条。
 *
 * 数据仍然走原来那条 `mobile.readFile`（相对路径按会话 cwd 解析）：本页只做
 * 只读展示，不碰工作区、不做编辑。解析 diff 的仍是 `render/diff.ts` 的
 * `parseDiff`（生成逻辑未改），行视图在 `components/diff-rows.tsx`。
 *
 * 视图层不直连 `api.ts` / `mux.ts`：取数走 `data/fs.ts` 门面（与模型页同一条
 * 规矩），样式全部追加在 `styles/450-diff-page.css`。
 *
 * @module dsh-palm/mobile/views/DiffView
 */
import type { FilePreview } from '../mobile-types.ts'
import { readFile } from '../data/fs.ts'
import { pageKey, usePage } from '../page-cache.ts'
import { DiffRows } from '../components/diff-rows.tsx'
import { CopyIcon } from '../components/icons.tsx'
import { copyText } from '../render/code-actions.ts'
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
  // 页面级 cache-first：同一会话下再开同一个文件先画上次内容，后台再读一遍；
  // 键里带 sessionId —— 换会话就是另一份缓存。
  const page = usePage(pageKey('diff', sessionId, path), () => readFile(path, sessionId))
  const preview: FilePreview | undefined = page.value
  const message = preview === undefined ? page.error : undefined
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
            <div className="mobile-titleWrap">
              <h1 className="mobile-title mobile-titleInline" title={path}>{baseName(path)}</h1>
              {parent === '' ? null : <p className="diff-page-path" title={path}>{parent}</p>}
            </div>
            <div className="mobile-headerSlot mobile-headerSlot-right">
              {preview !== undefined && preview.kind === 'text' ? (
                <IconButton
                  label="复制文件原文"
                  className="mobile-iconbtn"
                  onClick={() => { void copyText(preview.text, '已复制文件原文') }}
                >
                  <CopyIcon />
                </IconButton>
              ) : null}
            </div>
          </header>
        ),
        diff: (
          <div className="diff-page-body">
            {preview === undefined && message === undefined ? (
              <p className="diff-page-loading">正在读取文件…</p>
            ) : null}
            {message !== undefined ? (
              <p className="diff-page-error" role="alert">{message}</p>
            ) : null}
            {preview !== undefined ? (
              preview.kind === 'image' ? (
                <div className="diff-page-image-wrap">
                  <img className="diff-page-image" src={preview.dataUrl} alt={preview.name} draggable={false} />
                </div>
              ) : (
                <DiffRows text={preview.text} />
              )
            ) : null}
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
