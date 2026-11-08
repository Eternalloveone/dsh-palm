/**
 * `mobile.usage` 的实现与它的提供方发现函数（P2：依赖先行一起搬）。
 *
 * 按提供方给的用量/余额，来自桌面端已配置的 provider。`refresh: true` 跳过短缓存。
 * 密钥只在宿主侧解析；手机只收到展示事实。
 *
 * @module dsh-palm/mobile/api/mobile-usage
 */
import type { ServerResponse } from 'node:http'
import { RpcId } from '../../api-proxy-types.ts'
import { writeJson } from '../../http.ts'
import { buildUsageView } from '../../usage/usage-check.ts'
import type { UsageProviderConfig, UsageView } from '../../usage/usage-check.ts'
import { USAGE_CACHE_TTL_MS } from './constants.ts'
import { processState } from './process-state.ts'

/**
 * 从设置面里发现可用的用量提供方。
 *
 * 两个来源：
 * - `llm-pi-ai`：按 provider 键入的 OpenAI 兼容路由表；
 * - `llm-deepseek`：专用网关命名空间——密钥本身是脱敏的、不会出现在 describe 视图里，
 *   但它的凭证引用**名**是普通配置（`apiKeyEnv`，文档默认 `DEEPSEEK_API_KEY`）；
 *   桌面端存的密钥由宿主凭证服务在请求时解析，与 provider 库的做法一致。
 */
async function discoverUsageProviders(
  apiProxy: { settings: { describe: (request: never) => Promise<unknown> } },
): Promise<UsageProviderConfig[]> {
  const described = await apiProxy.settings.describe({ rpcId: RpcId('usage-discover'), payload: {} } as never)
  const result = (described as { result?: unknown } | undefined)?.result as
    | { ok?: boolean; value?: { namespaces?: Array<{ ns?: string; value?: unknown }> } }
    | undefined
  if (result?.ok !== true) return []
  const namespaces = result.value?.namespaces ?? []

  const fromRouteTable = (): UsageProviderConfig[] => {
    const found = namespaces.find(entry => entry.ns === 'llm-pi-ai')
    const providers = (found?.value as { providers?: Record<string, unknown> } | undefined)?.providers
    if (providers === undefined) return []
    return Object.entries(providers).flatMap(([route, raw]) => {
      if (typeof raw !== 'object' || raw === null) return []
      const rec = raw as { apiKeyEnv?: unknown; baseURL?: unknown; displayName?: unknown }
      return [{
        route,
        ...typeof rec.baseURL === 'string' ? { baseURL: rec.baseURL } : {},
        ...typeof rec.displayName === 'string' ? { displayName: rec.displayName } : {},
        ...typeof rec.apiKeyEnv === 'string' ? { apiKeyEnv: rec.apiKeyEnv } : {},
      }]
    })
  }

  const deepseekValue = namespaces.find(entry => entry.ns === 'llm-deepseek')?.value as
    | { models?: unknown; baseURL?: unknown; apiKeyEnv?: unknown }
    | undefined
  const deepseekPresent = deepseekValue !== undefined
    && (Array.isArray(deepseekValue.models) || typeof deepseekValue.baseURL === 'string')
  const fromDeepseek: UsageProviderConfig[] = deepseekPresent
    ? [{
        route: 'deepseek',
        displayName: 'DeepSeek 官方',
        ...(typeof deepseekValue.baseURL === 'string' ? { baseURL: deepseekValue.baseURL } : {}),
        apiKeyEnv: typeof deepseekValue.apiKeyEnv === 'string' && deepseekValue.apiKeyEnv.length > 0
          ? deepseekValue.apiKeyEnv
          : 'DEEPSEEK_API_KEY',
      }]
    : []

  return [...fromRouteTable(), ...fromDeepseek]
}

/** 处理器上下文。 */
export interface UsageContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
  deps: { resolveKey?: (refName: string) => Promise<string | undefined> }
  apiProxy: unknown
}

/** 查各提供方的用量/余额（带 60 秒短缓存）。 */
export async function mobileUsage(ctx: UsageContext): Promise<void> {
  const { res, parsed, rpcId, deps } = ctx
  const body = parsed.payload as { refresh?: unknown } | undefined
  const force = body?.refresh === true
  const cached = processState.usageCache !== undefined
    && !force
    && Date.now() - processState.usageCache.at < USAGE_CACHE_TTL_MS
  let fresh: UsageView | undefined
  if (!cached) {
    try {
      const providers = await discoverUsageProviders(ctx.apiProxy as never)
      const view = await buildUsageView(providers, refName =>
        deps.resolveKey === undefined ? Promise.resolve(undefined) : deps.resolveKey(refName))
      processState.usageCache = { at: Date.now(), view }
      fresh = view
    } catch (error) {
      // 内部失败（设置读取抖动、某个 provider 适配器抛错）只回稳定拒绝，
      // 绝不外泄宿主细节。
      console.error('mobile.usage failed', error)
      writeJson(res, 200, {
        type: 'server-response',
        rpcId,
        result: { ok: false, error: { code: 'internal', message: '用量查询失败，请稍后重试' } },
      })
      return
    }
  }
  const served: UsageView | undefined = fresh ?? processState.usageCache?.view
  if (served === undefined) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'internal', message: '用量查询失败，请稍后重试' } },
    })
    return
  }
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: { ok: true, value: served },
  })
}
