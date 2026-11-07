/**
 * `mobile.*` 里的批量预览与斜杠命令执行（P2：逐方法外移）。
 *
 * - `previews`：列表页一次拿一批"最后一条消息"摘要，命中宿主 mux 缓存的行零日志读取，
 *   冷行各读一次尾部；读不到的会话回空摘要（该行回落到统计行），**不是错误**。
 * - `commandExec`：把一行斜杠命令交给宿主的 CommandRuntime，与桌面输入框走同一套拦截。
 *   `session.prompt` 从不派发命令，所以这是手机上唯一不会把 `/` 开头的行漏给模型的通道。
 *
 * @module dsh-palm/mobile/api/mobile-action-handlers
 */
import type { ServerResponse } from 'node:http'
import { writeJson } from '../../http.ts'
import { PREVIEWS_MAX_SESSIONS } from '../../preview-cache.ts'

/** 批量预览处理器上下文。 */
export interface PreviewsContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
  deps: { previews?: { previews: (sessionIds: string[]) => Promise<unknown[]> } }
}

/** 批量取会话的最后一条消息摘要。 */
export async function mobilePreviews(ctx: PreviewsContext): Promise<void> {
  const { res, parsed, rpcId } = ctx
  const previews = ctx.deps.previews
  if (previews === undefined) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'unavailable', message: '预览服务不可用' } },
    })
    return
  }
  const body = parsed.payload as { sessionIds?: unknown } | undefined
  const rawIds = Array.isArray(body?.sessionIds) ? body.sessionIds : []
  const sessionIds = rawIds
    .filter((id): id is string => typeof id === 'string' && id !== '')
    .slice(0, PREVIEWS_MAX_SESSIONS)
  if (sessionIds.length === 0) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: true, value: { items: [] } },
    })
    return
  }
  try {
    const items = await previews.previews(sessionIds)
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: true, value: { items } },
    })
  } catch (error) {
    console.error('mobile.previews failed', error)
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'internal', message: '预览读取失败，请稍后重试' } },
    })
  }
}

/** 命令执行处理器上下文。 */
export interface CommandExecContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
  deps: unknown
}

/**
 * 执行一行斜杠命令。
 *
 * 像 `/compact` 这种长命令要经模型总结，所以应答跟着手机一起等：
 * 请求中断（设备中途离开）会取消宿主侧处理器的信号。
 */
export async function mobileCommandExec(ctx: CommandExecContext): Promise<void> {
  const { res, parsed, rpcId } = ctx
  const deps = ctx.deps as {
    commands?: {
      execute: (
        agent: unknown,
        line: string,
        args: unknown[],
        signal: AbortSignal,
      ) => Promise<{ commandId: string; result: { kind: string; text?: string } }>
    }
    agents?: { get: (sessionId: string) => unknown }
  }
  const body = parsed.payload as { sessionId?: unknown; line?: unknown } | undefined
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined
  const line = typeof body?.line === 'string' ? body.line : undefined
  const abort = new AbortController()
  res.on('close', () => { if (!res.writableEnded) abort.abort() })
  let execution: { commandId: string; result: { kind: string; text?: string } } | undefined
  try {
    const agent = sessionId === undefined || deps.agents === undefined
      ? undefined
      : deps.agents.get(sessionId)
    execution = agent === undefined || deps.commands === undefined || line === undefined
      ? undefined
      : await deps.commands.execute(agent, line, [], abort.signal)
  } catch (error) {
    // 设备中断或处理器崩溃：生命周期宿主侧已经记过账，手机只需要一个终态应答。
    // 宿主的错误信息属于内部细节，绝不回传给手机。
    console.error('mobile.commandExec failed', error)
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: {
        ok: false,
        error: { code: 'command-failed', message: '命令执行失败，请稍后重试' },
      },
    })
    return
  }
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: {
      ok: true,
      value: execution === undefined
        ? { matched: false }
        : { matched: true, kind: execution.result.kind, ...(execution.result.text !== undefined ? { text: execution.result.text } : {}) },
    },
  })
}
