/**
 * 「切换工作区」列表的纯函数：短路径、去重分组、搜索、相对时间。
 *
 * 为什么单独成文件：面板要按"当前 / 最近用过 / 按项目分组"三段落渲染，而这三件事全是
 * 数据整形 —— 放进 .tsx 会让组件既算又画，测试也只能靠渲染断言。这里保持零 React。
 *
 * @module dsh-palm/mobile/views/chat/components/workspace-picker-model
 */

/** 面板只用到这几列（与 `WorkspaceView` 兼容，测试可传更小的对象）。 */
export interface WorkspaceLike {
  workspaceId: string
  path: string
  title?: string
  updatedAt?: string
  sessionIds?: readonly string[]
}

/** 会话里只用到这三列（与 `SessionView` / `session.list` 的行兼容）。 */
export interface SessionLike {
  sessionId: string
  updatedAt?: number
  cwd?: string
}

/**
 * 从会话列表算「每个工作区最后一次活动」（毫秒）。
 *
 * 为什么需要：`workspace.updatedAt` 只在建工作区/改名时动，**跑会话不刷新它**
 * （实测：`D:\proj\dsh_dev` 的字段停在 5 天前，而它今天一直在跑）。真实活动时间在
 * 会话上，这里把它归到工作区：优先按 `sessionIds` 归属（权威），没有归属关系时按
 * `cwd === 工作区路径` 兜底（子代理/散会话因此不会污染）。
 *
 * @param workspaces - 工作区列表
 * @param sessions - 会话列表（任意页，取到的最大值就是最新活动）
 * @returns 工作区 id → 最新活动时间戳
 */
export function workspaceActivityOf(
  workspaces: readonly WorkspaceLike[],
  sessions: readonly SessionLike[],
): Map<string, number> {
  const activity = new Map<string, number>()
  const bySessionId = new Map<string, string>()
  const byPath = new Map<string, string>()
  for (const workspace of workspaces) {
    const id = String(workspace.workspaceId)
    byPath.set(workspace.path, id)
    for (const sessionId of workspace.sessionIds ?? []) bySessionId.set(sessionId, id)
  }
  for (const session of sessions) {
    const at = session.updatedAt
    if (typeof at !== 'number' || !Number.isFinite(at)) continue
    const owner = bySessionId.get(session.sessionId)
      ?? (session.cwd === undefined ? undefined : byPath.get(session.cwd))
    if (owner === undefined) continue
    const previous = activity.get(owner)
    if (previous === undefined || at > previous) activity.set(owner, at)
  }
  return activity
}

/** 一行在面板上的样子。 */
export interface WorkspaceRowView<T extends WorkspaceLike = WorkspaceLike> {
  id: string
  /** 主标题：工作区名（没有就用路径末段）。 */
  title: string
  /** 副标题：**能区分它**的最短路径尾巴，不是完整绝对路径。 */
  subtitle: string
  /** 当前项额外显示完整路径（用户能一眼确认自己在哪）。 */
  fullPath: string
  /** 会话数（0 表示空工作区，不显示）。 */
  sessionCount: number
  /** 相对时间（「今天」「昨天」「3 天前」），没有 `updatedAt` 时为空串。 */
  recentLabel: string
  raw: T
}

/** 分组：`kind` 决定样式，`label` 为组标题。 */
export interface WorkspaceGroup<T extends WorkspaceLike = WorkspaceLike> {
  key: string
  kind: 'current' | 'recent' | 'project'
  label: string
  /** 组标题右侧的浅色提示（项目组的上一级目录，如 `01.Code`）；没有则为空串。 */
  hint?: string
  rows: WorkspaceRowView<T>[]
}

/**
 * 把路径拆成段（同时吃 `\` 与 `/`，末尾分隔符不算一段）。
 *
 * @param path - 绝对路径
 * @returns 段数组，首个元素可能是盘符（`D:`）
 */
export function pathSegments(path: string): string[] {
  return path.split(/[\\/]+/u).filter(part => part !== '')
}

