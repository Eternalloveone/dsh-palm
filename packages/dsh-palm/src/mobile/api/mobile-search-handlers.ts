/**
 * `mobile.*` 里的会话内定位与错误上报（P2：逐方法外移）。
 *
 * - `searchMessages`：一次索引查询拿到命中行（旧实现要翻到这个会话最底部才能确定 seq）；
 * - `error`：只写、惰性、无路径的错误上报落盘，指纹首次出现时推送一次。
 *
 * @module dsh-palm/mobile/api/mobile-search-handlers
 */
import type { ServerResponse } from 'node:http'
import { basename } from 'node:path'
import { writeJson } from '../../http.ts'
import { ingestErrorReport, validateErrorReport } from '../../host/error-report.ts'
import { SEARCH_MESSAGES_LIMIT } from './constants.ts'

/** 索引命中行（只声明本域读到的字段）。 */
interface SearchHit {
  seq: number
  messageId?: string
  partId?: string
  snippet: string
  paragraph?: number
  matchIndex?: number
}

/** 搜索索引里本域用到的最小面。 */
interface SearchIndexLike {
  query: (term: string, options: { sessionId: string; limit: number }) => SearchHit[]
}

/** 会话内定位处理器上下文。 */
export interface SearchMessagesContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
  /** 惰性拿到搜索索引；索引不可用时返回 undefined。 */
  ensureSearchIndex: () => Promise<unknown>
}

/** 在一个会话内定位关键词，返回带 seq 的命中行。 */
export async function mobileSearchMessages(ctx: SearchMessagesContext): Promise<void> {
  const { res, parsed, rpcId, ensureSearchIndex } = ctx
  const body = parsed.payload as { sessionId?: unknown; query?: unknown } | undefined
  const sessionId = typeof body?.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : ''
  const query = typeof body?.query === 'string' ? body.query.trim() : ''
  if (sessionId === '' || query === '') {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'bad-request', message: '缺少会话或搜索词' } },
    })
    return
  }
  try {
    const index = (await ensureSearchIndex()) as SearchIndexLike | undefined
    const hits = index === undefined ? [] : index.query(query, { sessionId, limit: SEARCH_MESSAGES_LIMIT })
    const items = hits.map(hit => ({
      seq: hit.seq,
      ...(hit.messageId === undefined ? {} : { messageId: hit.messageId }),
      ...(hit.partId === undefined ? {} : { partId: hit.partId }),
      snippet: hit.snippet,
      ...(hit.paragraph === undefined ? {} : { paragraph: hit.paragraph }),
      ...(hit.matchIndex === undefined ? {} : { matchIndex: hit.matchIndex }),
    }))
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: true, value: { items } },
    })
  } catch (error) {
    console.error('mobile.searchMessages failed', error)
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'internal', message: '消息定位失败，请稍后重试' } },
    })
  }
}

/** 错误上报处理器上下文。 */
export interface ErrorReportContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
  deps: unknown
}

/**
 * 手机端错误上报。
 *
 * 与 `mobile.perf` 同一条安全线：只写、惰性、无路径。文件名由宿主用时钟 +
 * 指纹生成，正文必须过严格形状校验（连帧里的 basename 都校验——出现路径分隔符
 * 直接拒绝），这一段里读不到也改不了任何别的东西。指纹首次出现时推送一次
 * （受冷却约束）；没有通知能力时只写盘并返回，绝不报错。
 */
export async function mobileError(ctx: ErrorReportContext): Promise<void> {
  const { res, parsed, rpcId } = ctx
  const deps = ctx.deps as { errorDir?: string; notify?: unknown }
  const payload = parsed.payload as { report?: unknown; label?: unknown }
  const rejection = validateErrorReport(payload?.report)
  if (rejection !== undefined) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'bad-request', message: rejection } },
    })
    return
  }
  if (deps.errorDir === undefined) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'unavailable', message: '宿主未启用错误上报目录' } },
    })
    return
  }
  try {
    const result = ingestErrorReport({
      dir: deps.errorDir,
      report: payload?.report,
      notify: deps.notify,
      now: Date.now(),
    } as never)
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: true, value: { file: basename(result.file), bytes: result.bytes, pushed: result.pushed } },
    })
  } catch (error) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : '写入错误上报失败' } },
    })
  }
}
