/**
 * `permissions` 投影的选项补挂（0.1.7-rc.1 适配层）。
 *
 * 0.1.5-rc.2 的 `permissions` 投影 wire 是 `{ options, currentValue }`；
 * 0.1.7-rc.1 把它收窄成 `{ currentValue }`——可选 preset 列表移到了进程级
 * `permissionPresets.catalog()` remote（宿主 types.ts 原话：「Key absence means
 * no permission service is composed — clients hide the control.」）。桌面端的
 * `ui-permission-presets` 跟着改读 catalog，手机端仍按旧形状解析：
 * `mobile/sheets.tsx` 的 `parsePermissionSelect` 要求 `options` 非空，否则返回
 * undefined，于是权限胶囊与权限面板整块不渲染（桌面有、手机没有）。
 *
 * 这里在代理层把 catalog 的选项补回投影值：旧宿主本就带 options，是零操作；
 * 新宿主借此恢复，手机端因此**不必**更新已缓存的 bundle。
 *
 * @module dsh-palm/permission-options
 */

import type { Context } from '@deepseek-ai/cordis'

/** 手机端 picker 消费的一个 preset 选项（宿主 `PresetOption` 的结构子集）。 */
export interface PermissionOptionView {
  value: string
  name: string
  description?: string
}

/**
 * 现取 preset 目录的函数。做成函数而不是数组：进程级目录随 live 贡献
 * （如 auto preset 的注册/注销）变化，缓存下来会让手机端停在旧列表上。
 */
export type PermissionOptionsSource = () => readonly PermissionOptionView[]

/** 取不到目录时的空目录（旧宿主，或未装配权限服务的部署）。 */
export const NO_PERMISSION_OPTIONS: PermissionOptionsSource = () => []

/**
 * 从宿主 `permissionPresets` 服务读进程级 preset 目录。
 *
 * 与 index.ts 取 credentials 同样的姿势：`ctx.get` 现取（服务晚于本插件装配也
 * 不丢）、按方法调用（脱离 `this` 会踩宿主内部的继承查找）。任何形状不符或抛错
 * 都降级为空目录——补挂层绝不能把「面板少一行」升级成「插件崩一次」。
 *
 * @param ctx - 插件上下文。
 * @returns 现取选项的函数。
 */
export function permissionOptionsSource(ctx: Context): PermissionOptionsSource {
  return () => {
    const get = ctx.get as unknown as (name: string) => unknown
    let service: unknown
    try {
      service = get.call(ctx, 'permissionPresets')
    } catch {
      return []
    }
    if (typeof service !== 'object' || service === null) return []
    const catalog = (service as { catalog?: unknown }).catalog
    if (typeof catalog !== 'function') return []
    try {
      const value = (catalog as () => unknown).call(service) as { options?: unknown } | undefined
      const options = value?.options
      if (!Array.isArray(options)) return []
      const out: PermissionOptionView[] = []
      for (const raw of options) {
        if (typeof raw !== 'object' || raw === null) continue
        const { value: optionValue, name, description } = raw as Record<string, unknown>
        if (typeof optionValue !== 'string' || typeof name !== 'string') continue
        out.push({ value: optionValue, name, ...(typeof description === 'string' ? { description } : {}) })
      }
      return out
    } catch {
      return []
    }
  }
}

/**
 * 给一个投影值补上选项列表——只认 `permissions` 这个 key。
 *
 * 只在「值确实少了 options」时改写：key 不符、已是旧形状、不是对象、
 * `currentValue` 不是字符串、或目录为空，都原样返回（返回同一引用，
 * 调用方据此判断有没有改写）。
 *
 * @param key - 投影 key。
 * @param value - 宿主下发的投影值。
 * @param options - 进程级 preset 目录。
 * @returns 补挂后的投影值。
 */
export function decorateProjectionValue(
  key: string,
  value: unknown,
  options: readonly PermissionOptionView[],
): unknown {
  if (key !== 'permissions') return value
  if (options.length === 0) return value
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  const existing = record['options']
  if (Array.isArray(existing) && existing.length > 0) return value
  if (typeof record['currentValue'] !== 'string') return value
  return { ...record, options }
}

/** 投影块（`SessionProjectionsBlock` 的结构子集，避免耦合宿主类型）。 */
export interface ProjectionsBlockView {
  asOfSeq: number
  values: Record<string, unknown>
}

/**
 * 给一整个投影块补挂 `permissions`（history 页的基线走这条）。
 *
 * @param block - 宿主下发的投影块。
 * @param options - 进程级 preset 目录。
 * @returns 补挂后的投影块（无需改写时原样返回）。
 */
export function withPermissionOptions<T extends ProjectionsBlockView>(
  block: T,
  options: readonly PermissionOptionView[],
): T {
  if (options.length === 0) return block
  const current = block.values['permissions']
  if (current === undefined) return block
  const decorated = decorateProjectionValue('permissions', current, options)
  if (decorated === current) return block
  return { ...block, values: { ...block.values, permissions: decorated } } as T
}
