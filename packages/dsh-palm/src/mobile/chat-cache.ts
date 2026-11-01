/**
 * 聊天页正文的**本地缓存**：刷新/重进时先画上次看到的内容。
 *
 * 为什么需要（用户原话，2026-11-01）："我的核心原则之一是让用户所见即所得，
 * 稳定可靠呈现每一项内容和配置。" 而当时的实际行为是：断网刷新聊天页，
 * 正文一个字都不剩，只有一句"无法连接到运行中的 DSH host。重试"。
 *
 * 设计取舍（都是踩过的坑）：
 *   · **只存最后一次渲染用的行**（不是整份历史）：进会话本来就是先看最后一屏，
 *     往里翻走的是网络分页，缓存帮不上也不该帮（存全量会撑爆 localStorage）。
 *   · **条数与字节双上限**：太长会把 localStorage 塞满，反过来影响草稿等更关键的键。
 *   · **TTL + LRU**：只保留最近访问过的若干个会话，旧的自动淘汰；过期的不再恢复
 *     （内容太旧会让人以为会话停在那儿了）。
 *   · **猜出来的卡不存**（`guessed`）：猜的卡内容可能不全，存下来下次会"内容对不上"。
 *   · 读出来的东西**一律当不可信数据**校验：字段类型不对、结构不认识的整条丢掉，
 *     宁可少一条，也不要把坏数据渲染成乱码。
 */

/** 一条缓存行就是渲染行本身（纯数据，可直接 JSON）。 */
export interface CachedRow {
  readonly id?: unknown
  readonly kind?: unknown
  [key: string]: unknown
}

const PREFIX = 'dsh-palm.chat-cache.v1.'
const INDEX_KEY = 'dsh-palm.chat-cache.v1.index'

/** 最多存多少行（最后一屏够用；太多了会挤爆 localStorage）。 */
export const CHAT_CACHE_MAX_ROWS = 80
/** 单条会话缓存的最大字节数。 */
export const CHAT_CACHE_MAX_BYTES = 220_000
/** 过期时间：7 天。 */
export const CHAT_CACHE_TTL_MS = 7 * 24 * 60 * 60_000
/** 最多保留多少个会话的缓存。 */
export const CHAT_CACHE_MAX_SESSIONS = 10

interface IndexEntry {
  readonly sessionId: string
  readonly at: number
}

function storage(): Storage | undefined {
  try {
    const candidate = globalThis.localStorage
    if (candidate === undefined || candidate === null) return undefined
    return candidate
  } catch {
    return undefined
  }
}

function readIndex(): IndexEntry[] {
  const store = storage()
  if (store === undefined) return []
  try {
    const raw = store.getItem(INDEX_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry): entry is IndexEntry => {
        if (typeof entry !== 'object' || entry === null) return false
        const record = entry as { sessionId?: unknown; at?: unknown }
        return typeof record.sessionId === 'string' && typeof record.at === 'number'
      })
      .slice(0, CHAT_CACHE_MAX_SESSIONS * 2)
  } catch {
    return []
  }
}

function writeIndex(entries: readonly IndexEntry[]): void {
  const store = storage()
  if (store === undefined) return
  try {
    store.setItem(INDEX_KEY, JSON.stringify(entries))
  } catch {
    // 配额满了：索引写不进去无所谓，正文缓存仍然可以按 key 直接读。
  }
}

function touchIndex(sessionId: string, at: number): void {
  const rest = readIndex().filter(entry => entry.sessionId !== sessionId)
  const next = [{ sessionId, at }, ...rest].slice(0, CHAT_CACHE_MAX_SESSIONS)
  // 超出配额的老会话：正文一起删掉，别留孤魂
  for (const dropped of rest.slice(CHAT_CACHE_MAX_SESSIONS - 1)) {
    const store = storage()
    try { store?.removeItem(PREFIX + dropped.sessionId) } catch { /* 忽略 */ }
  }
  writeIndex(next)
}

