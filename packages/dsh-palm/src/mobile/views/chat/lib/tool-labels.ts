/**
 * 工具栏（模型 / 权限 pill + 上下文用量环）用到的纯函数与类型。
 *
 * S6d 从 `ChatView` 搬出：这些是"把一个值翻译成用户看得懂的短标签"的纯函数，
 * 组件和视图都要用，所以单独成模块——否则 ChatView 与新组件之间会形成视图互引。
 */
import type { SessionModels } from '../../../../api-proxy-types'

/** Lazy in-place model-catalog state for the quick picker strip. */
export type ModelPickerCatalog =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: SessionModels }

/** Token 计数的短写：1.2M / 345k / 900。 */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

/** Compact model label for the pill: drop a provider-y prefix, keep the
 *  last two dash segments (x-preview-f-free → f-free, deepseek-v4-flash →
 *  v4-flash); short ids stay verbatim. The full id lives in the title. */
export function compactModelName(id: string): string {
  const parts = id.split('-').filter(Boolean)
  return parts.length <= 2 ? id : parts.slice(-2).join('-')
}

/**
 * 权限胶囊的可见短名。它只有 24px 高、且与模型名同排，完整值
 * （danger-full-access）会被省略号吃掉，剩 "danger-full-..."——用户看不到自己
 * 现在是哪一档。可见文本用中文短名，aria-label / title 仍保留完整值。
 */
export function permissionShortLabel(value: string): string {
  if (value === 'danger-full-access') return '完全访问'
  if (value.includes('write')) return '可写'
  if (value.includes('read')) return '只读'
  return displayName(value)
}

/** 上下文占用百分比（纯展示）：没有投影时用 `--` 占位。 */
export function formatContextPercent(pct: number | undefined): string {
  return pct === undefined ? '--' : `${Math.round(pct)}%`
}

/** One display-name transform for kebab-case machine names (web-UI parity). */
export function displayName(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name
  return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}
