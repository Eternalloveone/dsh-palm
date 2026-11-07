/**
 * `mobile.*` 里与本地文件系统、转写服务探测有关的处理器（P2：逐方法外移）。
 *
 * 两者都不经过宿主 ApiProxy：
 * - `listDirectory`：列本机目录（`files: true` 时连文件一起列，给「电脑文件」挑选用）；
 * - `voiceServices`：把宿主配置文件里的转写服务读给手机看，**只回展示事实，绝不回 API key**。
 *
 * @module dsh-palm/mobile/api/mobile-fs-handlers
 */
import type { ServerResponse } from 'node:http'
import { mobileListDirectory } from '../../host/directory.ts'
import { writeJson } from '../../http.ts'
import { resolveTranscribeServices } from '../../voice-transcribe.ts'

/** 目录列举处理器上下文。 */
export interface ListDirectoryContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
}

/**
 * 列本机目录。
 *
 * 缺省只列目录（工作区浏览的老调用方拿到的还是原来那套形状）；
 * `files: true` 连文件一起列。宿主路径绝不回传：读不到就给通用拒绝，
 * 让手机端渲染「不可读」状态即可。
 */
export async function mobileListDirectoryHandler(ctx: ListDirectoryContext): Promise<void> {
  const { res, parsed, rpcId } = ctx
  const payload = parsed.payload as { path?: unknown; files?: unknown } | undefined
  try {
    const listing = await mobileListDirectory(
      typeof payload?.path === 'string' ? payload.path : undefined,
      payload?.files === true,
    )
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: true, value: listing },
    })
  } catch {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'directory-unreadable', message: '目录不可读' } },
    })
  }
}

/** 转写服务列表处理器上下文。 */
export interface VoiceServicesContext {
  res: ServerResponse
  rpcId: string
}

/**
 * 宿主侧配置的转写服务（`dsh-palm.yaml` 的 `transcribe:`）。
 *
 * 宿主的 API key 绝不离开宿主：手机不能直接使用这些服务（转写走宿主通道，
 * 手机不发服务列表时宿主回落到这份配置），所以只返回展示所需的事实。
 */
export async function mobileVoiceServices(ctx: VoiceServicesContext): Promise<void> {
  const { res, rpcId } = ctx
  const dedicated = await resolveTranscribeServices()
  const services = dedicated === undefined
    ? []
    : dedicated.flatMap(entry => 'error' in entry
      ? []
      : [{
        name: entry.service.name ?? 'host 配置',
        baseURL: entry.service.baseURL.replace(/\/+$/, ''),
        model: entry.service.model,
      }])
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: { ok: true, value: { services } },
  })
}
