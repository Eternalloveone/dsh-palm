/**
 * `mobile.*` 里的小处理器（P2：逐方法外移，原位调用）。
 *
 * 这些方法不碰宿主 ApiProxy，只读本地状态或调用本地服务：
 * - `preferences`：手机端自己的显示偏好（回车发送等）；
 * - `pending`：某个会话当前挂起的审批/提问；
 * - `transcribe`：语音转文字（服务列表随请求下发，插件配置兜底）。
 *
 * @module dsh-palm/mobile/api/mobile-handlers
 */
import type { ServerResponse } from 'node:http'
import { writeJson } from '../../http.ts'
import { transcribeWav } from '../../voice-transcribe.ts'

/** 显示偏好处理器上下文。 */
export interface PreferencesContext {
  res: ServerResponse
  rpcId: string
  /** 读"回车是否发送"这个本地设置。 */
  mobileEnterToSend: () => boolean
}

/** 回手机端自己的显示偏好。 */
export function mobilePreferences(ctx: PreferencesContext): void {
  const { res, rpcId, mobileEnterToSend } = ctx
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: { ok: true, value: { mobileEnterToSend: mobileEnterToSend() } },
  })
}

/** 挂起项处理器上下文。 */
export interface PendingContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
  /** 依赖包整体按 unknown 收，内部再取需要的那一个能力。 */
  deps: unknown
}

/** 查某会话挂起的审批/提问。 */
export function mobilePending(ctx: PendingContext): void {
  const { res, parsed, rpcId } = ctx
  const deps = ctx.deps as { pendingTracker: { pending: (sessionId?: string) => unknown } }
  const payload = parsed.payload as { sessionId?: unknown } | undefined
  const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : undefined
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: { ok: true, value: deps.pendingTracker.pending(sessionId) },
  })
}

/** 语音转写处理器上下文。 */
export interface TranscribeContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
}

/**
 * 语音转文字。
 *
 * 服务列表由手机下发（OpenAI 兼容的 /audio/transcriptions 端点，按顺序尝试）；
 * 手机没发时用插件配置文件兜底。只把转写文本送回手机。
 */
export async function mobileTranscribe(ctx: TranscribeContext): Promise<void> {
  const { res, parsed, rpcId } = ctx
  const payload = parsed.payload as { audio?: unknown; services?: unknown } | undefined
  const audio = typeof payload?.audio === 'string' ? payload.audio : ''
  const result = await transcribeWav(audio, payload?.services)
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: 'text' in result
      ? { ok: true, value: { text: result.text } }
      : { ok: false, error: { code: 'transcribe-failed', message: result.error } },
  })
}
