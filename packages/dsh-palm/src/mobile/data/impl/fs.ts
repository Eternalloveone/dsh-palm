/**
 * **data 实现 · fs 域**（W4-4：按域切分 `api.ts`）。
 *
 * 这些函数原来都挤在 `api.ts` 里——73 个端点一个文件，谁也说不清改一处会碰到谁。
 * 现在按域归位；`api.ts` 保留 re-export，所以调用点一行都不用改。
 *
 * @module dsh-palm/mobile/data/impl/fs
 */
import { callUnary } from '../../platform/rpc.ts'
import { coalescedRead } from '../read-coalescing.ts'
import { SESSION_PREVIEW_BATCH_LIMIT } from '../limits.ts'
import type { DirectoryListing, FilePreview, SessionPreview } from '../../mobile-types.ts'

/** Read one host file (text/image) for preview. A relative path resolves
 * against the owning session's cwd when `sessionId` is given. */
export async function readFile(path: string, sessionId?: string): Promise<FilePreview> {
  return await callUnary<FilePreview>('mobile.readFile', sessionId === undefined ? { path } : { path, sessionId })
}

/**
 * 读一张会话里引用过的图片，返回可直接放进 `<img src>` 的 data URL。
 *
 * 0.1.5 起图片字节不在会话事件里（事件只带 `attachmentId` 引用），宿主按
 * "该会话确实引用过这张图"授权后才给字节；attachmentId 是内容寻址的 sha256，
 * 宿主侧按 id 长期缓存，所以重复调用很便宜。
 * @param sessionId - 授权与校验引用关系的会话。
 * @param attachmentId - 事件里折出来的附件 id。
 * @returns 媒体类型与 data URL。
 */
export async function readAttachment(sessionId: string, attachmentId: string): Promise<{ mediaType: string; dataUrl: string }> {
  return await callUnary<{ mediaType: string; dataUrl: string }>('mobile.readAttachment', { sessionId, attachmentId })
}

/** Browse one directory level on the host (defaults to home directory). */
export async function listDirectory(path?: string, options?: { files?: boolean }): Promise<DirectoryListing> {
  // Local patch (2026-08-23): host.listDirectory is gated on the composed
  // directory-picker capability (native on Windows loopback binds), so the
  // mobile browser uses the plugin's own fs listing instead.
  return await callUnary<DirectoryListing>('mobile.listDirectory', {
    ...(path === undefined ? {} : { path }),
    ...(options?.files === true ? { files: true } : {}),
  })
}

/**
 * Batch last-message previews (v3.1): the session-list page's preview lines
 * served by the host in ONE call — cached rows cost zero host log reads; a
 * session without a cache entry costs one lazy tail read. Fall back to
 * per-row {@link history} reads when the host answers unavailable (older
 * plugin); see SessionListView.loadPreviews.
 */
export async function previews(
  sessionIds: readonly string[],
  // 合并后的读无法逐个取消：保留参数只为调用点签名稳定。
  _signal?: AbortSignal,
): Promise<SessionPreview[]> {
  const ids = sessionIds.filter(id => id !== '').slice(0, SESSION_PREVIEW_BATCH_LIMIT)
  if (ids.length === 0) return []
  // 预览只是列表的摘要行：同一批 id 在一次进列表里会被触发多次（真机实测 3 次，
  // 其中两次相隔 100ms），合并成一次即可。signal 不参与合并——这是可放弃的读。
  const response = await coalescedRead<{ items: SessionPreview[] }>('mobile.previews', { sessionIds: ids })
  return response.items
}
