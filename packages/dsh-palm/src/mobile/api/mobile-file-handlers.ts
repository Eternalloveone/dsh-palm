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
import { homedir } from 'node:os'
import { basename, resolve, sep } from 'node:path'
import { readFile as fsReadFile, realpath, stat } from 'node:fs/promises'
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

/**
 * 宿主凭据/私钥的兜底黑名单（纵深防御，不是信任线）。
 *
 * 配对设备本来就是"完整宿主信任"，可以读工作区与会话里的任意文件；但
 * 2026-11-11 的泄露事件说明 cookie 一旦外流，`~/.ssh/id_rsa` 与
 * `~/.dsh/dsh-palm-notify.json`（VAPID 私钥 + 渠道 token）是最有价值的
 * 第一批目标。这几类路径直接拒绝，其余照旧。
 *
 * @param target - 已解析的绝对路径。
 * @returns 是否属于宿主私密路径。
 */
function isPrivateHostPath(target: string): boolean {
  const home = resolve(homedir())
  const abs = resolve(target)
  if (abs !== home && !abs.startsWith(home + sep)) return false
  const rel = abs.slice(home.length + 1).split(sep).join('/')
  if (rel.startsWith('.ssh/') || rel.startsWith('.gnupg/') || rel.startsWith('.aws/')) return true
  if (rel.startsWith('.config/gcloud/') || rel.startsWith('.config/gh/')) return true
  if (rel.startsWith('.dsh/')) {
    const name = rel.slice('.dsh/'.length)
    return /^dsh-palm-(notify|devices|search|perf|errors)[-.]/.test(name)
  }
  return false
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
        result: { ok: false, error: { code: 'file-unreadable', message: '宿主上找不到这个文件' } },
      })
      return
    }
    // 符号链接也要按真实路径判：`chat/notes.txt -> ~/.ssh/id_rsa` 不能绕过。
    let real = target
    try { real = await realpath(target) } catch { /* 保留原路径，交给下面的读失败 */ }
    if (isPrivateHostPath(real)) {
      writeJson(res, 200, {
        type: 'server-response',
        rpcId,
        result: { ok: false, error: { code: 'file-unreadable', message: '这个文件不对手机开放' } },
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
      result: { ok: false, error: { code: 'file-unreadable', message: '文件读不进来' } },
    })
  }
}
