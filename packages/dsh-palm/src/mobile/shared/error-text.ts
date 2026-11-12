/**
 * 小失败面的统一文案（S5a 从 `views/App.tsx` 搬出）。
 *
 * 放在 `shared/` 而不是留在 App：所有视图都要用它，而「视图 import App」正是那个
 * 十一文件的大环（App → 各视图 → App）。搬出来之后 App 只往下依赖，环才有机会归零。
 */
import { RpcCallError, RpcTransportError } from '../platform/rpc.ts'

/** Shared error text for the surface's small failure affordances. */
export function errorText(error: unknown): string {
  if (error instanceof RpcCallError) return error.error.message
  if (error instanceof RpcTransportError) return error.message
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Actionable hint for transport-level 403s on host-gated channels (model
 * picker, session creation): the phone's UI bundle is served fresh from disk
 * per request, while the host-side allowlist lives in the long-running
 * process — a rebuild without a restart shows the new surface against the
 * old allowlist (HTTP 403 forbidden).
 */
export function staleHostHint(message: string): string | undefined {
  return /^HTTP 403/.test(message)
    ? '宿主端插件可能仍在运行旧版本：请重启 dsh web 后再试。'
    : undefined
}

/**
 * 这次失败是不是**宿主明确拒绝**（4xx）？
 *
 * 用途：`session.prompt` 失败后要不要再花 8 秒核实"是不是其实送到了"。4xx 就是拒收，
 * 没有"已经在队列里"的可能，直接报错别让用户等；超时 / 断流 / 5xx 才值得核实。
 * 408（超时）与 429（限流）不算明确拒绝：宿主可能一边回 429 一边已经排进队列了。
 *
 * @param message - `errorText()` 出来的文案（形如 `HTTP 403 forbidden`）
 * @returns 明确被拒 → true
 */
export function isConclusiveRejection(message: string): boolean {
  const match = /^HTTP (\d{3})/u.exec(message.trim())
  if (match === null) return false
  const status = Number(match[1])
  return status >= 400 && status < 500 && status !== 408 && status !== 429
}
