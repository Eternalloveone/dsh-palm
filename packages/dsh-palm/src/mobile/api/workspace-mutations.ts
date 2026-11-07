/**
 * workspace 域的写操作（P2：逐方法外移，原位调用，不动分发表结构）。
 *
 * 四个方法的形状完全一致：清花名册缓存 → 调宿主 → 套应答外壳。
 * 抽成一个 mutate() 避免四份重复代码，行为与搬出前逐行等价。
 *
 * @module dsh-palm/mobile/api/workspace-mutations
 */
import type { ApiProxy } from '../../api-proxy-types.ts'
import { wrap } from './wrap.ts'

/** 写操作需要的最小上下文。 */
export interface WorkspaceMutationContext {
  apiProxy: ApiProxy
  rpcId: string
  request: unknown
  /** 写操作后清花名册缓存（由移动端主文件经 ctx 传入，避免反向依赖）。 */
  invalidateRosterCaches: () => void
}

async function mutate(ctx: WorkspaceMutationContext, run: () => Promise<unknown>): Promise<unknown> {
  ctx.invalidateRosterCaches()
  return wrap(ctx.rpcId, (await run()) as { result: unknown })
}

/** 新建工作区。 */
export const workspaceCreate = (ctx: WorkspaceMutationContext): Promise<unknown> =>
  mutate(ctx, () => ctx.apiProxy.workspace.create(ctx.request as never))

/** 删除工作区。 */
export const workspaceDelete = (ctx: WorkspaceMutationContext): Promise<unknown> =>
  mutate(ctx, () => ctx.apiProxy.workspace.delete(ctx.request as never))

/** 重命名工作区。 */
export const workspaceRename = (ctx: WorkspaceMutationContext): Promise<unknown> =>
  mutate(ctx, () => ctx.apiProxy.workspace.rename(ctx.request as never))

/** 归档某个会话（从工作区里摘掉）。 */
export const workspaceArchiveSession = (ctx: WorkspaceMutationContext): Promise<unknown> =>
  mutate(ctx, () => ctx.apiProxy.workspace.archiveSession(ctx.request as never))
