/**
 * 搜索页的数据适配（App 注入给 `SearchView` 的那个 `search` 函数）。
 *
 * 为什么单独一层而不是继续堆在 App 里：
 * - App 已经是页面栈/实时帧/收工通知的协调器，检索的「索引→旧入口兜底」属于
 *   数据口径，放在这里更容易单独读；
 * - 视图本身仍然不 import api.ts / mux.ts —— 这一层是 App 侧的取数实现。
 *
 * 不新造 RPC：宿主索引 `mobile.search` 为主，索引没建好（`fallback: true`）
 * 才退回归入口 `mobile.searchAll`，与工作区首页的搜索完全同一条链路。
 *
 * @module dsh-palm/mobile/views/search-request
 */
import { searchAll, searchSessions } from '../data/session.ts'
import { loadPersistedList } from '../session/list-persist.ts'
import type { SearchHit, SearchPage } from './SearchView.tsx'

/** 宿主检索命中的最小公共形状（索引路径 / 旧入口两种载荷都满足）。 */
type SearchHitPayload = {
  kind: 'title' | 'message'
  sessionId: string
  title?: string
  snippet?: string
  seq?: number
  messageId?: string
  partId?: string
  /** 结构坐标（图谱寻址）：第几轮 / 第几步。 */
  turn?: number
  step?: number
  workspaceId?: string
  workspaceTitle?: string
  hits?: number
}

/**
 * 给一条宿主命中补「展示所需的本地信息」：标题与会话时间。
 *
 * 宿主的搜索载荷只保证「命中文本 + 会话 id」，不保证标题/时间；而这两样
 * 会话列表的持久化缓存里已经有 —— 顺手查一次缓存（同步、零 RPC），查不到
 * 就不显示，绝不猜一个时间出来。
 */
function withSearchMeta(item: SearchHitPayload): SearchHit {
  const workspaceId = item.workspaceId
  const row = workspaceId === undefined || workspaceId === ''
    ? undefined
    : loadPersistedList(workspaceId)?.rows.find(candidate => String(candidate.sessionId) === item.sessionId)
  const title = item.title !== undefined && item.title !== '' ? item.title : row?.title
  return {
    ...item,
    ...(title === undefined || title === '' ? {} : { title }),
    ...(row !== undefined && Number.isFinite(row.updatedAt) ? { updatedAt: row.updatedAt } : {}),
  }
}

/**
 * 一次跨会话检索：宿主索引优先，索引没建好就退回旧入口。
 *
 * @param term - 已 trim 的关键词
 * @param signal - 新词输入时由 SearchView 中断上一次请求
 * @returns 搜索页认识的统一结果（命中列表 + 是否只扫了最近一段）
 */
export async function searchPageFor(term: string, signal?: AbortSignal): Promise<SearchPage> {
  const indexed = await searchSessions({ query: term, perSession: 2, sessions: 12 }, signal)
  if (indexed.fallback === true) {
    const legacy = await searchAll(term)
    return {
      items: legacy.items.map(withSearchMeta),
      hasMore: legacy.hasMore,
      partial: legacy.partial === true,
    }
  }
  return {
    items: indexed.items.map(withSearchMeta),
    hasMore: indexed.hasMore,
    partial: false,
  }
}