/** 主标题：优先用宿主给的 title，否则取路径末段。 */
export function titleOf(workspace: WorkspaceLike): string {
  const title = (workspace.title ?? '').trim()
  if (title !== '') return title
  const segments = pathSegments(workspace.path)
  return segments[segments.length - 1] ?? workspace.path
}

/**
 * 一组的父路径段（去掉末段=自己）。
 *
 * @param path - 绝对路径
 * @returns 父段数组
 */
function parentSegments(path: string): string[] {
  const segments = pathSegments(path)
  return segments.slice(0, -1)
}

/** 用 `\` 连接（Windows 习惯；Unix 路径也照此显示，不再区分）。 */
function joinTail(parts: readonly string[]): string {
  return parts.join('\\')
}

/**
 * 唯一名字的工作区：副标题取父路径的"首段 + … + 末两段"。
 *
/**
 * 唯一名字的工作区：副标题只保留"能定位它"的那一小段，**不是完整绝对路径**。
 *
 * 例：`D:\steam` → `D:\steam`；`D:\proj\dsh-palm` → `D:\proj`；
 *     `D:\proj\A\B\C\X` → `D:\…\B\C`（中间省略）。
 *
 * @param path - 绝对路径
 * @returns 副标题（路径只有一段时返回空串）
 */
export function parentTail(path: string): string {
  const parents = parentSegments(path)
  if (parents.length === 0) return ''
  if (parents.length === 1) return path
  if (parents.length <= 2) return joinTail(parents)
  return joinTail([parents[0], '…', ...parents.slice(-2)])
}

/**
 * 分组标题：父目录的最后**一级**（够短、够认）。
 *
 * 例：`D:\proj\dsh-palm` → `work`；`D:\proj\proj-a\1.Code\X` → `1.Code`；
 *     直接挂在盘符下的（`D:\steam`）没有项目可言 → `其它`。
 *
 * 为什么不是"父目录最后两级"：真机上 `01.Code\00.Master` 这种两段标题又长又技术味，
 * 一屏只能放下两三组；只取最后一级后组头变短，上一级移到右侧浅色提示里（{@link projectHint}）。
 *
 * @param path - 绝对路径
 * @returns 组标题
 */
export function projectLabel(path: string): string {
  const parents = parentSegments(path)
  if (parents.length <= 1) return '其它'
  return parents[parents.length - 1] ?? '其它'
}

/**
 * 组标题右侧的浅色提示：上一级目录（没有就空串）。
 *
 * 例：`D:\proj\proj-a\1.Code\X` → `proj-a`（组标题是 `1.Code`）。
 *
 * @param path - 绝对路径
 * @returns 提示文案
 */
export function projectHint(path: string): string {
  const parents = parentSegments(path)
  if (parents.length <= 2) return ''
  return parents[parents.length - 2] ?? ''
}

/**
 * 分组用的**唯一键**：父目录尾巴（比组标题长，避免两个不同项目都叫 `00.Master` 被并到一组）。
 *
 * @param path - 绝对路径
 * @returns 分组键
 */
export function projectKey(path: string): string {
  const parents = parentSegments(path)
  if (parents.length <= 1) return '其它'
  return joinTail(parents)
}

/**
 * 同名的几个工作区：取**最短**能把它们分开的父段尾巴。
 *
 * 例：`…\1.Code\00.master` 与 `…\1.Code\06.DP523` → `00.master` / `06.DP523`；
 *     若两个仍相同则自动加一级（`6.DP523\x` / `6.DP523\y`）。
 *
 * @param paths - 同名工作区的路径（顺序无关）
 * @returns 与入参同序的副标题
 */
export function distinguishingTails(paths: readonly string[]): string[] {
  const parents = paths.map(parentSegments)
  const maxDepth = Math.max(1, ...parents.map(parts => parts.length))
  for (let depth = 1; depth <= maxDepth; depth++) {
    const tails = parents.map(parts => joinTail(parts.slice(-depth)))
    if (new Set(tails).size === tails.length) return tails
  }
  return parents.map(parts => joinTail(parts))
}

