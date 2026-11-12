/**
 * `mobile.search` 的实现（P2：整方法外移）。
 *
 * 自建索引版搜索。索引还没建好（或 Node 不带 `node:sqlite`）时回 `fallback: true`，
 * 手机端据此退回旧的 `mobile.searchAll`——不会出现「索引没建完就搜不到」的空结果。
 *
 * 两条路径：
 * - 带 `sessionId`：会话内搜索，不分组，按命中顺序给位置列表（上一处/下一处靠它）；
 * - 不带：跨会话分组，每组给「最佳一条 + 全部命中」，并额外补标题命中。
 *
 * @module dsh-palm/mobile/api/mobile-search
 */
import type { ServerResponse } from 'node:http'
import { writeJson } from '../../http.ts'
import { CHAT_SEARCH_HITS } from './constants.ts'
import { ordinarySearchSnapshot } from './search-snapshot.ts'

/** 索引里本域用到的最小面。 */
interface SearchIndexView {
  stats: () => { docs: number }
  querySessionHits: (query: string, sessionId: string, limit: number) => SearchHitView[]
  queryGroupsDetailed: (
    query: string,
    options: { limits: number; sessions: number; offset: number },
  ) => {
    groups: Array<{ sessionId: string; hits: number; best: SearchHitView; messages: SearchHitView[] }>
    totalGroups: number
    hasMore: boolean
  }
  titleHits: (query: string, cap: number) => Array<{ sessionId: string; title: string }>
}

/** 一条命中。 */
interface SearchHitView {
  sessionId: string
  seq: number
  messageId: string
  partId?: string
  /** 结构坐标（图谱寻址）：第几轮 / 第几步。 */
  turn?: number
  step?: number
  snippet: string
  paragraph?: number
  matchIndex?: number
  ranges: unknown
  user: unknown
}

/** 处理器上下文。 */
export interface SearchContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
  apiProxy: unknown
  ensureSearchIndex: () => Promise<unknown>
}

/** 把一条命中展开成手机端的行字段（最佳一条与逐条命中共用）。 */
function hitFields(hit: SearchHitView): Record<string, unknown> {
  return {
    seq: hit.seq,
    messageId: hit.messageId,
    ...(hit.partId === undefined ? {} : { partId: hit.partId }),
    ...(hit.turn === undefined ? {} : { turn: hit.turn }),
    ...(hit.step === undefined ? {} : { step: hit.step }),
    snippet: hit.snippet,
    ...(hit.paragraph === undefined ? {} : { paragraph: hit.paragraph }),
    ...(hit.matchIndex === undefined ? {} : { matchIndex: hit.matchIndex }),
    ranges: hit.ranges,
    user: hit.user,
  }
}

/** 搜索：会话内命中位置，或跨会话分组。 */
export async function mobileSearch(ctx: SearchContext): Promise<void> {
  const { res, parsed, rpcId } = ctx
  const apiProxy = ctx.apiProxy as never
  const body = parsed.payload as
    | { query?: unknown; sessionId?: unknown; sessions?: unknown; perSession?: unknown; offset?: unknown }
    | undefined
  const query = typeof body?.query === 'string' ? body.query.trim() : ''
  if (query === '') {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'bad-request', message: '缺少搜索词' } },
    })
    return
  }
  const fallback = (): void => {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: true, value: { items: [], total: 0, hasMore: false, tookMs: 0, fallback: true } },
    })
  }
  try {
    const index = await ctx.ensureSearchIndex() as SearchIndexView | undefined
    if (index === undefined || index.stats().docs === 0) {
      fallback()
      return
    }
    const sessionId = typeof body?.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : undefined
    const clamp = (value: unknown, min: number, max: number, fallbackValue: number): number => {
      const parsedValue = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallbackValue
      return Math.min(Math.max(parsedValue, min), max)
    }
    const perSession = clamp(body?.perSession, 1, 5, 2)
    const sessionCap = clamp(body?.sessions, 5, 40, 12)
    const offset = clamp(body?.offset, 0, 200, 0)
    const started = performance.now()
    const snapshot = await ordinarySearchSnapshot(apiProxy)
    const workspaceOf = (id: string): Record<string, string> => {
      const workspaceId = snapshot.workspace.get(id)
      const workspaceTitle = snapshot.workspaceTitle.get(id)
      return {
        ...(workspaceId === undefined ? {} : { workspaceId }),
        ...(workspaceTitle === undefined ? {} : { workspaceTitle }),
      }
    }
    const items: Array<Record<string, unknown>> = []

    if (sessionId !== undefined) {
      // 会话内搜索：不分组，按命中顺序给位置列表（上一处/下一处靠它）。
      // 以前这里写死 50 条、hasMore 恒为 false：常用字在长会话里能有两三百处，
      // 客户端只看到 1/50，后面的一律点不到（真机实测某会话「的」722 处）。
      // 现在按 CHAT_SEARCH_HITS 取、多取一条判 hasMore，如实告诉客户端「还有」。
      const hits = index.querySessionHits(query, sessionId, CHAT_SEARCH_HITS + 1)
      const truncated = hits.length > CHAT_SEARCH_HITS
      const visible = truncated ? hits.slice(0, CHAT_SEARCH_HITS) : hits
      const tookMs = Math.round((performance.now() - started) * 10) / 10
      for (const hit of visible) {
        items.push({
          kind: 'message',
          sessionId: hit.sessionId,
          ...hitFields(hit),
        })
      }
      writeJson(res, 200, {
        type: 'server-response',
        rpcId,
        result: { ok: true, value: { items, total: items.length, hasMore: truncated, tookMs, source: 'index' } },
      })
      return
    }

    const page = index.queryGroupsDetailed(query, { limits: perSession, sessions: sessionCap, offset })
    const tookMs = Math.round((performance.now() - started) * 10) / 10
    const hasMore = page.hasMore
    const seen = new Set(page.groups.map(group => group.sessionId))
    // 标题命中只在第一页给（翻页时再塞一遍会让「加载更多」看起来没变化）；
    // 已经出现在消息命中里的会话不重复列。
    if (offset === 0) {
      for (const hit of index.titleHits(query, sessionCap)) {
        if (seen.has(hit.sessionId) || !snapshot.byId.has(hit.sessionId)) continue
        items.push({
          kind: 'title',
          sessionId: hit.sessionId,
          title: hit.title,
          hits: 0,
          ...workspaceOf(hit.sessionId),
        })
      }
    }
    for (const group of page.groups) {
      const meta = snapshot.byId.get(group.sessionId)
      // 花名册里没有的（子代理 / 已归档 / 已删除）一律不返回，和列表口径一致。
      if (meta === undefined) continue
      const best = group.best
      // 每条命中单独一行：手机端可以直接点「第 2 条」跳到那条，而不是只能跳到最佳那条。
      const messages = group.messages.map(hit => hitFields(hit))
      items.push({
        kind: 'message',
        sessionId: group.sessionId,
        ...(meta.title === undefined ? {} : { title: meta.title }),
        hits: group.hits,
        ...hitFields(best),
        messages,
        ...workspaceOf(group.sessionId),
      })
    }
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: {
        ok: true,
        value: { items, total: page.totalGroups, hasMore, nextOffset: offset + page.groups.length, tookMs, source: 'index' },
      },
    })
  } catch (error) {
    console.error('mobile.search failed', error)
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'internal', message: '搜索失败，请稍后重试' } },
    })
  }
}
