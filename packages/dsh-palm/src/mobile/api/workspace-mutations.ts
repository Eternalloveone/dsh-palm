/**
 * workspace 域的写操作（P2：逐方法外移，原位调用，不动分发表结构）。
 *
 * 四个方法的形状完全一致：清花名册缓存 → 调宿主 → 套应答外壳。
 * 抽成一个 mutate() 避免四份重复代码，行为与搬出前逐行等价。
 *
 * @module dsh-palm/mobile/api/workspace-mutations
 */
import type { ApiProxy } from '../../api-proxy-types.ts'
import { patchRosterAfterArchive, recordArchivedIds } from '../../host/session-roster.ts'
import { wrap } from './wrap.ts'

/** 写操作需要的最小上下文。 */
export interface WorkspaceMutationContext {
  apiProxy: ApiProxy
  rpcId: string
  request: unknown
  /** 写操作后清花名册缓存（由移动端主文件经 ctx 传入，避免反向依赖）。 */
  invalidateRosterCaches: () => void
  /** 只有搜索快照要作废时用（归档走就地摘行，不必整份作废花名册）。 */
  invalidateSessionSearch?: () => void
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

/** 归档某个会话（从工作区里摘掉）。
 *
 * 应答带**全量** `archivedSessionIds`，删完当场就能把两件事做对：就地摘行（下一次读
 * 列表立刻正确，不用等 6~23 秒的全量枚举）+ 记下这份归档集（在飞的那次枚举装快照时
 * 会改用这份新的，否则刚删掉的会话会被装回快照并落盘）。
 */
export const workspaceArchiveSession = async (ctx: WorkspaceMutationContext): Promise<unknown> => {
  const response = wrap(ctx.rpcId, (await ctx.apiProxy.workspace.archiveSession(ctx.request as never)) as { result: unknown })
  const archived = archivedIdsOf(response)
  // 老宿主没带归档集：拿不到"删完之后长什么样"，只能整份作废等重枚举。
  if (archived === undefined) { ctx.invalidateRosterCaches(); return response }
  recordArchivedIds(archived)
  // 还没有快照（进程刚起 / 刚清过）：位置由下一次冷枚举填，作废与否则无差别。
  if (!patchRosterAfterArchive(new Set(archived))) { ctx.invalidateRosterCaches(); return response }
  // 花名册已就地修好；搜索快照里可能还留着这条会话的名字，单独作废它。
  ctx.invalidateSessionSearch?.()
  return response
}

/**
 * 归档应答里的全量归档 id（`{ ok: true, value: { archivedSessionIds } }`）。
 * 老宿主或失败应答拿不到就返回 undefined —— 那种情况枚举自己那份照旧生效。
 */
function archivedIdsOf(response: unknown): string[] | undefined {
  const result = (response as { result?: { ok?: boolean; value?: { archivedSessionIds?: unknown } } }).result
  if (result?.ok !== true) return undefined
  const ids = result.value?.archivedSessionIds
  return Array.isArray(ids) ? ids.map(String) : undefined
}
