/**
 * 会话行模型（列表页与聊天页共用的同一份）。
 *
 * S5b 从 `views/App.tsx` 搬出：`list-persist`（缓存层）只需要这个类型，却因为它在
 * App 里而被迫 import App —— 那条边正是「App → 视图 → App」大环的一段。搬进
 * `shared/` 之后，缓存层只依赖 shared，环才断得干净。
 */

/** The session-list row model (list + chat share it). */
export interface SessionView {
  sessionId: string
  title: string
  /** Latest-message preview from the host projection (absent most of the time). */
  preview?: string
  /** Turn count from the sessionStats projection (preview fallback line). */
  turns?: number
  cwd?: string
  updatedAt: number
  running: boolean
  blank: boolean
  /** Host-reported failure (`api-session/error`); cleared when it runs again. */
  error?: string
}

/** Map a list row to the surface model; the title comes from projections when present. */
/**
 * 会话所属目录的名字（`dsh-palm` / `ICNT9388`）。
 *
 * Windows 的 cwd 是反斜杠路径：只按 `/` 拆会把整条 `D:\dev\app` 当成名字，
 * 同一个目录下的会话于是全显示成同一个截断路径（2026-11-11 的标题 bug 就是这么来的）。
 * 任务页现在也要用它标"这条在跑的任务属于哪个工作区"，所以抽出来共用。
 *
 * @param cwd - 会话的工作目录（可缺）
 * @returns 目录名；给空或没给时返回 undefined
 */
export function cwdTail(cwd: string | undefined): string | undefined {
  if (cwd === undefined || cwd === '') return undefined
  return cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd
}

export function toSessionView(item: {
  sessionId: string
  updatedAt: number
  running: boolean
  blank: boolean
  cwd?: string
  projections?: { values?: Record<string, unknown> }
}): SessionView {
  const values = item.projections?.values
  const titleValue = values?.title
  // 没有标题就用「新会话」，不再兜底成目录名：同一个工作区里每条无标题会话的目录名
  // 都一样，排在一起既没有区分度，又会让用户以为标题被改成了项目名。
  const title = typeof titleValue === 'string' && titleValue !== '' ? titleValue : '新会话'
  const previewValue = values?.preview
  const stats = values?.sessionStats
  const turns = typeof stats === 'object' && stats !== null
    ? (stats as Record<string, unknown>).turns
    : undefined
  return {
    sessionId: item.sessionId,
    title,
    ...(typeof previewValue === 'string' && previewValue !== '' ? { preview: previewValue } : {}),
    ...(typeof turns === 'number' && turns > 0 ? { turns } : {}),
    ...(item.cwd !== undefined ? { cwd: item.cwd } : {}),
    updatedAt: item.updatedAt,
    running: item.running,
    blank: item.blank,
  }
}
