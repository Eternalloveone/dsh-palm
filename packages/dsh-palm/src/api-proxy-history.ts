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
 */

import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import type {
  SessionFollowFrame,
  SessionProjectionBaseline,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type { HistoryEntry, SessionProjectionsBlock, SessionId, SessionEvent } from './api-proxy-types.ts'

/** 每会话 follow 打开帧缓存条目。 */
interface FollowMeta {
  /** Inclusive 日志游标（page 的 throughSeq）。 */
  throughSeq: number
  /** 打开帧的投影基线（history 的 projections 来源）。 */
  projections?: SessionProjectionBaseline
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
   * 读一页历史（tail 或 beforeSeq 页）。首次调用开一条 follow 取 throughSeq +
   * projections 并缓存；后续调用用缓存游标调 page。
   */
  async page(
    request: { sessionId: string; beforeSeq?: number; maxMessages?: number },
    signal?: AbortSignal,
  ): Promise<HistoryPage> {
    const sessionId = request.sessionId
    const meta = await this.meta(sessionId, signal)
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

  /** 取（或开 follow 取）会话的 throughSeq + projections。 */
  private async meta(sessionId: string, signal?: AbortSignal): Promise<FollowMeta> {
    const cached = this.cache.get(sessionId)
    if (cached !== undefined) return cached
    const inflight = this.inflight.get(sessionId)
    if (inflight !== undefined) return inflight
    const promise = (async (): Promise<FollowMeta> => {
      const frames = this.session.follow(
        { address: { kind: 'session', sessionId: sessionId as never } },
        signal ?? new AbortController().signal,
      )
      for await (const frame of frames) {
        if (frame.type === 'snapshot') {
          const meta: FollowMeta = { throughSeq: frame.cursor, projections: frame.projections }
          this.cache.set(sessionId, meta)
          return meta
        }
      }
      throw new Error(`session.follow for ${sessionId} produced no snapshot`)
    })().finally(() => { this.inflight.delete(sessionId) })
    this.inflight.set(sessionId, promise)
    return promise
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
