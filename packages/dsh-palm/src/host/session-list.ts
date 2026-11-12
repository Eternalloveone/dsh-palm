/**
 * **host · 会话列表分页与投影**（W5-1：从 `mobile-api.ts` 抽出的第九个域）。
 *
 * 手机上的会话列表是**游标分页**的：游标里编码了 `updatedAt + sessionId`（同一毫秒内的多条
 * 会话也要有稳定顺序，只按时间会漏行/重行）。这块还负责"哪些行该显示"：子代理会话与空
 * 会话不算用户会话、归档的不显示。
 *
 * 只搬纯函数——花名册的缓存与落盘状态（`sessionRoster*`）外部写入者多，仍留在 api.ts。
 * **能搬的是"格式与规则"，搬不动的先别搬。**
 *
 * @module dsh-palm/host/session-list
 */

/**
 * 列表行在手机端真正被读取的字段：`mobile/views/App.tsx` 的 `toSessionView` 取
 * sessionId / updatedAt / running / blank / cwd 与 `projections.values` 里的
 * title、preview、sessionStats，`RunOverviewView` 只再要 title / running / blank。
 *
 * 宿主返回的每一行都带着全部投影：实测一页 40 行 248~384 KB，其中 99% 是别的投影
 * （单行 `turnOutline` 最大 53 KB / 279 轮）。这些字节在 4G 上要走 1~2 秒、还要被
 * 手机解析和 JSON 序列化一次，然后丢掉。这里在发车前沿白名单裁掉。
 */
export const SESSION_LIST_KEPT_PROJECTIONS = ['title', 'preview', 'sessionStats'] as const

/** Strip a host roster row down to the fields the phone surface actually reads. */
export function trimSessionListRow<T extends { updatedAt: number; sessionId: string }>(row: T): T {
  const projections = (row as { projections?: { values?: Record<string, unknown> } }).projections
  const values = projections?.values
  // 没有投影：这行本来就小（只剩 id/时间/状态），原样发。
  if (projections === undefined || values === undefined) return row
  const kept: Record<string, unknown> = {}
  let keptCount = 0
  for (const key of SESSION_LIST_KEPT_PROJECTIONS) {
    const value = values[key]
    if (value !== undefined) {
      kept[key] = value
      keptCount += 1
    }
  }
  // 三个白名单键都没有：整块投影都没用，连外壳一起省掉（比留着空对象再小一点）。
  if (keptCount === 0) {
    const { projections: _dropped, ...rest } = row as T & { projections?: unknown }
    return rest as T
  }
  return { ...row, projections: { ...projections, values: kept } }
}

/**
 * One roster row: a host `session.list` item kept as-is. The snapshot persists
 * these rows and serves paged lists from them, so the item must keep every
 * field the phone renders — `projections.values` carries the title, the
 * preview line and the turn count, and dropping them turned every row into
 * "新会话" (2026-10-20). `blank` is the flag the phone filters on.
 */
export interface RosterItem {
  updatedAt: number
  sessionId: string
  origin?: 'subagent'
  blank?: boolean
  running?: boolean
  cwd?: string
  projections?: { values?: Record<string, unknown> }
  [field: string]: unknown
}

/**
 * Copy host session rows into roster rows. A shallow copy only: the snapshot
 * must round-trip everything the row renders (see {@link RosterItem}), and the
 * previous narrowing here is what erased the titles.
 */
export function toRosterItems(items: ReadonlyArray<RosterItem>): RosterItem[] {
  return items.map(item => ({ ...item }))
}

/** Encode one list position as an opaque continuation cursor. */
export function sessionListCursor(updatedAt: number, sessionId: string): string {
  return `${updatedAt}:${sessionId}`
}

/** Parse a cursor; malformed cursors mean "start over" (safe failure mode). */
export function parseSessionListCursor(cursor: string): { updatedAt: number; sessionId: string } | undefined {
  const separator = cursor.indexOf(':')
  if (separator < 0) return undefined
  const updatedAt = Number(cursor.slice(0, separator))
  if (!Number.isFinite(updatedAt)) return undefined
  return { updatedAt, sessionId: cursor.slice(separator + 1) }
}

