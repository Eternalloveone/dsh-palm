/**
 * 抽屉会话行的纯函数（从 App.tsx 抽出来，便于单测）。
 *
 * 2026-11-10 的两次实机投诉都落在这里：
 * - 第一次「切换不了工作区 / 列表显示失效」：宿主按带 TTL 的 `sessionIds` 过滤，
 *   表落后时会漏发甚至发全量；抽屉又把新页整表覆盖，于是空页直接清空列表。
 * - 第二次「打开侧边栏只剩当前会话」：按 `sessionIds` 过滤把绝大多数行滤掉了。
 *
 * 修法：把 `cwd` 路径当成归属的**事实**（每条会话都有、每个工作区都有），
 * `sessionIds` 只作兜底；抽屉的行只增不减（并集）。
 *
 * 2026-11-11：行右侧「什么时候」的 `drawerWhenLabel` 搬去了 `ui/drawer-when.ts`
 * —— 它是纯展示格式化却被 ui 的抽屉直接调用，留在 views 会让 ui 反向依赖 views。
 *
 * @module dsh-palm/mobile/views/drawer-rows
 */
import type { SessionView } from '../shared/session-view.ts'

/**
 * 路径归一：斜杠统一、去尾斜杠、小写（Windows 路径大小写不敏感）。
 *
 * @param path - 原始路径（可能 undefined）
 * @returns 归一后的路径；空串表示"没有路径可比"
 */
export function pathKey(path: string | undefined): string {
  if (path === undefined) return ''
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * 按工作区归属过滤一页会话行。
 *
 * 判据顺序：
 * 1. `cwd` 路径（事实）—— 相等或在本工作区目录之下；
 * 2. `sessionIds`（索引，可能落后）；
 * 3. 都没有命中就整页信宿主的（宿主已经过滤过）。
 *
 * @param items - 宿主返回的会话行（带 `cwd`）
 * @param workspace - 当前工作区（带 `path` 与 `sessionIds`）
 * @returns 过滤后的会话行（不改变顺序）
 */
export function scopedToWorkspace<T extends { sessionId: string; cwd?: string }>(
  items: readonly T[],
  workspace: { sessionIds?: readonly string[]; path?: string },
): T[] {
  const target = pathKey(workspace.path)
  if (target !== '') {
    const byPath = items.filter((item) => {
      const cwd = pathKey(item.cwd)
      return cwd !== '' && (cwd === target || cwd.startsWith(`${target}/`))
    })
    if (byPath.length > 0) return byPath
  }
  const owned = workspace.sessionIds ?? []
  if (owned.length > 0) {
    const ids = new Set(owned.map(String))
    const scoped = items.filter(item => ids.has(String(item.sessionId)))
    if (scoped.length > 0) return scoped
  }
  return [...items]
}

/**
 * 合并「宿主刚拉的一页」与「抽屉里已经在显示的行」。
 *
 * 抽屉原来用新页**整表覆盖**：宿主只回一页、或这一刻回了空页，抽屉立刻空掉
 * （连当前正在看的会话都不见）。改成并集。
 *
 * **顺序冻结在这里**（2026-11-11 第二次投诉「每次打开侧边栏次序就变」）：
 * 以前这一步会 `orderDrawerRows(merged)` 重排一遍，于是「宿主这一页的 updatedAt」
 * 成了画面上唯一的排序依据 —— 只要有一个会话在跑，它的 updatedAt 每几秒刷新一次，
 * 每次打开抽屉都能看到它往上浮一位。现在：
 *
 * 1. 已经在显示的行**保持原位**，只把字段（标题 / 运行态 / 时间）换成新值；
 * 2. 宿主这一页里**还没显示过**的新会话，按 `updatedAt` 插到第一个更旧的行前面；
 * 3. 当前会话仍然钉第一行。
 *
 * 下次重新打开抽屉时走的是 {@link paintDrawerRows}（按最新时间重排），所以
 * 「打开过程中绝不跳」和「跨次打开跟着最新走」两件事都保住了。
 *
 * @param fresh - 宿主这一页（已按工作区过滤）
 * @param shown - 抽屉当前显示的行（含本地缓存与当前会话）
 * @param pinnedSessionId - 要钉在第一行的会话
 * @returns 冻结了顺序的新数组
 */
export function mergeDrawerRows(
  fresh: readonly SessionView[],
  shown: readonly SessionView[],
  pinnedSessionId?: string,
): SessionView[] {
  const byId = new Map<string, SessionView>()
  for (const row of fresh) byId.set(String(row.sessionId), row)
  const seen = new Set<string>()
  const merged: SessionView[] = []
  for (const row of shown) {
    const id = String(row.sessionId)
    if (seen.has(id)) continue
    seen.add(id)
    const latest = byId.get(id)
    // `running` **不从这一页取**：列表行那个字段会撒谎（见本文件 applyRunningState 的
    // 注释），而它是这里最后写入者 —— 一次覆盖就把「运行中」抹掉，等下一拍轮询再补回来，
    // 用户看到的就是徽标自己闪。运行状态只由镜像（帧 + 复核过的探针）写。
    merged.push(latest === undefined ? row : { ...row, ...latest, running: row.running })
  }
  // 新会话按时间落到它在列表里该在的位置（不是一律追加到末尾：最新那条应该在顶上）。
  const freshOnly = fresh
    .filter((row) => !seen.has(String(row.sessionId)))
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt
      || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0))
  for (const row of freshOnly) {
    const index = merged.findIndex(other => other.updatedAt < row.updatedAt)
    if (index < 0) merged.push(row)
    else merged.splice(index, 0, row)
  }
  if (pinnedSessionId === undefined) return merged
  const index = merged.findIndex(row => String(row.sessionId) === String(pinnedSessionId))
  if (index <= 0) return merged
  const [pinned] = merged.splice(index, 1)
  return pinned === undefined ? merged : [pinned, ...merged]
}