/** 存一页渲染行（调用方给的就是屏幕上正在显示的行）。 */
export function saveChatCache(sessionId: string, rows: readonly CachedRow[], now: number = Date.now()): void {
  const store = storage()
  if (sessionId === '' || store === undefined) return
  // 猜出来的卡不存：内容可能不全，存了下次会"对不上"
  const stable = rows.filter(row => row.guessed !== true).slice(-CHAT_CACHE_MAX_ROWS)
  if (stable.length === 0) return
  let payload = ''
  try {
    payload = JSON.stringify({ at: now, rows: stable })
  } catch {
    return
  }
  // 超字节上限就继续砍头部（保留最新的一屏）
  let kept = stable
  while (payload.length > CHAT_CACHE_MAX_BYTES && kept.length > 8) {
    kept = kept.slice(Math.ceil(kept.length / 8))
    try {
      payload = JSON.stringify({ at: now, rows: kept })
    } catch {
      return
    }
  }
  if (payload.length > CHAT_CACHE_MAX_BYTES) return
  try {
    store.setItem(PREFIX + sessionId, payload)
    touchIndex(sessionId, now)
  } catch {
    // 配额满：把最旧的删掉再试一次，仍失败就放弃（缓存不是关键路径）
    const entries = readIndex()
    const oldest = entries[entries.length - 1]
    if (oldest !== undefined) {
      try { store.removeItem(PREFIX + oldest.sessionId) } catch { /* 忽略 */ }
      writeIndex(entries.slice(0, -1))
    }
    try {
      store.setItem(PREFIX + sessionId, payload)
      touchIndex(sessionId, now)
    } catch { /* 放弃 */ }
  }
}

/** 读一页缓存；过期、坏数据、不认识的行一律不要。 */
export function loadChatCache(sessionId: string, now: number = Date.now()): CachedRow[] {
  const store = storage()
  if (sessionId === '' || store === undefined) return []
  let raw: string | null = null
  try {
    raw = store.getItem(PREFIX + sessionId)
  } catch {
    return []
  }
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return []
    const { at, rows } = parsed as { at?: unknown; rows?: unknown }
    if (typeof at !== 'number' || now - at > CHAT_CACHE_TTL_MS) {
      try { store.removeItem(PREFIX + sessionId) } catch { /* 忽略 */ }
      return []
    }
    if (!Array.isArray(rows)) return []
    return rows
      .filter((row): row is CachedRow => typeof row === 'object' && row !== null && typeof (row as CachedRow).id === 'string' && typeof (row as CachedRow).kind === 'string')
      .slice(-CHAT_CACHE_MAX_ROWS)
  } catch {
    return []
  }
}

/**
 * 本地有没有**任何**可用的聊天缓存。
 *
 * 宿主连不上时，App 外壳据此决定"要不要仍然进主界面"：
 * 有缓存就进去看上次的内容（WYSIWYG），没有才退回到那句"无法连接"。
 */
export function hasAnyChatCache(now: number = Date.now()): boolean {
  const store = storage()
  if (store === undefined) return false
  return readIndex().some(entry => now - entry.at <= CHAT_CACHE_TTL_MS)
}

/** 清掉某条会话的缓存（会话被删/归档时用）。 */
export function dropChatCache(sessionId: string): void {
  const store = storage()
  if (store === undefined) return
  try { store.removeItem(PREFIX + sessionId) } catch { /* 忽略 */ }
  writeIndex(readIndex().filter(entry => entry.sessionId !== sessionId))
}

/** 清掉所有聊天缓存（"清缓存"按钮用）。 */
export function dropAllChatCaches(): void {
  const store = storage()
  if (store === undefined) return
  for (const entry of readIndex()) {
    try { store.removeItem(PREFIX + entry.sessionId) } catch { /* 忽略 */ }
  }
  try { store.removeItem(INDEX_KEY) } catch { /* 忽略 */ }
}
