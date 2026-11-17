/**
 * 工作区归属的唯一真源：会话属于哪个工作区（按 `cwd` 路径认领），工作区叫什么名字。
 *
 * 为什么需要（2026-11-12 用户：「怎么有时候显示本机工作区」→「这是补丁吗」）：
 *
 * `Route` 的每个变体都内嵌了一整份 `workspace: WorkspaceRow`（而不是 workspaceId），
 * 于是**每个造路由的地方都得自己拼一个对象**：首帧用 `EMPTY_WORKSPACE`、深链用
 * `title: ''`、跨工作区搜索用 `hit.workspaceTitle ?? ''`。拼不全就是空串，下游只能各自猜，
 * 系统里因此长出了三套不同的兜底（「本机工作区」/ 路径末段 / 干脆不显示）。
 *
 * 这里把「名字从哪来、没有时显示什么」收敛成**一个函数**：
 *
 * 1. 路由自带标题 → 直接信；
 * 2. 否则拿 workspaceId 去已加载的工作区列表查；
 * 3. 都没有 → 用路径末段（看得出是哪个目录），再没有才写「工作区」。
 *
 * `ready` 告诉调用方名字是**权威的**还是**临时的**（列表还没回来）。展示层不需要
 * 判断第二遍，也不需要知道加载状态 —— 那正是以前散落各处、互相不一致的原因。
 *
 * @module dsh-palm/mobile/session/workspace-directory
 */

/** 路由上携带的工作区（可能只有 id、标题是空串）。 */
export interface WorkspaceRef {
  readonly workspaceId?: string | undefined
  readonly title?: string | undefined
  readonly path?: string | undefined
}

/** 工作区列表里的一行（`WorkspaceRow` 的子集）。 */
export interface WorkspaceEntry {
  readonly workspaceId?: string | undefined
  readonly title?: string | undefined
  readonly path?: string | undefined
}

/** 解析结果：名字 + 路径 + 名字是否已经权威。 */
export interface WorkspaceView {
  /** 可以显示的名字（永不为空）。 */
  readonly name: string
  /** 工作区路径（可能为空）。 */
  readonly path: string
  /** `true` = 来自真实标题；`false` = 列表还没回来，名字是路径末段推出来的。 */
  readonly ready: boolean
}

/** 路径末段：`D:\proj\dsh-palm` → `dsh-palm`。 */
export function lastPathSegment(path: string): string {
  const segments = path.split(/[\\/]/).filter(segment => segment !== '')
  return segments.length === 0 ? '' : (segments[segments.length - 1] as string)
}

/**
 * 解析一个工作区该显示什么名字。
 *
 * @param workspace - 路由上带的工作区（可能不完整）
 * @param list - 已加载的工作区列表（可为空）
 * @returns 名字 / 路径 / 是否权威
 */
export function resolveWorkspace(
  workspace: WorkspaceRef | undefined,
  list: readonly WorkspaceEntry[] = [],
): WorkspaceView {
  const path = workspace?.path ?? ''
  const given = (workspace?.title ?? '').trim()
  if (given !== '') return { name: given, path, ready: true }
  const id = workspace?.workspaceId ?? ''
  if (id !== '') {
    const hit = list.find(entry => entry.workspaceId !== undefined && String(entry.workspaceId) === String(id))
    const listed = (hit?.title ?? '').trim()
    if (listed !== '') return { name: listed, path: path !== '' ? path : (hit?.path ?? ''), ready: true }
    // 列表里有这一行、但没给标题：用它的路径推名字，比路由上那份空的更靠谱。
    if (path === '' && (hit?.path ?? '') !== '') {
      const tail = lastPathSegment(hit?.path ?? '')
      if (tail !== '') return { name: tail, path: hit?.path ?? '', ready: false }
    }
  }
  const tail = lastPathSegment(path)
  if (tail !== '') return { name: tail, path, ready: false }
  return { name: '工作区', path, ready: false }
}

/**
 * 路径归一：斜杠统一、去尾斜杠、小写（Windows 路径大小写不敏感）。
 *
 * 归属的唯一比较口径：抽屉过滤（`views/drawer-rows.scopedToWorkspace`）、工作区置顶的
 * key、以及这里的 {@link workspaceIdForCwd} 都走它，否则同一台机器上同一目录会被认成
 * 两个工作区（`D:\proj\x` 与 `d:/work/x/`）。
 *
 * @param path - 原始路径（可能 undefined）
 * @returns 归一后的路径；空串表示"没有路径可比"
 */
export function pathKey(path: string | undefined): string {
  if (path === undefined) return ''
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * 这个 `cwd` 是不是落在某个工作区目录里（相等或在其子目录下）。
 *
 * @param cwd - 会话的工作目录
 * @param path - 工作区路径
 * @returns `true` / `false`；**任一侧没有路径时给 `undefined`** —— 「不知道」和
 *          「不属于」必须分开：调用方对前者的正确做法是保持原样，对后者才是排除。
 */
export function cwdInWorkspace(cwd: string | undefined, path: string | undefined): boolean | undefined {
  const target = pathKey(path)
  const key = pathKey(cwd)
  if (target === '' || key === '') return undefined
  return key === target || key.startsWith(`${target}/`)
}

/**
 * 会话的工作目录属于哪个工作区。
 *
 * 为什么不能直接用路由里那个 `workspaceId`（2026-11-16 真机）：从「任务」进别的工作区的
 * 会话时，路由沿用了当前工作区 —— 于是侧边栏把那条会话排进了当前工作区的第一行。
 * `cwd` 是归属的**事实**（每条会话都有、每个工作区都有），按它认领即可。
 *
 * 嵌套工作区（`D:/work` 与 `D:/work/sub`）取**路径最长**的那个：一条 `D:/work/sub/a`
 * 里的会话属于后者，不是它上面那个。
 *
 * @param cwd - 会话的工作目录
 * @param list - 已加载的工作区列表
 * @returns 命中的 workspaceId；认不出来给 `undefined`（调用方决定退到哪里）
 */
export function workspaceIdForCwd(
  cwd: string | undefined,
  list: readonly WorkspaceEntry[] = [],
): string | undefined {
  if (pathKey(cwd) === '') return undefined
  let best: string | undefined
  let bestLength = -1
  for (const entry of list) {
    if (entry.workspaceId === undefined) continue
    if (cwdInWorkspace(cwd, entry.path) !== true) continue
    const length = pathKey(entry.path).length
    if (length <= bestLength) continue
    best = String(entry.workspaceId)
    bestLength = length
  }
  return best
}
