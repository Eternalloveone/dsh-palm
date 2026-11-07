/**
 * `mobile.readFile` 的实现（P2：整方法外移）。
 *
 * 聊天里的文件路径链接点开时的文本/图片预览。手机是已配对设备（完整宿主信任，
 * 与 listDirectory 同一条边界）；下面这些守卫是纵深防御，不是信任线：
 * 只读真实普通文件、载荷有大小上限、字节必须能按 UTF-8 解出且不含 NUL——
 * 二进制/目录的答案永远走不通这条通道。
 *
 * 相对路径（agent 常写的形式，如 `packages/…/mux.ts`）在带 `sessionId` 时
 * 按该会话的 cwd 解析；不带时只能从宿主进程 cwd 解析得到才读。
 *
 * @module dsh-palm/mobile/api/mobile-file-handlers
 */
import type { ServerResponse } from 'node:http'
import { basename } from 'node:path'
import { readFile as fsReadFile, stat } from 'node:fs/promises'
import { writeJson } from '../../http.ts'
import {
  IMAGE_MIME,
  MOBILE_READ_FILE_MAX_BYTES,
  MOBILE_READ_IMAGE_MAX_BYTES,
  isImagePath,
  readCandidates,
} from '../../host/directory.ts'

/** 处理器上下文。 */
export interface ReadFileContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
  deps: { chatWindows?: unknown }
  apiProxy: unknown
}

/** 读一个文件做预览：图片回 dataUrl，文本回文本，其余一律拒绝。 */
export async function mobileReadFile(ctx: ReadFileContext): Promise<void> {
  const { res, parsed, rpcId, deps } = ctx
  const apiProxy = ctx.apiProxy as never
  const body = parsed.payload as { path?: unknown; sessionId?: unknown } | undefined
  const raw = typeof body?.path === 'string' ? body.path.trim() : ''
  if (raw === '') {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'bad-request', message: '缺少文件路径' } },
    })
    return
  }
  try {
    const candidates = await readCandidates(
      apiProxy,
      raw,
      typeof body?.sessionId === 'string' ? body.sessionId : undefined,
      deps.chatWindows as never,
    )
    let target: string | undefined
    let info: Awaited<ReturnType<typeof stat>> | undefined
    for (const candidate of candidates) {
      try {
        const probe = await stat(candidate)
        if (probe.isFile()) { target = candidate; info = probe; break }
      } catch {
        // 候选不存在：试下一个基准目录
      }
    }
    if (target === undefined || info === undefined) {
      writeJson(res, 200, {
        type: 'server-response',
        rpcId,
        result: { ok: false, error: { code: 'file-unreadable', message: '文件不可读' } },
      })
      return
    }
    const isImage = isImagePath(target)
    if (info.size > (isImage ? MOBILE_READ_IMAGE_MAX_BYTES : MOBILE_READ_FILE_MAX_BYTES)) {
      writeJson(res, 200, {
        type: 'server-response',
        rpcId,
        result: { ok: false, error: { code: 'file-too-large', message: isImage ? '图片过大，无法预览' : '文件过大，无法预览' } },
      })
      return
    }
    const bytes = await fsReadFile(target)
    if (isImage) {
      const ext = (target.split(/[\\/]/).pop() ?? '').split('.').pop()?.toLowerCase() ?? ''
      const mediaType = (IMAGE_MIME as Record<string, string>)[ext] ?? 'application/octet-stream'
      writeJson(res, 200, {
        type: 'server-response',
        rpcId,
        result: {
          ok: true,
          value: {
            kind: 'image' as const,
            path: target,
            name: basename(target),
            dataUrl: `data:${mediaType};base64,${bytes.toString('base64')}`,
          },
        },
      })
      return
    }
    if (bytes.includes(0)) {
      writeJson(res, 200, {
        type: 'server-response',
        rpcId,
        result: { ok: false, error: { code: 'not-text', message: '二进制文件无法预览' } },
      })
      return
    }
    const text = bytes.toString('utf8')
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: true, value: { kind: 'text' as const, path: target, name: basename(target), text } },
    })
  } catch {
    // 绝不泄漏宿主路径/错误；手机端渲染成通用拒绝即可。
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'file-unreadable', message: '文件不可读' } },
    })
  }
}