/**
 * 抽屉里的**唯一**排序规则：当前会话钉第一行，其余按更新时间从新到旧。
 *
 * 2026-11-11 用户：「每次打开侧边栏，会话顺序老是变」。真因是两处各排各的：打开时把当前
 * 会话 unshift 到最前（不排序），一秒后宿主页到达又整表按 `updatedAt` 重排 —— 当前会话
 * 只要不是最新的那条，就每次打开都掉回原位。现在两边都走这个函数；同刻按 `sessionId`
 * 兜底，保证同一份数据永远给出同一个顺序。
 *
 * @param rows - 待排序的行
 * @param pinnedSessionId - 要钉在第一行的会话（当前打开的那个）；不在列表里就按纯时间排
 * @param pinnedIds - 用户**主动**置顶的会话 id（可多个）。与 `pinnedSessionId` 不同：
 *   那个是「当前打开」，这个是用户的选择且跨重启保留。置顶组整体排在最前，组内仍按
 *   时间倒序；当前会话若没被置顶，则排在置顶组之后、其余之前。
 * @returns 新数组，不修改入参
 */
export function orderDrawerRows<T extends { sessionId: string; updatedAt: number }>(
  rows: readonly T[],
  pinnedSessionId?: string,
  pinnedIds?: ReadonlySet<string>,
): T[] {
  const sorted = [...rows].sort((a, b) => b.updatedAt - a.updatedAt
    || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0))
  const hasPins = pinnedIds !== undefined && pinnedIds.size > 0
  if (!hasPins) {
    if (pinnedSessionId === undefined) return sorted
    const index = sorted.findIndex(row => String(row.sessionId) === String(pinnedSessionId))
    if (index <= 0) return sorted
    const [pinned] = sorted.splice(index, 1)
    return pinned === undefined ? sorted : [pinned, ...sorted]
  }
  const pinnedRows = sorted.filter(row => pinnedIds.has(String(row.sessionId)))
  const rest = sorted.filter(row => !pinnedIds.has(String(row.sessionId)))
  // 当前会话没被用户钉住时，仍然给它「紧贴置顶组」的位置 —— 这是原来那条
  // 「一进抽屉就看见自己」的保证，别因为加了手动置顶把它弄丢。
  if (pinnedSessionId !== undefined) {
    const index = rest.findIndex(row => String(row.sessionId) === String(pinnedSessionId))
    if (index > 0) {
      const [current] = rest.splice(index, 1)
      if (current !== undefined) rest.unshift(current)
    }
  }
  return [...pinnedRows, ...rest]
}

