import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'api', 'mobile-handlers.ts')
let text = readFileSync(P, 'utf8')

text = text.replace(
  `export interface PendingContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
  deps: { pendingTracker: { pending: (sessionId?: never) => unknown } }
}`,
  `export interface PendingContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
  /** 依赖包整体按 unknown 收，内部再取需要的那一个能力。 */
  deps: unknown
}`,
)

text = text.replace(
  `export function mobilePending(ctx: PendingContext): void {
  const { res, parsed, rpcId, deps } = ctx
  const payload = parsed.payload as { sessionId?: unknown } | undefined
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: { ok: true, value: deps.pendingTracker.pending(payload?.sessionId) },
  })
}`,
  `export function mobilePending(ctx: PendingContext): void {
  const { res, parsed, rpcId } = ctx
  const deps = ctx.deps as { pendingTracker: { pending: (sessionId?: string) => unknown } }
  const payload = parsed.payload as { sessionId?: unknown } | undefined
  const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : undefined
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: { ok: true, value: deps.pendingTracker.pending(sessionId) },
  })
}`,
)

writeFileSync(P, text)
console.log('pending 上下文改为 unknown + 局部断言')
