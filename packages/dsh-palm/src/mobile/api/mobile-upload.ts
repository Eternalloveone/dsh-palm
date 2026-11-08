/**
 * `mobile.uploadAttachment` 的实现（P2：整方法外移）。
 *
 * 手机端「添加附件」：把选中的文件交给宿主附件服务落盘并暂存，回一个 receiptId；
 * 随后那条 prompt 用 `{ type: 'file', receiptId }` 引用它。
 *
 * 三条判据都是纵深防御而不是信任线（手机=已配对设备）：要有附件服务、要有活的
 * 会话 agent（receipt 绑定在 agent 的会话上）、字节要有上限，免得一次误选把
 * 整份日志/一段视频当附件塞进 rpc 通道。
 *
 * @module dsh-palm/mobile/api/mobile-upload
 */
import type { ServerResponse } from 'node:http'
import { writeJson } from '../../http.ts'
import { MAX_ATTACHMENT_BASE64_CHARS } from './constants.ts'

/** 附件服务里本域用到的最小面。 */
interface FileUploadsView {
  upload: (
    agent: unknown,
    input: { data: string; name?: string },
    signal: AbortSignal,
  ) => Promise<{ receiptId: string; file?: { name?: string; bytes?: number } }>
}

/** 处理器上下文。 */
export interface UploadAttachmentContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
  deps: unknown
}

/** 上传一个附件，拿回 receiptId。 */
export async function mobileUploadAttachment(ctx: UploadAttachmentContext): Promise<void> {
  const { res, parsed, rpcId } = ctx
  const deps = ctx.deps as {
    fileUploads?: FileUploadsView
    agents?: { get: (sessionId: string) => unknown }
  }
  const body = parsed.payload as { sessionId?: unknown; name?: unknown; data?: unknown } | undefined
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined
  const data = typeof body?.data === 'string' ? body.data : ''
  const rawName = typeof body?.name === 'string' ? body.name.trim() : ''
  const name = rawName === '' ? undefined : rawName
  const uploads = deps.fileUploads
  const agent = sessionId === undefined || deps.agents === undefined
    ? undefined
    : deps.agents.get(sessionId)

  if (uploads === undefined) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'upload-unavailable', message: '当前宿主不支持添加附件' } },
    })
    return
  }
  if (agent === undefined || agent === null) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'session-cold', message: '这个会话还没准备好，稍后再试' } },
    })
    return
  }
  if (data === '') {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'bad-request', message: '附件内容是空的' } },
    })
    return
  }
  if (data.length > MAX_ATTACHMENT_BASE64_CHARS) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'payload-too-large', message: '附件太大（上限 20 MB）' } },
    })
    return
  }
  // 设备中途离开就取消这次落盘，不留半份文件。
  const abort = new AbortController()
  res.on('close', () => { if (!res.writableEnded) abort.abort() })
  try {
    const value = await uploads.upload(agent, { data, ...(name === undefined ? {} : { name }) }, abort.signal)
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: {
        ok: true,
        value: {
          receiptId: value.receiptId,
          name: value.file?.name ?? name ?? '附件',
          ...(value.file?.bytes === undefined ? {} : { bytes: value.file.bytes }),
        },
      },
    })
  } catch {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'upload-failed', message: '附件上传失败，请重试' } },
    })
  }
}
