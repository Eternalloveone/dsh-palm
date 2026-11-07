/**
 * 事件 `data` 的形状守卫（投影层共用）。
 *
 * 宿主发来的是 lossless JSON，字段形态会随版本演进：同一语义可能挂在
 * `attachment` 下、也可能平铺在同一层。这些判据以前散在 `messages.ts` 里，
 * 拆投影时收进来，避免每个投影各写一份"是不是对象"。
 *
 * @module dsh-palm/mobile/projections/json
 */

/** 是非数组对象即为记录（`null` 与数组都不算）。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 取字符串字段；类型不对就当没有。 */
export function pickString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** 取有限数字字段；`NaN` / `Infinity` 也当没有。 */
export function pickNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
