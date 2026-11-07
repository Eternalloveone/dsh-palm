/**
 * **data 门面 · session 域**（W4-3）。
 *
 * 视图不该知道"数据是 RPC 拿的还是本地算的"。这一层目前只是**显式转出**，行为与
 * 直接 import `api.ts` 完全一致——建壳阶段的目标就是零行为变化，先把调用点挪过来，
 * 后面再在壳里换实现（缓存 / 批处理 / 失败重试）。
 *
 * 为什么用**具名转出**而不是 `export *`：
 * - `export *` 会把 73 个函数一次性暴露，门面就退化成别名，域边界形同虚设；
 * - 具名列表还能被测试盯住（见 `facade.test.ts`），加函数必须显式登记。
 *
 * @module dsh-palm/mobile/data/session
 */
export {
  archiveSession,
  assignSessionFolder,
  cancelSession,
  createSession,
  createSessionFolder,
  goalAction,
  goalOf,
  history,
  inboxOf,
  listSessions,
  observeSession,
  prompt,
  queueItemViewOf,
  readChat,
  readSessionFolders,
  renameSession,
  searchAll,
  searchMessages,
  searchSessions,
  sendCommand,
  sessionState,
  updateQueue,
} from '../api.ts'
