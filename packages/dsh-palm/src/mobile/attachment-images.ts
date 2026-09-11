/**
 * 聊天图片的字节缓存。
 *
 * 0.1.5 起会话事件里只有 `attachmentId` 引用，字节要经 `mobile.readAttachment`
 * 单独取（宿主按"该会话确实引用过这张图"授权）。attachmentId 是内容寻址的
 * sha256——同一张图永远同一个 id——所以缓存可以长期有效，重进会话/来回滚动都不必
 * 再过隧道。上限之外按插入顺序淘汰（图片的复用是局部的）。
 *
 * 同一张图的并发读取会合并：一屏里同一张图挂载多次（或列表重挂）只发一次请求。
 */

import { readAttachment } from './api.ts'

/** 缓存的图片张数上限（每张最大约 256 KiB base64）。 */
const MAX_CACHED_IMAGES = 16

/** attachmentId → data URL（Map 的插入顺序即 LRU 顺序）。 */
const cache = new Map<string, string>()
/** 进行中的读取，按 attachmentId 去重。 */
const inFlight = new Map<string, Promise<string | undefined>>()

/** 已缓存的图片 URL；命中时把它移到 LRU 尾部。 */
export function cachedAttachmentUrl(attachmentId: string): string | undefined {
  const url = cache.get(attachmentId)
  if (url === undefined) return undefined
  cache.delete(attachmentId)
  cache.set(attachmentId, url)
  return url
}

/**
 * 取一张图的 data URL；失败返回 undefined（只影响这一张图的显示）。
 * @param sessionId - 授权与校验引用关系的会话。
 * @param attachmentId - 事件里折出来的附件 id。
 */
export async function loadAttachmentUrl(sessionId: string, attachmentId: string): Promise<string | undefined> {
  const cached = cachedAttachmentUrl(attachmentId)
  if (cached !== undefined) return cached
  const pending = inFlight.get(attachmentId)
  if (pending !== undefined) return await pending
  const request = readAttachment(sessionId, attachmentId)
    .then((result) => {
      cache.set(attachmentId, result.dataUrl)
      if (cache.size > MAX_CACHED_IMAGES) {
        const oldest = cache.keys().next()
        if (!oldest.done) cache.delete(oldest.value)
      }
      return result.dataUrl
    })
    .catch(() => undefined)
    .finally(() => { inFlight.delete(attachmentId) })
  inFlight.set(attachmentId, request)
  return await request
}

/** 清空缓存（测试与会话清理用）。 */
export function clearAttachmentImages(): void {
  cache.clear()
  inFlight.clear()
}
