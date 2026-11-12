/**
 * 工具产出的图片（C1 重构 S1–S4，2026-11-10 用户定版「缩略图放在标题行下一行」）。
 *
 * 两个来源：
 *  1. **附件图片**：`tool/result` 的 `image` 块（`imagesFromContent` 折出来的
 *     `attachmentId`），走内容寻址缓存，重挂不重复请求；
 *  2. **文件路径**（S4）：write/read 产生的 `xxx.png` 只有路径没有附件 id，按
 *     `readFile` 取 `dataUrl`（带模块级缓存，最多 2 条）。
 *
 * 渲染复用消息图片那套（`.chat-msg-images` + `.chat-msg-image`）：尺寸、圆角、
 * 失败占位、点击全屏（ChatView 里任意 `<img>` 的点击都开 lightbox）全部一致，
 * 不新增 CSS 类名（类名预算是 800）。
 *
 * @module dsh-palm/mobile/message-row/tool-images
 */
import { useEffect, useState } from 'react'
import type { MessageImage, ToolCallInfo } from '../render/messages.ts'
import { readFile } from '../data/fs.ts'
import { MessageImageTile } from './attachments.tsx'

/** 过程条里最多画几张（再多就只留详情面板里看全）。 */
const STRIP_MAX = 3

/** 图片扩展名：决定"这条路径值不值得读成图片"。 */
const IMAGE_EXT = /\.(?:png|jpe?g|webp|gif|bmp)$/iu

/** 路径 → dataUrl 缓存：同一张图在过程条与详情面板里只读一次。 */
// 键要带会话：两个会话里同名的 a.png 是两张图，缓存不能串。
const pathCache = new Map<string, string>()

const cacheKey = (sessionId: string, path: string): string => sessionId + '|' + path

/** 从参数 JSON 里挑图片路径（read_image / write 这类工具把文件放在 file_path / path）。 */
function imagePathsFromArgs(raw: string | undefined): string[] {
  if (raw === undefined) return []
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return [] }
  if (parsed === null || typeof parsed !== 'object') return []
  const record = parsed as Record<string, unknown>
  return ['file_path', 'path', 'filePath', 'target']
    .map(key => record[key])
    .filter((value): value is string => typeof value === 'string' && IMAGE_EXT.test(value))
}

/** 路径去重用的归一化：Windows 上 `C:\a\b.png` 与 `C:/a/b.png`（大小写还可能不同）
 *  是同一个文件。只用于判断"是不是同一条"，真正读盘仍用原字符串。 */
const pathKey = (path: string): string => path.replace(/\\/gu, '/').replace(/\/+/gu, '/').toLowerCase()

function imagePathsOf(tool: ToolCallInfo): string[] {
  const paths = [
    // 参数里的路径优先：read_image 这类工具结果里可能没有 meta，路径只在参数里。
    ...imagePathsFromArgs(tool.arguments),
    ...(tool.metaPaths ?? []),
    ...(tool.view?.diffs ?? []).map(diff => diff.path),
  ]
  const seen = new Set<string>()
  const unique: string[] = []
  for (const path of paths) {
    if (!IMAGE_EXT.test(path)) continue
    const key = pathKey(path)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(path)
  }
  return unique.slice(0, 2)
}

/** 一条路径的图片：读到就画，读不到就什么都不画（不占位、不报错）。 */
function PathImageTile({ path, sessionId }: { path: string; sessionId: string }) {
  const key = cacheKey(sessionId, path)
  const [url, setUrl] = useState<string | undefined>(() => pathCache.get(key))
  useEffect(() => {
    if (url !== undefined) return
    let cancelled = false
    void readFile(path, sessionId).then((preview) => {
      if (cancelled || preview.kind !== 'image') return
      pathCache.set(key, preview.dataUrl)
      setUrl(preview.dataUrl)
    }).catch(() => { /* 读不到就当没有这张图 */ })
    return () => { cancelled = true }
  }, [key, path, sessionId, url])
  if (url === undefined) return null
  return <img className="chat-msg-image" role="listitem" src={url} alt={path.split(/[\\/]/u).pop() ?? '图片'} loading="lazy" />
}

/**
 * 一条工具调用的图片条。
 *
 * @param tool - 工具调用（可能同时有附件图片和图片路径）
 * @param sessionId - 会话 id；缺了就不画（图片要按 cwd 解析）
 * @param max - 最多画几张（过程条 3 张，详情面板不限）
 */
export function ToolImages({ tool, sessionId, max = STRIP_MAX }: {
  tool: ToolCallInfo
  sessionId?: string
  max?: number
}) {
  // 同一个附件 id 只画一次（宿主偶尔会把 image 块与它的副本分两处折进来）。
  const attachments: readonly MessageImage[] = (tool.images ?? [])
    .filter((image, index, all) => all.findIndex(other => other.attachmentId === image.attachmentId) === index)
    .slice(0, max)
  /**
   * 2026-11-11 修「查看图片」出现两张一模一样的图：
   * `read_image` 这类工具**结果里带 image 附件、参数里又写着同一个文件路径**，
   * 两条来源读出来是同一张图 —— 附件是工具的真实产出，有附件就不再按路径补。
   * 只有"没有附件"（write/read 只留路径，S4）时才走路径读盘。
   */
  const paths = attachments.length > 0 || sessionId === undefined
    ? []
    : imagePathsOf(tool).slice(0, Math.max(0, max))
  if (sessionId === undefined) return null
  if (attachments.length === 0 && paths.length === 0) return null
  return (
    <div className="chat-msg-images" role="list" aria-label="工具图片">
      {attachments.map(image => <MessageImageTile key={image.attachmentId} sessionId={sessionId} image={image} />)}
      {paths.map(path => <PathImageTile key={path} path={path} sessionId={sessionId} />)}
    </div>
  )
}
