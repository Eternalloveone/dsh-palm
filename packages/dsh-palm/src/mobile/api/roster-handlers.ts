/**
 * 花名册类本地处理器（P2：逐方法外移，原位调用）。
 *
 * - `agentPreset.list`：桌面端才改的预设清单，做 30 秒短 TTL。
 * - `subagent.list`：子代理清单 + 活动状态（走 running-evidence 的封装，不缓存）。
 *
 * @module dsh-palm/mobile/api/roster-handlers
 */
import type { ApiProxy } from '../../api-proxy-types.ts'
import { subagentCatalogWithActivity } from '../../host/running-evidence.ts'
import { ROSTER_TTL_MS } from './constants.ts'
import { processState } from './process-state.ts'
import { wrap } from './wrap.ts'

/** 花名册处理器需要的最小上下文。 */
export interface RosterHandlerContext {
  apiProxy: ApiProxy
  rpcId: string
  request: unknown
}

/** 预设清单（30 秒内同一次枚举直接回缓存）。 */
export async function agentPresetList(ctx: RosterHandlerContext): Promise<unknown> {
  const { apiProxy, request, rpcId } = ctx
  const cached = processState.agentPresetTtlCache
  if (cached !== undefined && cached.proxy === apiProxy && Date.now() - cached.at < ROSTER_TTL_MS) {
    return wrap(rpcId, cached.response)
  }
  const response = await apiProxy.agentPresets.list(request as never)
  processState.agentPresetTtlCache = { at: Date.now(), proxy: apiProxy, response }
  return wrap(rpcId, response)
}

/** 子代理清单 + 活动状态（不缓存：活动状态每次都要新）。 */
export async function subagentList(ctx: RosterHandlerContext): Promise<unknown> {
  const response = await subagentCatalogWithActivity(ctx.request, ctx.apiProxy)
  return wrap(ctx.rpcId, response)
}
