/**
 * **花名册失效出口**（W4-4）。
 *
 * `invalidateWorkspaceRoster` 原来写在 `api.ts` 里、只清本地缓存。域实现搬出去之后，
 * 写操作全部在 `data/impl/workspace.ts` 里——失效动作也跟过来，`api.ts` 只 re-export
 * 保持对外 API 不变（`data/session.ts` 等门面还从它导入）。
 *
 * 语义没变：**清掉缓存即可**，在飞的请求不用打断（它回来会写一份新的，时间戳也是新的）。
 *
 * @module dsh-palm/mobile/data/invalidate-roster
 */
import { setRosterCached } from './workspace-roster.ts'

/**
 * 工作区花名册变了的唯一出口。
 *
 * 5 秒复用窗口是给"反复进出页面"省往返的；写入之后还留着它，就会把刚删掉的行画回来、
 * 把刚建的藏起来（真机表现：删了工作区还能看见，退出再进才有变化）。
 */
export function invalidateWorkspaceRoster(): void {
  setRosterCached(undefined)
}
