/**
 * 工具详情面板（C1，2026-11-10）。
 *
 * 桌面端点一次工具行能看到「参数 / 输出 / 耗时 / 改了哪些文件」；手机端以前点开只摊
 * 一段原始参数，输出文本在 fold 阶段就被丢了。这个面板补齐四件事：
 *
 *  1. **状态 + 耗时**：运行中 / 完成 / 失败 / 已中断，以及调用到结果的毫秒差；
 *  2. **参数**：原始 JSON（等宽、可滚）；
 *  3. **输出**：`tool/result` 的文字块（截断到 200 行，`render/messages.ts` 里做的）；
 *  4. **改动文件**：路径行点开文件预览，下面直接给这份文件的真 hunk（`render/line-diff.ts`）。
 *
 * 复用既有 `.sheet-*` / `.chat-tool-diff-*` / `.chat-tool-args` 样式，不新增类名 ——
 * CSS 类名预算是 800，加一个就得删一个。
 *
 * @module dsh-palm/mobile/components/tool-detail-sheet
 */
import { useMemo, useState } from 'react'
import type { ToolCallInfo } from '../render/messages.ts'
import { stepModel } from '../render/step-view.ts'
import { lineDiffRows } from '../render/line-diff.ts'
import { Button } from '../ui/primitives.tsx'
import { Sheet, SheetPortal } from '../ui/sheet.tsx'
import { FilePreviewSheet } from './file-preview-sheet.tsx'
import { absolutePathOf } from '../message-row/artifact-cards.tsx'
import { ToolImages } from '../message-row/tool-images.tsx'

/** 状态用中文写出来：不靠颜色也能读。 */
const STATE_LABELS: Record<string, string> = {
  running: '运行中',
  ok: '完成',
  error: '失败',
  stopped: '已中断',
}

/** 毫秒 → 人话（1.2 秒 / 1 分 03 秒 / 850 毫秒）。 */
export function durationTextOf(startedAt: number | undefined, endedAt: number | undefined): string | undefined {
  if (startedAt === undefined || endedAt === undefined) return undefined
  const ms = Math.max(0, endedAt - startedAt)
  if (ms < 1000) return `${String(Math.round(ms))} 毫秒`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} 秒`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${String(minutes)} 分 ${String(seconds).padStart(2, '0')} 秒`
}

export interface ToolDetailSheetProps {
  tool: ToolCallInfo
  /** 文件预览要按会话 cwd 解析相对路径。 */
  sessionId?: string
  onClose(): void
}

/** 一次工具调用的详情面板。 */
export function ToolDetailSheet({ tool, sessionId, onClose }: ToolDetailSheetProps) {
  const [preview, setPreview] = useState<string | null>(null)
  const model = stepModel(tool)
  const stateLabel = tool.state === undefined ? undefined : STATE_LABELS[tool.state]
  const duration = durationTextOf(tool.startedAt, tool.endedAt)

  // 改动文件 = 结果元信息里的路径 ∪ diff 卡里的路径（后者带新旧正文，能画真 hunk）。
  const files = useMemo(() => {
    const diffs = new Map<string, { oldText?: string; newText: string }>()
    for (const diff of tool.view?.diffs ?? []) {
      const oldText = diff.oldText ?? undefined
      diffs.set(diff.path, { ...(oldText === undefined ? {} : { oldText }), newText: diff.newText })
    }
    const paths = [...new Set([...(tool.metaPaths ?? []), ...diffs.keys()])]
    return paths.map(path => ({ path, diff: diffs.get(path) }))
  }, [tool])

  const args = useMemo(() => {
    if (tool.arguments === undefined) return undefined
    try {
      return JSON.stringify(JSON.parse(tool.arguments), null, 2)
    } catch {
      return tool.arguments
    }
  }, [tool.arguments])

  const body = (
    <>
      <p className="sheet-option-desc">
        {[stateLabel, duration === undefined ? undefined : `耗时 ${duration}`]
          .filter(part => part !== undefined)
          .join(' · ')}
      </p>
      {args === undefined ? null : (
        <pre className="chat-tool-args" aria-label="参数">{args}</pre>
      )}
      {/* 图片：面板里最多 8 张，点开跟消息图片一样进全屏 lightbox。 */}
      <ToolImages tool={tool} {...(sessionId === undefined ? {} : { sessionId })} max={8} />
      {tool.output === undefined ? null : (
        <pre className="chat-tool-args" aria-label="输出">{tool.output}</pre>
      )}
      {files.length === 0 ? null : (
        <div>
          {files.map(file => (
            <div key={file.path} className="chat-tool-diff-file" data-path={file.path}>
              <Button
                type="button"
                className="chat-tool-diff-row chat-tool-diff-path"
                aria-label={`预览文件：${file.path}`}
                {...(sessionId === undefined ? {} : { onClick: () => { setPreview(absolutePathOf(file.path, tool.metaPaths)) } })}
              >
                <span className="chat-tool-diff-text">{file.path}</span>
              </Button>
              {file.diff === undefined ? null : lineDiffRows(file.diff.oldText ?? '', file.diff.newText, { maxRows: 40 }).map((row, index) => (
                <div
                  key={index}
                  className={'chat-tool-diff-row' + (row.kind === 'del' ? ' chat-tool-diff-del' : row.kind === 'add' ? ' chat-tool-diff-add' : '')}
                >
                  {row.kind === 'del' || row.kind === 'add'
                    ? <span className="chat-tool-diff-sign" aria-hidden>{row.kind === 'del' ? '−' : '+'}</span>
                    : null}
                  <span className="chat-tool-diff-text">{row.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  )

  return (
    <SheetPortal>
      <Sheet title={model.summary === '' ? model.title : `${model.title} · ${model.summary}`} onClose={onClose}>
        {body}
        {preview !== null && sessionId !== undefined && (
          <FilePreviewSheet path={preview} sessionId={sessionId} onClose={() => { setPreview(null) }} />
        )}
      </Sheet>
    </SheetPortal>
  )
}
