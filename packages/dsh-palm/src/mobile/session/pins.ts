/**
 * 置顶：会话与工作区。
 *
 * ## 存在哪
 *
 * localStorage。理由：置顶是**本机偏好**，不是会话内容 —— 桌面端没有这个概念，
 * 写进宿主会让「手机上钉的」跑到别的设备上。两份清单各自一个 key，读到坏数据
 * 当空处理（不抛、不静默清空用户数据）。
 *
 * ## 为什么不复用 `pinnedSessionId`
 *
 * `drawer-rows.ts` 里那个 `pinnedSessionId` 是「**当前打开的这个会话**钉第一行」，
 * 由调用方按当前路由算出来，不是用户的选择。本模块管的是**用户主动钉的**，
 * 可以有多个，且跨会话重启保留。两者叠在一起：用户钉的排最前，当前会话其次。
 *
 * @module dsh-palm/mobile/session/pins
 */

const SESSIONS_KEY = 'dsh.palm.pinnedSessions'
const WORKSPACES_KEY = 'dsh.palm.pinnedWorkspaces'

function read(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item !== '')
  } catch {
    // 坏数据当没有：宁可丢了置顶，也不要让抽屉打不开。
    return []
  }
}

function write(key: string, values: readonly string[]): void {
  try {
    if (values.length === 0) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(values))
  } catch {
    // 隐私模式/配额满：置顶不生效，但不该影响别的。
  }
}

/** 用户主动置顶的会话 id。 */
export function loadPinnedSessions(): Set<string> {
  return new Set(read(SESSIONS_KEY))
}

/** 用户主动置顶的工作区（按 cwd 的 pathKey）。 */
export function loadPinnedWorkspaces(): Set<string> {
  return new Set(read(WORKSPACES_KEY))
}

/**
 * 切换一个会话的置顶状态。
 *
 * @returns 切换后是否**处于**置顶状态（true = 刚钉上）
 */
export function togglePinnedSession(sessionId: string): boolean {
  const current = read(SESSIONS_KEY)
  const pinned = !current.includes(sessionId)
  write(SESSIONS_KEY, pinned ? [sessionId, ...current] : current.filter(id => id !== sessionId))
  return pinned
}

/**
 * 切换一个工作区的置顶状态。
 *
 * @param key - 工作区标识（与 `drawer-rows.pathKey` 同口径）
 * @returns 切换后是否处于置顶状态
 */
export function togglePinnedWorkspace(key: string): boolean {
  const current = read(WORKSPACES_KEY)
  const pinned = !current.includes(key)
  write(WORKSPACES_KEY, pinned ? [key, ...current] : current.filter(item => item !== key))
  return pinned
}

/** 测试用：清空两份清单。 */
export function clearPinsForTest(): void {
  try {
    localStorage.removeItem(SESSIONS_KEY)
    localStorage.removeItem(WORKSPACES_KEY)
  } catch {
    // ignore
  }
}