/**
 * 打开抽屉时要画的第一帧：当前会话钉第一行，其余按时间倒序。
 *
 * 抽在这里而不是写在 App.tsx 里，是因为 App 有行数预算（只降不升），
 * 而这套规则本身属于"抽屉怎么排"的领域知识。
 *
 * **当前会话的时间戳要补**（2026-11-11 用户：「一打开侧边栏，会话就从『更早』跳到『今天』」）：
 * 从 HUD、搜索结果或 URL 直接进会话时，路由里的 `SessionView.updatedAt` 是 `0`
 * （见 App.tsx 的 `openFinishedChat` 等）。首帧拿 0 去分桶就会落到「更早」，
 * 后台宿主页一到、换成真实时间又跳回「今天」—— 用户看到的是"什么都没干，分组自己变了"。
 *
 * 补的顺序：缓存行里同 id 的时间 → 缓存也没有才用"此刻"（刚打开的这个会话，
 * 本身就是最近在用的那个；宁可先归「今天」，也不要先归「更早」再跳走）。
 *
 * @param current - 当前会话（空会话页时给 undefined）
 * @param cached - 本地缓存的会话行
 * @param now - 当前时间（毫秒），注入便于测试
 * @returns 排好序的新数组
 */
export function paintDrawerRows(
  current: SessionView | undefined,
  cached: readonly SessionView[],
  now: number = Date.now(),
  pinnedIds?: ReadonlySet<string>,
): SessionView[] {
  if (current === undefined) return orderDrawerRows(cached, undefined, pinnedIds)
  const rest = cached.filter(row => row.sessionId !== current.sessionId)
  const known = cached.find(row => row.sessionId === current.sessionId)
  const pinned = current.updatedAt > 0
    ? current
    : { ...current, updatedAt: known !== undefined && known.updatedAt > 0 ? known.updatedAt : now }
  return orderDrawerRows([pinned, ...rest], current.sessionId, pinnedIds)
}

/**
 * 按 `mobile.runningSessions` 的权威集合重设每一行的运行状态。
 *
 * 为什么需要（2026-11-12 用户：「运行状态更新太慢，有时从完成跳成运行中，
 * 有时跑了好久侧边栏才出现运行中」）：
 *
 * 抽屉的行来自 `session.list`，它每行自带一个 `running` 字段 —— 而那个字段**会撒谎**。
 * 本项目自己的 `data/reload-tail.ts` 里早就写过这件事，并且因此改用 `runningSessions`：
 *
 *     // 3. 问 `runningSessions` 而不是 `session.list` 行上的 running（实测列表行会撒谎）；
 *
 * 抽屉这里没跟上：首屏用本地缓存（上次落盘的 running，可能早就过期）先画一帧，
 * 然后等那一次 `session.list` 覆盖 —— 于是先显示"完成"、再跳成"运行中"；
 * 会话刚开跑时列表还没更新，就表现成"跑了好久才出现运行中"。
 *
 * 这里把运行状态统一交给 `runningSessions` 的集合来定，列表行只提供标题/时间。
 *
 * @param rows - 当前抽屉行
 * @param runningIds - 权威的在跑会话 id 集合
 * @returns 新数组；内容没有变化时**返回原数组**（避免无意义的整层重渲染）
 */
export function applyRunningState(
  rows: readonly SessionView[],
  runningIds: Iterable<string>,
): SessionView[] {
  const running = new Set([...runningIds].map(id => String(id)))
  let changed = false
  const next = rows.map((row) => {
    const shouldRun = running.has(String(row.sessionId))
    if (row.running === shouldRun) return row
    changed = true
    return { ...row, running: shouldRun }
  })
  return changed ? next : (rows as SessionView[])
}

