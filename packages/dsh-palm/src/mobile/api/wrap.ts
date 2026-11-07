/**
 * RPC 应答外壳（从 makeMobileApiRoutes 闭包里提出来）。
 *
 * 注意：**必须显式传 rpcId**。原来闭包版直接用外层的 `rpcId`，
 * 看起来像纯函数其实不是——这正是上一轮"提纯"后 3 个 envelope 测试变红的原因。
 *
 * @module dsh-palm/mobile/api/wrap
 */

/** 把处理器返回值包成客户端认识的 server-response 帧。 */
export function wrap(rpcId: string, response: { result: unknown }): unknown {
  return {
    type: 'server-response' as const,
    rpcId,
    result: response.result,
  }
}
