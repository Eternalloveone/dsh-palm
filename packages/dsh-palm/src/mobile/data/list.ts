/**
 * **data 门面 · 会话列表页**（W4-3）：页面级门面。
 *
 * 会话列表页同时要用 session / workspace / diag 三个域，逐个域 import 会让文件头
 * 多出两行——而视图行数预算是"只降不升"的硬约束。这里按**页面视角**再包一层：
 * 页面拿到"这个页面需要的全部数据入口"，域仍然是它们的真源（本文件只转出，不含逻辑）。
 *
 * 判定标准：只有当"页面需要的域 ≥3"时才建页面门面；否则直接用域门面。
 *
 * @module dsh-palm/mobile/data/list
 */
export {
  archiveSession,
  assignSessionFolder,
  createSession,
  createSessionFolder,
  history,
  listSessions,
  readSessionFolders,
  renameSession,
  runningSessions,
  type SessionFoldersView,
} from './session.ts'
export { listAgentPresets, listWorkspaces, previews } from './workspace.ts'
export { logTail } from './diag.ts'
