/**
 * `mobile.finishedRuns` 的实现（P2：整方法外移）。
 *
 * 「刚结束」账本：读 / 追加 / 清空 / 删除已看。文件跟着 `perfDir` 走，
 * 客户端不传任何路径。`remove` 就是「只保留没点进去看过的」的实现。
 *
 * @module dsh-palm/mobile/api/mobile-finished-runs
 */
import type { ServerResponse } from 'node:http'
import { writeJson } from '../../http.ts'
import { mergeFinishedRuns, readFinishedRuns, writeFinishedRuns } from '../../host/finished-runs.ts'
import type { FinishedRunEntry } from '../../host/finished-runs.ts'
import { processState } from './process-state.ts'

/** 处理器上下文。 */
export interface FinishedRunsContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
}

/** 读 / 追加 / 清空 / 删除已看的「刚结束」账本。 */
export function mobileFinishedRuns(ctx: FinishedRunsContext): void {
  const { res, parsed, rpcId } = ctx
  const body = parsed.payload as { op?: unknown; entries?: unknown; sessionIds?: unknown } | undefined
  const op = body?.op
  const file = processState.finishedRunsFile
  try {
    if (op === 'read') {
      writeJson(res, 200, {
        type: 'server-response',
        rpcId,
        result: { ok: true, value: { entries: readFinishedRuns(file, Date.now()) } },
      })
      return
    }
    if (op === 'clear') {
      writeFinishedRuns(file, [])
      writeJson(res, 200, { type: 'server-response', rpcId, result: { ok: true, value: { accepted: true } } })
      return
    }
    if (op === 'remove') {
      // 打开过就删：这就是「只保留没点进去看过的」的实现。
      const ids = Array.isArray(body?.sessionIds)
        ? body.sessionIds.filter((id): id is string => typeof id === 'string')
        : []
      const now = Date.now()
      const kept = readFinishedRuns(file, now).filter(entry => !ids.includes(entry.sessionId))
      writeFinishedRuns(file, kept)
      writeJson(res, 200, {
        type: 'server-response',
        rpcId,
        result: { ok: true, value: { entries: kept } },
      })
      return
    }
    if (op === 'append') {
      const incoming = Array.isArray(body?.entries) ? body.entries : []
      const now = Date.now()
      const merged = mergeFinishedRuns(readFinishedRuns(file, now), incoming as FinishedRunEntry[], now)
      writeFinishedRuns(file, merged)
      writeJson(res, 200, {
        type: 'server-response',
        rpcId,
        result: { ok: true, value: { entries: merged } },
      })
      return
    }
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'bad-request', message: '未知的账本操作' } },
    })
  } catch (error) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'unavailable', message: String(error) } },
    })
  }
}
