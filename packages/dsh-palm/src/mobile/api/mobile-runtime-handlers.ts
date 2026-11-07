/**
 * `mobile.*` 里轮次大纲与性能抓取处理器（P2：逐方法外移）。
 *
 * - `turnOutline`：轮次大纲两个来源按可靠度排——枚举快照 → 现读一次宿主投影；
 * - `perf`：只写、惰性、无路径的性能抓取落盘（手机只能往抓取目录追加）。
 *
 * @module dsh-palm/mobile/api/mobile-runtime-handlers
 */
import type { ServerResponse } from 'node:http'
import { basename } from 'node:path'
import { RpcId } from '../../api-proxy-types.ts'
import { writeJson } from '../../http.ts'
import {
  perfCaptureKind,
  validatePerfCapture,
  writePerfCapture,
} from '../../host/perf-capture.ts'
import { processState } from './process-state.ts'

/** 轮次大纲处理器上下文。 */
export interface TurnOutlineContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
  apiProxy: { sessions: { history: (request: never) => Promise<{ result: { ok: boolean; value?: unknown } }> } }
}

/**
 * 轮次大纲。
 *
 * 只信枚举快照是不够的：那一页是"最近更新的 N 个会话"，打开一个很久以前的
 * 会话时它根本不在里面，手机端就只剩本地已加载的那几轮——真机表现是
 * 「轮次 · 共 5 轮」，滑条分母 549 却一格历史都点不开。
 */
export async function mobileTurnOutline(ctx: TurnOutlineContext): Promise<void> {
  const { res, parsed, rpcId, apiProxy } = ctx
  const body = parsed.payload as { sessionId?: unknown } | undefined
  const sessionId = typeof body?.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : ''
  if (sessionId === '') {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'bad-request', message: '缺少会话 id' } },
    })
    return
  }
  let outline: unknown = processState.sessionProjectionSnapshots.get(sessionId)?.block.values?.['turnOutline']
  if (!Array.isArray(outline)) {
    // 现开一帧 follow，从 session.history 的投影基线里取。这条比枚举快照贵
    // （大会话实测 279 轮约 53 KB），但客户端有五分钟缓存，一次打开只付一次；
    // 总比"历史永远列不出来"强。
    try {
      const page = await apiProxy.sessions.history({
        rpcId: RpcId('dsh-palm-mobile-outline'),
        payload: { sessionId, maxMessages: 1, fresh: true },
      } as never)
      if (page.result.ok) {
        const values = (page.result.value as { projections?: { values?: Record<string, unknown> } })
          .projections?.values
        if (Array.isArray(values?.['turnOutline'])) outline = values['turnOutline']
      }
    } catch { /* 拿不到就维持原样，界面显示本地那几轮 */ }
  }
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: { ok: true, value: { turns: outline === undefined ? null : outline } },
  })
}

/** 性能抓取处理器上下文。 */
export interface PerfContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
  deps: { perfDir?: string }
}

/**
 * 落盘一次性能抓取。
 *
 * 只写、惰性、无路径：文件名由宿主用时钟 + 清洗过的标签生成，正文必须长得像
 * 性能聚合，这一段分支里读不到也改不了任何别的东西——手机只能往抓取目录追加。
 */
export async function mobilePerf(ctx: PerfContext): Promise<void> {
  const { res, parsed, rpcId, deps } = ctx
  const payload = parsed.payload as { capture?: unknown; label?: unknown }
  const rejection = validatePerfCapture(payload?.capture)
  if (rejection !== undefined) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'bad-request', message: rejection } },
    })
    return
  }
  if (deps.perfDir === undefined) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'unavailable', message: '宿主未启用性能抓取目录' } },
    })
    return
  }
  try {
    const file = writePerfCapture(
      deps.perfDir,
      payload.capture,
      typeof payload.label === 'string' ? payload.label : 'device',
      Date.now(),
      perfCaptureKind(payload.capture) === 'raw' ? 'raw' : 'aggregate',
    )
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: true, value: { file: basename(file), bytes: Buffer.byteLength(JSON.stringify(payload.capture)) } },
    })
  } catch (error) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : '写入性能抓取失败' } },
    })
  }
}
