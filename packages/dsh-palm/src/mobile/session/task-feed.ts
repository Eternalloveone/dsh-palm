/**
 * 「任务」页的取数入口（W4-3：视图不再直连 `api.ts`）。
 *
 * `TasksView` 要两样东西：会话列表（用来算「刚完成」）与在跑的会话 id。
 * 这两个调用原本直接写在视图里，会让"数据从哪来"散在视图层；收到这里之后，
 * 视图只表达"我要一份任务总览所需的原料"。
 *
 * @module dsh-palm/mobile/session/task-feed
 */
import { listSessions, runningSessions } from '../api.ts'

/** 任务页要的原料：一页会话 + 在跑的会话 id。 */
export interface TaskFeed {
  sessions: Awaited<ReturnType<typeof listSessions>>
  running: Awaited<ReturnType<typeof runningSessions>>
}

/**
 * 并行拉齐任务页要的两份数据。任一份失败都只退回空值——任务页是只读总览，
 * 一个分区拉不到不该让整页变成错误态。
 *
 * @returns 会话列表与在跑会话 id
 */
export async function loadTaskFeed(): Promise<TaskFeed> {
  const [sessions, running] = await Promise.all([
    listSessions().catch(() => ({ items: [], hasMore: false })),
    runningSessions().catch(() => ({ sessionIds: [] as string[] })),
  ])
  return { sessions: sessions as TaskFeed['sessions'], running: running as TaskFeed['running'] }
}

/**
 * 按会话 id 补一份「工作目录索引」（只补首页里没有的那些）。
 *
 * 「刚完成」的行来自宿主的收工账本：它只有 id / 标题 / 耗时 / 结果，**没有 cwd**。
 * 而工作区名只在 session.list 里，所以要按 id 回查。翻页上限 3 页 —— 任务页每 5 秒
 * 刷一次，翻页必须有界；调用方也会把已经查到的 id 缓存住，正常情况这里一次都不翻。
 *
 * @param ids - 要查 cwd 的会话 id
 * @returns id → cwd（查不到的不会出现在 map 里）
 */
export async function loadCwdIndex(ids: readonly string[]): Promise<Map<string, string>> {
  const want = new Set(ids.map(id => String(id)))
  const found = new Map<string, string>()
  let cursor: string | undefined
  for (let round = 0; round < 3 && want.size > 0; round += 1) {
    const page = await listSessions(cursor).catch(() => undefined)
    if (page === undefined) break
    for (const item of page.items ?? []) {
      const id = String(item.sessionId)
      if (!want.has(id)) continue
      const cwd = item.cwd
      if (typeof cwd !== 'string' || cwd === '') continue
      found.set(id, cwd)
      want.delete(id)
    }
    if (page.hasMore !== true || page.nextCursor === undefined) break
    cursor = page.nextCursor
  }
  return found
}