/**
 * 只把集合里的行置成「在跑」，**不撤销**别的行。
 *
 * 用于打开抽屉的第一帧：这时手里只有本地缓存行（running 是上次落盘的旧值）和一份
 * 内存镜像（帧即时、探针经复核）。用 {@link applyRunningState} 那种"全量重设"会在
 * 镜像还冷的时候把所有行一次性判成收工 —— 又是一次可见跳变；只升不降则只补上已知
 * 在跑的，撤销交给 turn/end 帧与复核后的集合。
 *
 * @param rows - 当前抽屉行
 * @param runningIds - 镜像里在跑的会话 id
 * @returns 新数组；没有行被点亮时返回原数组
 */
export function promoteRunning(
  rows: readonly SessionView[],
  runningIds: Iterable<string>,
): SessionView[] {
  const running = new Set([...runningIds].map(id => String(id)))
  if (running.size === 0) return rows as SessionView[]
  let changed = false
  const next = rows.map((row) => {
    if (row.running || !running.has(String(row.sessionId))) return row
    changed = true
    return { ...row, running: true }
  })
  return changed ? next : (rows as SessionView[])
}

/**
 * 抽屉「任务」入口的小字：「3 在跑 · 1 刚完成」。
 *
 * 两个数都与「任务」页同口径：在跑数取 `mobile.runningSessions` 的全局集合（抽屉只画
 * 当前工作区，不能再从行里数）；刚完成数取宿主收工账本，只留 24 小时内、且此刻不在跑的。
 * 以前入口写「N 条」= 在跑 + 手机本地账本（7 天、跨工作区），与任务页对不上 ——
 * 真机现象就是「3 个在跑，入口却写 4 条」。
 *
 * @param sessionIds - 权威的在跑会话 id 集合
 * @param finished - 宿主的收工账本（累积文件）
 * @param now - 当前时间（毫秒），注入便于测试
 * @returns 入口小字；两个数都是 0 时 undefined（行照画 —— 抽屉把它兜底成「空闲」，
 *          2026-11-14 用户：任务入口要固定显示，不能"有任务才出现"）
 */
export function taskLabelOf(
  sessionIds: Iterable<string>,
  finished: readonly { sessionId: string; finishedAt: number }[],
  now: number = Date.now(),
): string | undefined {
  const live = new Set([...sessionIds].map(String))
  const done = new Set(finished
    .filter(run => !live.has(String(run.sessionId)) && now - run.finishedAt < 86_400_000)
    .map(run => String(run.sessionId))).size
  return live.size + done === 0 ? undefined : [live.size === 0 ? '' : `${live.size} 在跑`, done === 0 ? '' : `${done} 刚完成`].filter(Boolean).join(' · ')
}

/**
 * 两批会话行是不是"画出来一样"。
 *
 * 2026-11-15：打开抽屉是"先画本地缓存行、再让 session.list 的一页覆盖"。覆盖那步以前
 * 无条件造新数组，于是抽屉刚滑上来就**又整块重渲染一次**，手机上就是"点一下卡两下"。
 * 内容没变时保持原引用，React 连 diff 都不用做。
 *
 * @param a - 现在画着的行
 * @param b - 即将画的行
 * @returns 逐行逐字段都相同则为 true
 */
export function sameDrawerRows(a: readonly SessionView[], b: readonly SessionView[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index]
    const right = b[index]
    if (left === right) continue
    if (left === undefined || right === undefined) return false
    if (left.sessionId !== right.sessionId) return false
    if (left.title !== right.title) return false
    if (left.updatedAt !== right.updatedAt) return false
    if (left.running !== right.running) return false
    if (left.blank !== right.blank) return false
    if (left.preview !== right.preview) return false
    if (left.turns !== right.turns) return false
    if (left.error !== right.error) return false
  }
  return true
}
