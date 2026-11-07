/**
 * **data 实现 · settings 域**（W4-4：按域切分 `api.ts`）。
 *
 * 这些函数原来都挤在 `api.ts` 里——73 个端点一个文件，谁也说不清改一处会碰到谁。
 * 现在按域归位；`api.ts` 保留 re-export，所以调用点一行都不用改。
 *
 * @module dsh-palm/mobile/data/impl/settings
 */
import { callUnary } from '../../rpc.ts'
import { coalescedRead, invalidateReadCoalescing } from '../read-coalescing.ts'
import { MODELS_TTL_MS, PREFERENCES_TTL_MS } from '../limits.ts'
import type { CommandDescriptor, MobilePreferences, MobileSettingsRead, PairedDevicesView } from '../../mobile-types.ts'
import type { SessionModels } from '../../../api-proxy-types'

/** Read the full redacted settings surface (schemas + values, no secrets). */
export async function readSettings(): Promise<MobileSettingsRead> {
  return await callUnary<MobileSettingsRead>('settings.read', {})
}

/** Write whitelisted host setting paths (see SETTINGS_WRITE_WHITELIST). */
export async function mutateSettings(
  ns: string,
  ops: Array<{ op: 'set'; path: string[]; value: unknown }>,
  expectedRevision?: number,
): Promise<void> {
  const payload: Record<string, unknown> = { ns, ops }
  if (expectedRevision !== undefined) payload.expectedRevision = expectedRevision
  await callUnary<unknown>('settings.mutate', payload)
  // 写成功即让显示偏好的复用窗口失效（设置页改完返回，读到的必须是新值）。
  invalidateReadCoalescing()
}

/** Read-only mobile display preferences (answered by the plugin, not the host proxy). */
export async function fetchMobilePreferences(): Promise<MobilePreferences> {
  // 显示偏好只在设置页里改，且改完会走 mutateSettings 清窗口：30s 的复用窗口足够。
  // 真机实测：每次进会话都会再读一次（与启动那次隔 2.2s，恰好落在 1.2s 窗口外），
  // 白跑一个往返。
  return await coalescedRead<MobilePreferences>('mobile.preferences', {}, PREFERENCES_TTL_MS)
}

/** Select the complete model selection (provider/model/reasoning effort) for a session. */
export async function selectModel(
  sessionId: string,
  selection: { provider: string; model: string; reasoningEffort?: string },
): Promise<{ selected: { provider: string; model: string; reasoningEffort?: string } }> {
  const result = await callUnary<{ selected: { provider: string; model: string; reasoningEffort?: string } }>('session.selectModel', {
    sessionId,
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort !== undefined ? { reasoningEffort: selection.reasoningEffort } : {}),
  })
  // 换了模型就必须让缓存里的目录（current 字段）失效，否则选择器会显示旧选中项。
  invalidateReadCoalescing()
  return result
}

/**
 * Fresh advisory model directory for one session (current + groups + failures).
 *
 * 模型目录只在用户改选择或宿主配置变更时变，而手机端每次进会话、每次点开会
 * 选择器都会重读一遍（真机实测 4G 下 ~190ms、弱网 ~1s）。这里给 30 秒窗口，
 * 改过选择（selectModel）立刻清窗，所以不会看到旧选中项。
 */
export async function models(sessionId: string): Promise<SessionModels> {
  return await coalescedRead<SessionModels>('session.models', { sessionId }, MODELS_TTL_MS)
}

/**
 * List the host's registered slash commands for one session (read-only
 * discovery). The session id resolves the agent whose effective command view
 * the phone shows — the same catalog the desktop composer's `/` popup lists.
 */
export async function listCommands(sessionId: string): Promise<CommandDescriptor[]> {
  const response = await callUnary<{ items?: CommandDescriptor[] }>('mobile.commands', { sessionId })
  return response.items ?? []
}

/** List every paired device (the phone's device-management screen). */
export async function listDevices(): Promise<PairedDevicesView> {
  return await callUnary<PairedDevicesView>('pair.devices', {})
}

/** Assign a user-facing display name to a device (empty clears it). */
export async function renameDevice(handle: string, name: string): Promise<{ renamed: boolean }> {
  return await callUnary<{ renamed: boolean }>('pair.rename', { handle, name })
}

/** Revoke one paired device (its next gated request is refused). Phone may only revoke itself. */
export async function revokeDevice(handle: string): Promise<{ removed: boolean }> {
  return await callUnary<{ removed: boolean }>('pair.revoke', { handle })
}

/** Promote one device to primary (desktop/loopback only; the phone gets `desktop-only`). */
export async function setPrimaryDevice(handle: string): Promise<{ promoted: boolean }> {
  return await callUnary<{ promoted: boolean }>('pair.setPrimary', { handle })
}
