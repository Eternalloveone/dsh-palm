/**
 * **聊天记录导出**（W3：从 \`ChatView.tsx\` 组件体内抽出的第一个 hook）。
 *
 * 三种导出：Markdown、单文件 HTML、长图 PNG。共同点是**都在本地完成**——不走宿主流，
 * 断网也能导；代价是浏览器得支持 Blob / canvas，所以两条都要有降级提示
 * （"改用 Markdown"），绝不能点了没反应。
 *
 * 为什么值得单独存在：导出逻辑散在组件体里时，改长图渲染要在一万行里找，
 * 而且"导出的到底是不是用户看到的那些行"这件事没人能一眼验证。
 *
 * @module dsh-palm/mobile/views/chat/use-chat-export
 */
import { useCallback } from 'react'

import { copyText } from '../../../render/code-actions.ts'
import { exportMarkdown, exportSingleFileHtml, type ExportRow } from '../../../platform/export.ts'
import { drawLongImage, LONG_IMAGE_DEFAULTS } from '../../../platform/long-image.ts'
import { sanitizeFileName } from '../../../shared/text.ts'
import type { RenderMessage } from '../../../render/messages.ts'

/** 导出用的行：只要用户/助手/命令三类，且正文非空 —— 折叠卡与工具步骤不该进记录。 */
export function exportRowsOf(messages: readonly RenderMessage[]): ExportRow[] {
  return messages
    .filter(message => message.kind === 'user' || message.kind === 'assistant' || message.kind === 'command')
    .filter(message => message.text.trim() !== '')
    .map((message): ExportRow => ({
      role: message.kind as ExportRow['role'],
      text: message.kind === 'command' && message.commandLine !== undefined
        ? `${message.commandLine}\n${message.text}`.trim()
        : message.text,
    }))
}

/** 把记录存成文件（blob + 隐藏锚点，无宿主往返）。 */
function saveBlob(body: string, filename: string, mime: string): void {
  const blob = new Blob([body], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => { URL.revokeObjectURL(url) }, 10_000)
}

/** 导出动作集合。 */
export interface ChatExportActions {
  copyExport: (format: 'md' | 'html') => void
  downloadExport: (format: 'md' | 'html') => void
  downloadLongImage: () => void
}

/** @param title - 会话标题（既是文件名也是文档标题）。@param messages - 当前会话的行。 */
export function useChatExport(
  title: string,
  messages: readonly RenderMessage[],
  toast: (text: string) => void,
): ChatExportActions {
  const buildExport = useCallback((format: 'md' | 'html'): string => {
    const rows = exportRowsOf(messages)
    return format === 'html' ? exportSingleFileHtml(title, rows) : exportMarkdown(title, rows)
  }, [title, messages])

  const copyExport = useCallback((format: 'md' | 'html'): void => {
    void copyText(buildExport(format), '已复制，疑似密钥已隐藏')
  }, [buildExport])

  const downloadExport = useCallback((format: 'md' | 'html'): void => {
    saveBlob(
      buildExport(format),
      `${sanitizeFileName(title, 60)}.${format}`,
      format === 'html' ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8',
    )
    toast(format === 'html' ? '已导出单文件 HTML' : '已导出 Markdown')
  }, [buildExport, title, toast])

  /**
   * 长图：把记录画进 canvas 再存 PNG。会话过长时 `LONG_IMAGE_DEFAULTS.maxHeight`
   * 会截断（界面上有「分段导出」的说法）；没有 2D 上下文就退回提示改用 Markdown——
   * 绝不静默失败。
   */
  const downloadLongImage = useCallback((): void => {
    try {
      const canvas = document.createElement('canvas')
      drawLongImage(canvas, title, exportRowsOf(messages), LONG_IMAGE_DEFAULTS)
      const save = (url: string): void => {
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `${sanitizeFileName(title, 60)}.png`
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        window.setTimeout(() => { URL.revokeObjectURL(url) }, 10_000)
        toast('长图已保存')
      }
      if (typeof canvas.toBlob === 'function') {
        canvas.toBlob((blob) => {
          if (blob === null) { toast('长图生成失败，请改用 Markdown'); return }
          save(URL.createObjectURL(blob))
        }, 'image/png')
        return
      }
      save(canvas.toDataURL('image/png'))
    } catch {
      toast('当前浏览器不支持长图，请改用 Markdown')
    }
  }, [messages, title, toast])

  return { copyExport, downloadExport, downloadLongImage }
}
