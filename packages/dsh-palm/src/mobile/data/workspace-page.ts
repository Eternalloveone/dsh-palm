/**
 * **data 门面 · 工作区页**（W4-3）：页面级门面。
 *
 * 工作区页要同时用 session 域的搜索与 workspace 域的增删改。逐个域 import 虽然只多
 * 一行，但视图行数预算是"只降不升"的硬约束——这里按页面视角包一层，域仍是真源。
 *
 * 判定标准（与 `list.ts` 一致）：页面需要 ≥2 个域、且视图本身已贴着行数上限时建页面门面。
 *
 * @module dsh-palm/mobile/data/workspace-page
 */
export { searchAll, searchMessages, searchSessions, type SessionSearchHit } from './session.ts'
export { createWorkspace, deleteWorkspace, listWorkspaces, renameWorkspace } from './workspace.ts'
