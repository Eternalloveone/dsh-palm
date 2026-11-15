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

/** 全量查一次并落缓存（会让宿主忙三秒左右，只能在必要时同步做）。 */
async function readUsage(ctx: UsageContext): Promise<UsageView> {
  const providers = await discoverUsageProviders(ctx.apiProxy as never)
  const view = await buildUsageView(providers, refName =>
    ctx.deps.resolveKey === undefined ? Promise.resolve(undefined) : ctx.deps.resolveKey(refName))
  processState.usageCache = { at: Date.now(), view }
  return view
}

/** 后台刷新：不挡任何请求；失败了下次还会再试。 */
function refreshUsageInBackground(ctx: UsageContext): void {
  if (processState.usageRefreshing) return
  processState.usageRefreshing = true
  void readUsage(ctx)
    .catch((error: unknown) => {
      console.error('mobile.usage background refresh failed', error)
    })
    .finally(() => {
      processState.usageRefreshing = false
    })
}

/**
 * 查各提供方的用量/余额。
 *
 * **2026-11-15：过期不再同步等。** 全量查一次实测 3.3 s，而宿主单线程 —— 那 3.3 s 里
 * 所有 `/m/api` 都在排队，用户切会话/开抽屉就是"卡一下"。改成 stale-while-revalidate：
 * 手上有旧值就先答旧的、后台再刷；只有一次都没查过（冷启动）或用户点刷新才真等。
 * 抽屉上那行余额晚一分钟更新，远比整个界面停一下值得。
 */
export async function mobileUsage(ctx: UsageContext): Promise<void> {
  const { res, parsed, rpcId } = ctx
  const body = parsed.payload as { refresh?: unknown } | undefined
  const force = body?.refresh === true
  const serve = (view: UsageView): void => {
    writeJson(res, 200, { type: 'server-response', rpcId, result: { ok: true, value: view } })
  }
  const fail = (): void => {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'internal', message: '用量查询失败，请稍后重试' } },
    })
  }

  const cache = processState.usageCache
  if (cache !== undefined && !force && Date.now() - cache.at < USAGE_CACHE_TTL_MS) {
    serve(cache.view)
    return
  }
  if (cache !== undefined && !force) {
    serve(cache.view)
    refreshUsageInBackground(ctx)
    return
  }
  /*
   * 冷启动（一次都没查过）也不等：后台去查，这一页先按"查不到"答。
   * 客户端拿到失败就是保持抽屉上原来的「余额」两个字，本来就有这条降级路径；
   * 而等它 3.3 s 换来的是整个手机端所有请求排队。
   */
  if (!force) {
    refreshUsageInBackground(ctx)
    fail()
    return
  }
  try {
    serve(await readUsage(ctx))
  } catch (error) {
    // 内部失败（设置读取抖动、某个 provider 适配器抛错）只回稳定拒绝，绝不外泄宿主细节。
    console.error('mobile.usage failed', error)
    fail()
  }
}
