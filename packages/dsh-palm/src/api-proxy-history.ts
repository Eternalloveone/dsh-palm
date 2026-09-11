/**
 * session.history → session.page 适配。
 *
 * 0.1.5-rc.1 里 `session.history` 改名 `session.page`，且新增必填 `address`
 * （`SessionAddress`）与 `throughSeq`（inclusive 日志游标，从 `session.follow`
 * 打开帧取得）。返回从 `{ events: HistoryEntry[] }` 改为 `{ records: SessionHistoryRecord[] }`
 * （`{ type: 'event', event }`），`view` 渲染意图已移除。
 *
 * 本模块维护每会话的 follow 打开帧缓存（throughSeq + projections），使 dsh-palm
 * 的 history 调用点（chat-window、preview-cache、searchDocument、dispatch）零改动。
 *
 * 游标语义（2026-09-11 修复「手机端丢消息/不跟桌面同步」）：
 * `throughSeq` 是**上界**——宿主 `paginate` 用 `min(throughSeq + 1, …)` 收尾
 * （session-controller/src/history.ts:390），而它按定义只在 follow 打开的那一瞬间
 * 有效（types.ts:442「Inclusive log cut obtained from the corresponding follow
 * opening frame」）。旧实现把首个打开帧的游标**按会话永久缓存**，于是首次读之后
 * 的每一次分页都被钉死在那根旧游标上：手机端的轮询兜底、会话列表预览、冷装窗
 * 全部看不到新事件，只有重启 dsh 才会恢复。
 *
 * 现在游标+投影按 TTL（{@link META_TTL_MS}）复用，并提供 `fresh` 强制重取：
 * 冷装窗（窗口内容必须完整）与水位自愈（把落后窗口补齐）走 fresh，
 * 高频路径（轮询、预览、搜索）走 TTL 内复用，避免每次读都重开 follow。
 */

import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import type {
  SessionFollowFrame,
  SessionProjectionBaseline,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type { HistoryEntry, SessionProjectionsBlock, SessionId, SessionEvent } from './api-proxy-types.ts'

/** 游标+投影缓存的最长复用时长（毫秒）；超过即重开 follow 取当前游标。 */
export const META_TTL_MS = 1000

/** 缓存条目上限（会话被删除后不会主动 clear，靠 LRU 兜底防无界增长）。 */
export const META_CACHE_LIMIT = 200

/** 每会话 follow 打开帧缓存条目。 */
interface FollowMeta {
  /** Inclusive 日志游标（page 的 throughSeq）。 */
  throughSeq: number
  /** 打开帧的投影基线（history 的 projections 来源）。 */
  projections?: SessionProjectionBaseline
  /** 取到该游标的时刻（TTL 判定）。 */
  at: number
}

/** 一次 history 读的请求（`fresh` 为宿主内部字段，手机端不传）。 */
export interface HistoryPageRequest {
  sessionId: string
  beforeSeq?: number
  maxMessages?: number
  /** 绕过 TTL 重新取当前游标：冷装窗与水位自愈用，保证读到的是日志末尾。 */
  fresh?: boolean
}

/** 一次 history 读的返回（旧形状）。 */
export interface HistoryPage {
  events: HistoryEntry[]
  hasMore: boolean
  projections?: SessionProjectionsBlock
}

/**
 * session.history → session.page 适配器。缓存随插件生命周期维护。
 */
export class HistoryAdapter {
  private readonly cache = new Map<string, FollowMeta>()
  private readonly inflight = new Map<string, Promise<FollowMeta>>()

  constructor(private readonly session: SessionController) {}

  /**
   * 读一页历史（tail 或 beforeSeq 页）。游标来自 follow 打开帧：TTL 内复用，
   * `fresh` 或 TTL 过期则重开一条 follow 取当前游标（取到即关，不留长流）。
   */
  async page(
    request: HistoryPageRequest,
    signal?: AbortSignal,
  ): Promise<HistoryPage> {
    const sessionId = request.sessionId
    const meta = await this.meta(sessionId, signal, request.fresh === true)
    const page = await this.session.page(
      {
        address: { kind: 'session', sessionId: sessionId as never },
        throughSeq: meta.throughSeq,
        ...(request.beforeSeq === undefined ? {} : { beforeSeq: request.beforeSeq }),
        ...(request.maxMessages === undefined ? {} : { maxMessages: request.maxMessages }),
      },
      signal ?? new AbortController().signal,
    )
    const events: HistoryEntry[] = page.records.map(record => ({ event: record.event as unknown as SessionEvent, view: undefined }))
    return {
      events,
      hasMore: page.hasMore,
      ...(meta.projections === undefined ? {} : { projections: toProjectionsBlock(meta.projections) }),
    }
  }

  /**
   * 取会话当前的 throughSeq + projections。TTL 内直接复用；`fresh` 或过期时
   * 重开 follow 并只消费打开帧（随即关闭，不会留下长驻流）。同一会话的并发
   * 请求共享一个 in-flight promise，避免同时开多条 follow。
   */
  private async meta(sessionId: string, signal?: AbortSignal, fresh = false): Promise<FollowMeta> {
    const cached = this.cache.get(sessionId)
    if (!fresh && cached !== undefined && Date.now() - cached.at < META_TTL_MS) return cached
    const inflight = this.inflight.get(sessionId)
    if (inflight !== undefined) return inflight
    const promise = (async (): Promise<FollowMeta> => {
      const frames = this.session.follow(
        { address: { kind: 'session', sessionId: sessionId as never } },
        signal ?? new AbortController().signal,
      )
      for await (const frame of frames) {
        if (frame.type === 'snapshot') {
          const meta: FollowMeta = { throughSeq: frame.cursor, projections: frame.projections, at: Date.now() }
          this.cache.set(sessionId, meta)
          this.prune()
          return meta
        }
      }
      throw new Error(`session.follow for ${sessionId} produced no snapshot`)
    })().finally(() => { this.inflight.delete(sessionId) })
    this.inflight.set(sessionId, promise)
    return promise
  }

  /** 缓存超过上限时按最久未刷新淘汰。 */
  private prune(): void {
    if (this.cache.size <= META_CACHE_LIMIT) return
    const overflow = this.cache.size - META_CACHE_LIMIT
    const oldest = [...this.cache.entries()].sort((left, right) => left[1].at - right[1].at).slice(0, overflow)
    for (const [id] of oldest) this.cache.delete(id)
  }

  /** 丢弃一个会话的缓存（会话删除/驱逐时）。 */
  clear(sessionId: string): void {
    this.cache.delete(sessionId)
  }

  /** 清空全部缓存（插件 dispose）。 */
  clearAll(): void {
    this.cache.clear()
    this.inflight.clear()
  }
}

/** 把新 SessionProjectionBaseline 映射回旧 SessionProjectionsBlock。 */
function toProjectionsBlock(baseline: SessionProjectionBaseline): SessionProjectionsBlock {
  return { asOfSeq: baseline.asOfSeq, values: baseline.values as Record<string, unknown> }
}

/** 供测试/诊断：当前缓存的会话数。 */
export function historyCacheSize(adapter: HistoryAdapter): number {
  return adapter['cache'].size
}

/** 供测试/诊断：一个会话缓存的游标（未缓存返回 undefined）。 */
export function historyCachedCursor(adapter: HistoryAdapter, sessionId: string): number | undefined {
  return adapter['cache'].get(sessionId)?.throughSeq
}

/** 类型再导出：调用点（adapter 层）沿用的 follow 帧类型。 */
export type { SessionFollowFrame }
