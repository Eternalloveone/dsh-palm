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
  // Windows cwd is a backslash path, so splitting on '/' alone would return the
  // whole `D:\dev\app` as a "title" — every session of one directory then
  // showed the same truncated path.
  const cwdTail = item.cwd !== undefined && item.cwd !== ''
    ? item.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? item.cwd
    : undefined
  const title = typeof titleValue === 'string' && titleValue !== ''
    ? titleValue
    : cwdTail ?? '新会话'
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
