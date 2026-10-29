/**
 * 聊天图片的字节缓存。
 *
 * 0.1.5 起会话事件里只有 `attachmentId` 引用，字节要经 `mobile.readAttachment`
 * 单独取（宿主按"该会话确实引用过这张图"授权）。attachmentId 是内容寻址的
 * sha256——同一张图永远同一个 id——所以缓存可以长期有效，重进会话/来回滚动都
 * 不必再过隧道。上限之外按插入顺序淘汰（图片的复用是局部的）。
 *
 * 同一张图的并发读取会合并：一屏里同一张图挂载多次（或列表重挂）只发一次请求。
 */

import { readAttachment } from './api.ts'

/** 缓存的图片张数上限。 */
const MAX_CACHED_IMAGES = 16

/** attachmentId → 可直接喂给 `<img src>` 的 URL（Map 的插入顺序即 LRU 顺序）。 */
const cache = new Map<string, string>()
/** 进行中的读取，按 attachmentId 去重。 */
const inFlight = new Map<string, Promise<string | undefined>>()

/**
 * data URL → Blob URL。
 *
 * 相册里随手一张手机截图就是 1080×2400、好几兆，base64 之后是同样量级的**字符串**
 * 常驻内存，而 `<img src="data:…">` 在移动端 WebKit 上有实际长度上限——超了就
 * 静默解码失败，屏幕上只剩一块黑（真机反馈的现象）。转成 Blob URL 之后：
 * 字符串当场可以回收，`<img>` 只持一个对象引用，绕开长度上限。
 *
 * 任何一步不支持就原样返回 data URL：退回旧行为，不会比现在更差。
 * @param dataUrl - 宿主给的 `data:<mime>;base64,<payload>`。
 */
function toBlobUrl(dataUrl: string): string {
  try {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return dataUrl
    if (typeof Blob === 'undefined' || typeof atob !== 'function') return dataUrl
    const comma = dataUrl.indexOf(',')
    if (comma < 0) return dataUrl
    const mime = /^data:([^;,]+)/.exec(dataUrl.slice(0, comma))?.[1] ?? 'application/octet-stream'
    const binary = atob(dataUrl.slice(comma + 1))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return URL.createObjectURL(new Blob([bytes], { type: mime }))
  } catch {
    return dataUrl
  }
}

/** 释放一条缓存 URL：只有 blob: 需要显式回收，data: 就是普通字符串。 */
function releaseUrl(url: string): void {
  try {
    if (url.startsWith('blob:') && typeof URL !== 'undefined') URL.revokeObjectURL(url)
  } catch { /* non-fatal */ }
}

/** 已缓存的图片 URL；命中时把它移到 LRU 尾部。 */
export function cachedAttachmentUrl(attachmentId: string): string | undefined {
  const url = cache.get(attachmentId)
  if (url === undefined) return undefined
  cache.delete(attachmentId)
  cache.set(attachmentId, url)
  return url
}

/**
 * 丢掉一张图的缓存。解码失败时用：否则下一次还是拿到同一个坏字节，重试等于空转。
 * @param attachmentId - 事件里折出来的附件 id。
 */
export function forgetAttachmentUrl(attachmentId: string): void {
  const url = cache.get(attachmentId)
  if (url !== undefined) releaseUrl(url)
  cache.delete(attachmentId)
}

/**
 * 取一张图的 URL；失败返回 undefined（只影响这一张图的显示）。
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
      const url = toBlobUrl(result.dataUrl)
      cache.set(attachmentId, url)
      if (cache.size > MAX_CACHED_IMAGES) {
        const oldest = cache.keys().next()
        if (!oldest.done) {
          const evicted = cache.get(oldest.value)
          if (evicted !== undefined) releaseUrl(evicted)
          cache.delete(oldest.value)
        }
      }
      return url
    })
    .catch(() => undefined)
    .finally(() => { inFlight.delete(attachmentId) })
  inFlight.set(attachmentId, request)
  return await request
}