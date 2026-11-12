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

import { readFile } from '../api.ts'

/** 缓存的图片张数上限（每张最大约 256 KiB base64，与附件缓存同口径）。 */
const MAX_CACHED_IMAGES = 16

/**
 * 失败记录的有效期（2026-11-11 真机）。
 *
 * 一次读失败**不等于**文件永远不存在：agent 常先写正文、再落截图（`present`
 * 是几步之后的事），第一次水合时文件还没写出来是常态。原来的失败集合只进不出，
 * 于是一条消息里的图会**永久**钉在「未找到」上，直到整页重开 —— 用户看到的就是
 * 「正文里的图还是没显示」。现在失败只在 15 秒内挡重复请求，之后允许再试；
 * 一轮结束（pending 转 false）时正文还会主动清一次（见 markdown-text.tsx）。
 */
export const LOCAL_IMAGE_RETRY_MS = 15_000

/** `sessionId\u0000path` → data URL（Map 的插入顺序即 LRU 顺序）。 */
const cache = new Map<string, string>()
/** 进行中的读取，按同一个键去重。 */
const inFlight = new Map<string, Promise<string | undefined>>()
/** 已确认读不到的键 → 失败时间 + 人话原因（牌子与排查都要用）。 */
const failed = new Map<string, { at: number; reason: string }>()

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
 * 把一次读取异常翻成一句人话（牌子上要写、真机排查也要看）。
 *
 * 只认几类可判定的失败：超时、未配对、太大、不是图片、找不到文件。认不出的
 * 一律「读取失败」，绝不把宿主路径或堆栈写进正文。
 *
 * @param error - readFile 抛出的东西
 * @returns 简短中文原因
 */
export function failureReasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/timeout|超时/i.test(message)) return '读取超时'
  if (/unpaired|未配对|HTTP 401|HTTP 403/i.test(message)) return '设备未配对'
  if (/too-large|过大/i.test(message)) return '图片太大'
  if (/not-text|二进制/i.test(message)) return '不是可预览的图片'
  if (/找不到|file-unreadable|ENOENT|does not exist/i.test(message)) return '主机上没有这个文件'
  return '读取失败'
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
      if (result.kind !== 'image') {
        markLocalImageFailed(sessionId, path, '不是可预览的图片')
        return undefined
      }
      cache.set(key, result.dataUrl)
      if (cache.size > MAX_CACHED_IMAGES) {
        const oldest = cache.keys().next()
        if (!oldest.done) cache.delete(oldest.value)
      }
      return result.dataUrl
    })
    .catch((error: unknown) => {
      // 失败原因在这里落账：牌子上写的就是它，别再让调用方猜。
      markLocalImageFailed(sessionId, path, failureReasonOf(error))
      return undefined
    })
    .finally(() => { inFlight.delete(key) })
  inFlight.set(key, request)
  return await request
}

/** 这张图是不是**刚**被确认读不到（过期后返回 false，允许再试一次）。 */
export function isLocalImageFailed(sessionId: string, path: string): boolean {
  const key = keyOf(sessionId, path)
  const hit = failed.get(key)
  if (hit === undefined) return false
  if (Date.now() - hit.at < LOCAL_IMAGE_RETRY_MS) return true
  failed.delete(key)
  return false
}

/** 上一次失败的原因（没有失败记录时 undefined）。 */
export function localImageFailureReason(sessionId: string, path: string): string | undefined {
  return failed.get(keyOf(sessionId, path))?.reason
}

/** 记下「主机上读不到」+ 原因：同一张图在 TTL 内不再反复发 RPC。 */
export function markLocalImageFailed(sessionId: string, path: string, reason = '读取失败'): void {
  failed.set(keyOf(sessionId, path), { at: Date.now(), reason })
}

/**
 * 清掉失败记录：不带 path 时清掉这个会话的全部（一轮结束时用），
 * 带 path 时只清那一张（用户点了牌子重试）。
 * @param sessionId - 会话
 * @param path - 只清这一张图（可选）
 */
export function clearLocalImageFailure(sessionId: string, path?: string): void {
  if (path !== undefined) {
    failed.delete(keyOf(sessionId, path))
    return
  }
  const prefix = sessionId + '\u0000'
  for (const key of [...failed.keys()]) {
    if (key.startsWith(prefix)) failed.delete(key)
  }
}

/** 测试用：清空缓存与进行中的读取。 */
export function resetLocalImageCache(): void {
  cache.clear()
  inFlight.clear()
  failed.clear()
}
