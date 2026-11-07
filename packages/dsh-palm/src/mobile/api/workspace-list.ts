/**
 * `workspace.list` 的实现（P2 试点：先搬一个方法，不动分发表结构）。
 *
 * 逻辑与搬出前逐行等价：短 TTL 缓存 + 命中即回 + 写回缓存 + 统一外壳。
 * 依赖全部显式传入（ctx 里只取需要的两个字段），不捕获闭包。
 *
 * @module dsh-palm/mobile/api/workspace-list
 */
import type { ApiProxy } from '../../api-proxy-types.ts'
import { ROSTER_TTL_MS } from './constants.ts'
import { processState } from './process-state.ts'
import { wrap } from './wrap.ts'

/** 处理器需要的最小上下文。 */
export interface WorkspaceListContext {
  apiProxy: ApiProxy
  rpcId: string
  request: unknown
}

/** 列出工作区；30 秒内同一次枚举直接回缓存。 */
export async function workspaceList(ctx: WorkspaceListContext): Promise<unknown> {
  const { apiProxy, request, rpcId } = ctx
  const cached = processState.workspaceListTtlCache
  if (cached !== undefined && cached.proxy === apiProxy && Date.now() - cached.at < ROSTER_TTL_MS) {
    return wrap(rpcId, cached.response)
  }
  const response = await apiProxy.workspace.list(request as never)
  processState.workspaceListTtlCache = { at: Date.now(), proxy: apiProxy, response }
  return wrap(rpcId, response)
}
