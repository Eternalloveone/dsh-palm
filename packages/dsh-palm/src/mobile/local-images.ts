/**
 * 聊天里本地图片的字节缓存。
 *
 * 桌面端把 `![](D:\shot.png)` 重写成 `/api/file` 的 URL，手机端没有那个路由
 * （见 markdown.ts 的 localImagePath），所以渲染器只在 `data-local-src` 上带
 * 路径，挂载后经 `mobile.readFile` 取回 data URL 再塞进 `<img src>`。
 *
 * 缓存键是 `(sessionId, path)`：相对路径要按会话 cwd 解析，同一个相对路径在
 * 不同会话里是不同文件；绝对路径带上 sessionId 只是多占一个键，不会读错。
 * 上限之外按插入顺序淘汰（图片的复用是局部的）。同一张图的并发读取会合并：
 * 一屏里同一张图挂载多次（或列表重挂）只发一次请求。
 *
 * 与 attachment-images.ts 的区别：那个按内容寻址的 attachmentId 取（用户上传
 * 的图），这个按宿主文件路径取（agent 在回复里引用的本地图）。
 */

import { readFile } from './api.ts'

/** 缓存的图片张数上限（每张最大约 256 KiB base64，与附件缓存同口径）。 */
const MAX_CACHED_IMAGES = 16

/** `sessionId\u0000path` → data URL（Map 的插入顺序即 LRU 顺序）。 */
const cache = new Map<string, string>()
/** 进行中的读取，按同一个键去重。 */
const inFlight = new Map<string, Promise<string | undefined>>()

/** 缓存键：会话与路径都要参与（相对路径的含义依赖会话 cwd）。 */
function keyOf(sessionId: string, path: string): string {
  return sessionId + '\u0000' + path
}

/** 已缓存的图片 URL；命中时把它移到 LRU 尾部。 */
export function cachedLocalImageUrl(sessionId: string, path: string): string | undefined {
  const key = keyOf(sessionId, path)
  const url = cache.get(key)
  if (url === undefined) return undefined
  cache.delete(key)
  cache.set(key, url)
  return url
}

/**
 * 取一张本地图的 data URL；失败返回 undefined（只影响这一张图的显示）。
 * @param sessionId - 授权与解析相对路径的会话。
 * @param path - markdown 里作者写的路径（绝对，或相对该会话 cwd）。
 */
export async function loadLocalImageUrl(sessionId: string, path: string): Promise<string | undefined> {
  const cached = cachedLocalImageUrl(sessionId, path)
  if (cached !== undefined) return cached
  const key = keyOf(sessionId, path)
  const pending = inFlight.get(key)
  if (pending !== undefined) return await pending
  const request = readFile(path, sessionId)
    .then((result) => {
      // 路径指向的不是图片（或宿主判成文本）时不缓存，也不显示。
      if (result.kind !== 'image') return undefined
      cache.set(key, result.dataUrl)
      if (cache.size > MAX_CACHED_IMAGES) {
        const oldest = cache.keys().next()
        if (!oldest.done) cache.delete(oldest.value)
      }
      return result.dataUrl
    })
    .catch(() => undefined)
    .finally(() => { inFlight.delete(key) })
  inFlight.set(key, request)
  return await request
}

/** 测试用：清空缓存与进行中的读取。 */
export function resetLocalImageCache(): void {
  cache.clear()
  inFlight.clear()
}
