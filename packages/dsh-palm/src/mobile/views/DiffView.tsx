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
import { useEffect, useState } from 'react'
import type { FilePreview } from '../mobile-types.ts'
import { readFile } from '../data/fs.ts'
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

/** 页面三种状态：读取中 / 宿主拒绝 / 读到了（文本或图片）。 */
type PreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; preview: FilePreview }

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
  const [state, setState] = useState<PreviewState>({ status: 'loading' })

  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    readFile(path, sessionId).then(
      (preview) => { if (alive) setState({ status: 'ready', preview }) },
      (error: unknown) => {
        if (!alive) return
        const message = error instanceof Error ? error.message : '文件不可读'
        setState({ status: 'error', message })
      },
    )
    return () => { alive = false }
  }, [path, sessionId])

  const ready = state.status === 'ready' ? state.preview : undefined
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
              {ready !== undefined && ready.kind === 'text' ? (
                <IconButton
                  label="复制文件原文"
                  className="mobile-iconbtn"
                  onClick={() => { void copyText(ready.text, '已复制文件原文') }}
                >
                  <CopyIcon />
                </IconButton>
              ) : null}
            </div>
          </header>
        ),
        diff: (
          <div className="diff-page-body">
            {state.status === 'loading' ? (
              <p className="diff-page-loading">正在读取文件…</p>
            ) : null}
            {state.status === 'error' ? (
              <p className="diff-page-error" role="alert">{state.message}</p>
            ) : null}
            {ready !== undefined ? (
              ready.kind === 'image' ? (
                <div className="diff-page-image-wrap">
                  <img className="diff-page-image" src={ready.dataUrl} alt={ready.name} draggable={false} />
                </div>
              ) : (
                <DiffRows text={ready.text} />
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
