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
