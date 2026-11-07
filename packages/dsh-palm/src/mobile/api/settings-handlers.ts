/**
 * settings 域的 RPC 处理器（P2：逐方法外移，原位调用）。
 *
 * 读：把宿主被脱敏过的完整设置面（命名空间 schema + 值）透传给手机。
 * 写：只允许白名单内的命名空间与字段，其余一律回稳定的 not-found。
 *
 * @module dsh-palm/mobile/api/settings-handlers
 */
import type { ApiProxy, RpcId as RpcIdType } from '../../api-proxy-types.ts'
import { RpcId } from '../../api-proxy-types.ts'
import { asJsonObject } from '../../http.ts'
import { isAllowedSettingsOp } from './settings.ts'
import { wrap } from './wrap.ts'

/**
 * 手机端允许写入的设置白名单：命名空间 → 允许的操作路径。
 *
 * `dsh-palm` 的 `enabled` 故意不在列表里：关掉远程访问入口会让这台手机立刻失去连接，
 * 这个开关只能从桌面端关。
 */
export const SETTINGS_WRITE_WHITELIST: Record<string, readonly (readonly string[])[]> = {
  'ui-theme': [['preference']],
  'ui-conversation': [['busyEnter']],
  'subagent-model-selection-settings': [['enabled'], ['allowedModels']],
  'agent-default-model': [['model'], ['provider'], ['reasoningEffort']],
  'agent-loop': [['maxParallelToolCalls']],
  'better-sidebar': [['*']],
  'dsh-palm': [['mobileEnterToSend'], ['offlineAfterMs'], ['maxDevices'], ['tokenTtlMs']],
}

/** 读设置处理器需要的最小上下文。 */
export interface SettingsReadContext {
  apiProxy: ApiProxy
  rpcId: string
  request: unknown
}

/** 读完整设置面。 */
export async function settingsRead(ctx: SettingsReadContext): Promise<unknown> {
  const response = await ctx.apiProxy.settings.describe(ctx.request as never)
  return wrap(ctx.rpcId, response)
}

/** 写设置处理器需要的最小上下文。 */
export interface SettingsMutateContext {
  apiProxy: ApiProxy
  rpcId: string
  payload: unknown
}

/**
 * 写设置：白名单外的请求一律回 `not-found`（与配对接口同一套"不透露存在性"的做法）。
 */
export async function settingsMutate(ctx: SettingsMutateContext): Promise<unknown> {
  const { apiProxy, payload, rpcId } = ctx
  const body = asJsonObject(payload)
  const ns = typeof body?.ns === 'string' ? body.ns : undefined
  const ops = Array.isArray(body?.ops) ? body.ops : undefined
  const allowed = ns !== undefined ? SETTINGS_WRITE_WHITELIST[ns] : undefined
  const whitelisted = allowed !== undefined && ops !== undefined && ops.length > 0
    && ops.every(op => isAllowedSettingsOp(op, allowed))
  if (!whitelisted) {
    return {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'not-found', message: '设置项不可用' } },
    }
  }
  const expectedRevision = typeof body?.expectedRevision === 'number' ? body.expectedRevision : undefined
  const response = await apiProxy.settings.mutate({
    rpcId: RpcId(rpcId) as RpcIdType,
    payload: {
      ns,
      ops: ops as never,
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    },
  } as never)
  return wrap(rpcId, response)
}