/**
 * 相对时间：今天 / 昨天 / N 天前 / 空。
 *
 * @param iso - 时间戳（ISO 或可被 Date 解析的字符串）
 * @param now - 当前时间（毫秒；测试注入）
 * @returns 文案
 */
export function relativeDay(iso: string | undefined, now: number): string {
  if (iso === undefined || iso === '') return ''
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const days = Math.floor((startOfToday.getTime() - at) / 86_400_000)
  if (at >= startOfToday.getTime()) return '今天'
  if (days < 1) return '昨天'
  if (days < 30) return `${days + 1} 天前`
  return ''
}

/**
 * 搜索：名称或路径任一段命中即算（大小写不敏感）。
 *
 * @param workspace - 工作区
 * @param query - 关键词（空串=不过滤）
 * @returns 是否保留
 */
export function matchesQuery(workspace: WorkspaceLike, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  if (titleOf(workspace).toLowerCase().includes(needle)) return true
  return workspace.path.toLowerCase().includes(needle)
}

/**
 * 把工作区列表整形成面板要的三段。
 *
 * 规则（与设计稿一致）：
 *   ① 「当前」永远第一组，哪怕它同时是最近用过的；
 *   ② 「最近用过」按**最后活动时间**倒序取前 {@link RECENT_LIMIT} 个（不含当前）；
 *   ③ 其余按父目录分组，组标题 = 父路径尾巴，组内按名称排；
 *   ④ 搜索时只留命中的行，不再显示「当前/最近」这两段（结果越少越好找）。
 *
 * ②里的「最后活动时间」**不能只看 `workspace.updatedAt`**（2026-11-11 真机：用户
 * 「有的工作区我一直在跑，却不在最近使用里」）。实测同一个宿主：
 *
 * | 工作区 | workspace.updatedAt | 该工作区最活跃会话 |
 * |---|---|---|
 * | D:\proj\dsh_dev | 11-06（5 天前） | **11-11 今天** |
 * | D:\steam | 10-29（13 天前） | **11-11 今天** |
 *
 * 那个字段只在建工作区/改名字这类操作时动，跑会话不会刷新它。真实的活动时间在
 * **会话**上，所以调用方把 `sessionActivity` 传进来（会话 `updatedAt` 的最大值），
 * 两者取大。
 *
 * @param workspaces - 全量工作区
 * @param currentId - 当前工作区 id（空串表示不知道）
 * @param query - 搜索词
 * @param now - 当前时间（毫秒；测试注入）
 * @param sessionActivity - 工作区 id → 该工作区里最新一次会话活动（毫秒）；可省
 * @returns 分组数组（可能为空）
 */
