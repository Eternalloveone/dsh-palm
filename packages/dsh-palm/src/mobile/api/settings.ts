/**
 * 设置写入的操作白名单判定（P2 域拆分：settings 域第一个搬出来的纯函数）。
 *
 * 从 mobile-api.ts 搬出时保持行为完全一致：只认 `{ op: 'set', path: [...] }`，
 * 且 path 必须命中 allowed 里的一条（或 allowed 为 ['*'] 且 path 只有一段）。
 *
 * @module dsh-palm/mobile/api/settings
 */

/** 判定一次设置写入是否被允许（纯函数，无副作用）。 */
export function isAllowedSettingsOp(op: unknown, allowed: readonly (readonly string[])[]): boolean {
  if (typeof op !== 'object' || op === null) return false
  const record = op as Record<string, unknown>
  if (record.op !== 'set' || !Array.isArray(record.path)) return false
  const path = record.path.map(part => (typeof part === 'string' ? part : ''))
  return allowed.some(allowedPath => {
    if (allowedPath.length === 1 && allowedPath[0] === '*') return path.length === 1
    return allowedPath.length === path.length
      && allowedPath.every((part, index) => part === path[index])
  })
}