/** Whether a row comes strictly after the cursor position. */
export function afterCursor(row: { updatedAt: number; sessionId: string }, position: { updatedAt: number; sessionId: string }): boolean {
  return row.updatedAt < position.updatedAt
    || (row.updatedAt === position.updatedAt && row.sessionId > position.sessionId)
}

/**
 * Rows the phone surface may show, in host order: main-agent sessions
 * (origin not 'subagent') that were not archived with
 * `workspace.deleteSession` / `workspace.archiveSession`, and that hold
 * something. The host archive set (from `workspace.list`) hides removed
 * sessions on the desktop, but the host `session.list` still returns attached
 * ones from its live registry — without this filter a session deleted on the
 * desktop reappears on the phone roster (and in pagination, since the page
 * slices come from this filtered array).
 *
 * Blank sessions (`blank: true`, no turn ever sent) are hidden for the same
 * reason the desktop tree hides them (`ui-workspace` keeps only the current
 * one): the desktop mints a blank session per "new chat" and per workspace
 * switch, and 542 of them had accumulated here by 2026-10-20 — the phone used
 * to list every one. The phone has no "current blank session" notion, so all
 * of them go.
 */
export function visibleSessionRows(
  rawItems: ReadonlyArray<RosterItem>,
  archivedSessionIds: ReadonlySet<string>,
  /* 返回 RosterItem 而不是就地写窄类型：调用方还要读 unning / cwd 等字段，
     写成 {updatedAt, sessionId} 会让它们在类型上消失（运行时还在，但编译器不认）。 */
): RosterItem[] {
  return rawItems.filter(item =>
    item.origin !== 'subagent'
    && item.blank !== true
    && !archivedSessionIds.has(String(item.sessionId)))
}

/**
 * 工作区 → 会话归属表：`workspace.list` 的 `sessionIds` **并上**按 `cwd` 推出来的归属。
 *
 * 为什么要有 `cwd` 这一半（2026-11-10「抽屉只剩当前会话」）：`sessionIds` 有 TTL、
 * 也会在新会话刚建出来时落后一拍。表落后时按它过滤，抽屉里就只剩当前这一条 ——
 * 用户看到的正是"全部的会话都没了"。而每条会话自带 `cwd`、每个工作区自带 `path`，
 * 两边归一后按**最长前缀**归属：`D:\work\ICNT9388` 不会把
 * `D:\work\ICNT9388\1.Code\07.FEP` 名下的会话抢走。
 *
 * @param workspaces - `workspace.list` 的行（`workspaceId` / `path` / `sessionIds`）
 * @param rows - 花名册行（`sessionId` / `cwd`）
 * @returns `workspaceId → Set<sessionId>`（并集，不改原表）
 */
export function ownedByWorkspaces(
  workspaces: ReadonlyArray<{ workspaceId: string; path?: string; sessionIds?: readonly string[] }>,
  rows: ReadonlyArray<{ sessionId: string; cwd?: string }>,
): Map<string, Set<string>> {
  const owned = new Map<string, Set<string>>()
  for (const workspace of workspaces) {
    owned.set(String(workspace.workspaceId), new Set((workspace.sessionIds ?? []).map(String)))
  }
  // 深的路径优先：嵌套工作区各自收自己的孩子。
  const byDepth = workspaces
    .map(workspace => ({ id: String(workspace.workspaceId), path: normalizeWorkspacePath(workspace.path) }))
    .filter(workspace => workspace.path !== '')
    .sort((a, b) => b.path.length - a.path.length)
  for (const row of rows) {
    const cwd = normalizeWorkspacePath(row.cwd)
    if (cwd === '') continue
    const hit = byDepth.find(workspace => cwd === workspace.path || cwd.startsWith(`${workspace.path}/`))
    if (hit !== undefined) owned.get(hit.id)?.add(String(row.sessionId))
  }
  return owned
}

/** 路径归一：斜杠统一、去尾斜杠、小写（Windows 大小写不敏感）。 */
export function normalizeWorkspacePath(path: string | undefined): string {
  if (path === undefined) return ''
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}