export function buildWorkspaceGroups<T extends WorkspaceLike>(
  workspaces: readonly T[],
  currentId: string,
  query = '',
  now = Date.now(),
  sessionActivity?: ReadonlyMap<string, number>,
): WorkspaceGroup<T>[] {
  const needle = query.trim()
  const searching = needle !== ''
  const pool = workspaces.filter(workspace => matchesQuery(workspace, needle))

  /**
   * 最后活动时间：`workspace.updatedAt`（建/改名时动）与会话活动取大。
   *
   * 拿不到任何时间戳 → undefined（这一行不参与「最近用过」，也不显示相对时间）。
   */
  const lastActiveOf = (workspace: T): number | undefined => {
    const stamped = Date.parse((workspace.updatedAt ?? '').trim())
    const fromSessions = sessionActivity?.get(String(workspace.workspaceId))
    const values = [Number.isFinite(stamped) ? stamped : undefined, fromSessions]
      .filter((value): value is number => value !== undefined && Number.isFinite(value))
    return values.length === 0 ? undefined : Math.max(...values)
  }


  // 同名去重：先按标题分堆，再给每堆算最短区分尾巴。
  const byTitle = new Map<string, T[]>()
  for (const workspace of pool) {
    const title = titleOf(workspace)
    const bucket = byTitle.get(title)
    if (bucket === undefined) byTitle.set(title, [workspace])
    else bucket.push(workspace)
  }
  const subtitleById = new Map<string, string>()
  for (const bucket of byTitle.values()) {
    const tails = distinguishingTails(bucket.map(workspace => workspace.path))
    bucket.forEach((workspace, index) => { subtitleById.set(String(workspace.workspaceId), tails[index] ?? '') })
  }

  const toRow = (workspace: T): WorkspaceRowView<T> => {
    const activeAt = lastActiveOf(workspace)
    return {
      id: String(workspace.workspaceId),
      title: titleOf(workspace),
      subtitle: subtitleById.get(String(workspace.workspaceId)) ?? '',
      fullPath: workspace.path,
      sessionCount: workspace.sessionIds?.length ?? 0,
      recentLabel: activeAt === undefined ? '' : relativeDay(new Date(activeAt).toISOString(), now),
      raw: workspace,
    }
  }

  const groups: WorkspaceGroup<T>[] = []
  const current = pool.find(workspace => String(workspace.workspaceId) === currentId)
  if (current !== undefined) groups.push({ key: 'current', kind: 'current', label: '当前', rows: [toRow(current)] })

  if (!searching) {
    const recent = pool
      .filter(workspace => workspace !== current)
      .map(workspace => ({ workspace, activeAt: lastActiveOf(workspace) }))
      .filter((entry): entry is { workspace: T; activeAt: number } => entry.activeAt !== undefined)
      .sort((a, b) => b.activeAt - a.activeAt)
      .slice(0, RECENT_LIMIT)
      .map(entry => entry.workspace)
    if (recent.length > 0) groups.push({ key: 'recent', kind: 'recent', label: '最近用过', rows: recent.map(toRow) })
  }

  const usedIds = new Set(groups.flatMap(group => group.rows.map(row => row.id)))
  const rest = pool.filter(workspace => !usedIds.has(String(workspace.workspaceId)))
  const byParent = new Map<string, { label: string; hint: string; rows: T[] }>()
  for (const workspace of rest) {
    const key = projectKey(workspace.path)
    const bucket = byParent.get(key)
    if (bucket === undefined) {
      byParent.set(key, { label: projectLabel(workspace.path), hint: projectHint(workspace.path), rows: [workspace] })
    } else {
      bucket.rows.push(workspace)
    }
  }
  const projects = [...byParent.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  for (const [key, bucket] of projects) {
    groups.push({
      key: `project:${key}`,
      kind: 'project',
      label: bucket.label,
      hint: bucket.hint,
      rows: [...bucket.rows].sort((a, b) => titleOf(a).localeCompare(titleOf(b))).map(toRow),
    })
  }
  return groups
}

/**
 * 搜索命中高亮：把 `text` 按 `query` 切片，命中的片段标 `hit`。
 *
 * 为什么放在模型里：这是纯字符串活，且要保证「大小写不敏感、多处命中、首尾无命中」三种情况
 * 都不丢字符 —— 用正则拼 HTML 既难测又会把路径里的 `\` 吃掉。
 *
 * @param text - 要显示的文本
 * @param query - 搜索词（空串=整段不命中）
 * @returns 片段数组；`hit` 为真表示命中
 */
export function highlightMatch(text: string, query: string): { text: string; hit: boolean }[] {
  const needle = query.trim()
  if (needle === '') return [{ text, hit: false }]
  const haystack = text.toLowerCase()
  const lower = needle.toLowerCase()
  const parts: { text: string; hit: boolean }[] = []
  let cursor = 0
  while (cursor < text.length) {
    const at = haystack.indexOf(lower, cursor)
    if (at === -1) { parts.push({ text: text.slice(cursor), hit: false }); break }
    if (at > cursor) parts.push({ text: text.slice(cursor, at), hit: false })
    parts.push({ text: text.slice(at, at + needle.length), hit: true })
    cursor = at + needle.length
  }
  return parts.filter(part => part.text !== '')
}

/** 「最近用过」最多几条（多了会把下面的项目组挤出屏幕）。 */
export const RECENT_LIMIT = 3

/** 分组里一共有多少行（底部计数用）。 */
export function countRows(groups: readonly WorkspaceGroup<WorkspaceLike>[]): number {
  return groups.reduce((sum, group) => sum + group.rows.length, 0)
}
