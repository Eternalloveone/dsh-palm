/**
 * **data 实现 · notify 域**（W4-4：按域切分 `api.ts`）。
 *
 * 这些函数原来都挤在 `api.ts` 里——73 个端点一个文件，谁也说不清改一处会碰到谁。
 * 现在按域归位；`api.ts` 保留 re-export，所以调用点一行都不用改。
 *
 * @module dsh-palm/mobile/data/impl/notify
 */
import { callUnary } from '../../platform/rpc.ts'
import type { DeliveryRecordView, DeliveryStatsView, NotifyConfigView, NotifyEventView, PendingState } from '../../mobile-types.ts'

/** Fetch pending approvals and questions for one session (polling fallback data source). */
export async function fetchPending(sessionId: string): Promise<PendingState> {
  return await callUnary<PendingState>('mobile.pending', { sessionId })
}

/** The recent decisions + delivery telemetry (newest first). */
export async function notifyEvents(): Promise<{
  items: NotifyEventView[]
  stats?: DeliveryStatsView
  deliveries?: DeliveryRecordView[]
}> {
  return await callUnary<{
    items: NotifyEventView[]
    stats?: DeliveryStatsView
    deliveries?: DeliveryRecordView[]
  }>('mobile.notifyEvents', {})
}

/** Read the notify config (thresholds + channel presence, credentials redacted). */
export async function readNotifyConfig(): Promise<NotifyConfigView> {
  return await callUnary<NotifyConfigView>('push.config', { get: true })
}

/** Push one synthetic event through the configured L3 channels (test button). */
export async function testNotifyChannels(): Promise<void> {
  await callUnary<unknown>('push.config', { test: true })
}

/** Write notify config fields (thresholds; channel credentials in M2). */
export async function writeNotifyConfig(patch: {
  turnThresholdMs?: number
  turnCooldownMs?: number
  hideDetails?: boolean
  kinds?: { jobs?: boolean; todo?: boolean; turns?: boolean }
  channels?: {
    serverchan?: { sendKey: string }
    bark?: { key: string }
    telegram?: { botToken: string; chatId: string }
    wxpusher?: { spt: string }
    pushplus?: { token: string }
  }
}): Promise<void> {
  await callUnary<unknown>('push.config', { set: patch })
}
