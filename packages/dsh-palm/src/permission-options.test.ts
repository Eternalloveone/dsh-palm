/**
 * `permissions` 投影的选项补挂（0.1.7-rc.1 适配层）。
 *
 * 0.1.7-rc.1 把投影 wire 从 `{options, currentValue}` 收窄成 `{currentValue}`，
 * 可选 preset 列表搬到了进程级 `permissionPresets.catalog()`；手机端的
 * `parsePermissionSelect` 仍要求 `options` 非空，缺了就返回 `undefined`，于是权限
 * 胶囊与权限面板整块不渲染——桌面正常、手机没有，两端还都不报错。这组测试锁住
 * 补挂层的三条契约：只在真正缺选项时改写（旧形状与其他投影返回同一引用）、
 * 目录一律现取（随 live 贡献变化）、取不到目录就降级为空——补挂层绝不能把
 * 「面板少一行」升级成「插件崩一次」。
 */
import { describe, expect, it } from 'vitest'
import {
  NO_PERMISSION_OPTIONS,
  decorateProjectionValue,
  permissionOptionsSource,
  withPermissionOptions,
  type PermissionOptionView,
} from './permission-options.ts'

/** 一份进程级 preset 目录（宿主 `catalog()` 里 `options` 的形状）。 */
const CATALOG: readonly PermissionOptionView[] = [
  { value: 'read-only', name: 'read-only' },
  { value: 'workspace-write', name: 'workspace-write', description: '可写工作区' },
  { value: 'danger-full-access', name: 'danger-full-access' },
]

/** 一个假的宿主 `permissionPresets` 服务：补挂层只读它的 `catalog`。 */
function fakePresets(catalog: () => unknown): { catalog: () => unknown } {
  return { catalog }
}

/** 一个假的插件上下文：只暴露 `get`，按名字返回服务。 */
function fakeContext(service: unknown): never {
  return {
    get: (name: string) => {
      if (name !== 'permissionPresets') throw new Error(`unexpected service: ${name}`)
      return service
    },
  } as never
}

describe('decorateProjectionValue', () => {
  it('attaches the catalog options to a permissions value that carries none', () => {
    const value = { currentValue: 'workspace-write' }

    expect(decorateProjectionValue('permissions', value, CATALOG)).toEqual({
      currentValue: 'workspace-write',
      options: CATALOG,
    })
    // The caller's object is never mutated: the rewrite is always a copy.
    expect(value).toEqual({ currentValue: 'workspace-write' })
  })

  it('refills an options array that is present but empty', () => {
    expect(decorateProjectionValue('permissions', { currentValue: 'read-only', options: [] }, CATALOG)).toEqual({
      currentValue: 'read-only',
      options: CATALOG,
    })
  })

  it('leaves every other projection key untouched', () => {
    const value = { currentValue: 'workspace-write' }

    for (const key of ['title', 'turnOutline', 'contextPressure']) {
      expect(decorateProjectionValue(key, value, CATALOG)).toBe(value)
    }
  })

  it('leaves the old wire shape untouched (it already carries options)', () => {
    const value = { options: CATALOG, currentValue: 'read-only' }

    expect(decorateProjectionValue('permissions', value, CATALOG)).toBe(value)
  })

  it('leaves values it does not understand untouched', () => {
    for (const value of [undefined, null, 'workspace-write', 7, [], {}, { currentValue: 7 }]) {
      expect(decorateProjectionValue('permissions', value, CATALOG)).toBe(value)
    }
  })

  it('is a no-op when the process directory is empty', () => {
    const value = { currentValue: 'workspace-write' }

    expect(decorateProjectionValue('permissions', value, [])).toBe(value)
  })
})

describe('withPermissionOptions', () => {
  it('decorates the permissions value of a whole projection block', () => {
    const block = { asOfSeq: 12, values: { title: 'x', permissions: { currentValue: 'workspace-write' } } }

    expect(withPermissionOptions(block, CATALOG)).toEqual({
      asOfSeq: 12,
      values: { title: 'x', permissions: { currentValue: 'workspace-write', options: CATALOG } },
    })
  })

  it('returns the same block when there is nothing to do', () => {
    const shaped = { asOfSeq: 1, values: { permissions: { currentValue: 'read-only', options: CATALOG } } }
    const without = { asOfSeq: 2, values: { title: 'x' } }
    const bare = { asOfSeq: 3, values: { permissions: { currentValue: 'read-only' } } }

    expect(withPermissionOptions(shaped, CATALOG)).toBe(shaped)
    expect(withPermissionOptions(without, CATALOG)).toBe(without)
    expect(withPermissionOptions(bare, [])).toBe(bare)
  })
})

describe('permissionOptionsSource', () => {
  it('reads the process catalog through ctx.get and re-reads it on every call', () => {
    let options: PermissionOptionView[] = [...CATALOG]
    const source = permissionOptionsSource(fakeContext(fakePresets(() => ({ options }))))

    expect(source()).toEqual(CATALOG)

    // The directory is live: an option registered later shows up without a rebuild.
    options = [...CATALOG, { value: 'custom', name: 'custom' }]
    expect(source()).toHaveLength(4)
  })

  it('drops malformed catalog entries instead of failing the surface', () => {
    const source = permissionOptionsSource(fakeContext(fakePresets(() => ({
      options: [null, 7, { name: 'no-value' }, { value: 'no-name' }, { value: 'ok', name: 'ok', description: 5 }, CATALOG[1]],
    }))))

    expect(source()).toEqual([{ value: 'ok', name: 'ok' }, CATALOG[1]])
  })

  it('degrades to an empty directory whenever the service is absent or unusable', () => {
    const throwing = { get: () => { throw new Error('no such service') } } as never

    expect(permissionOptionsSource(throwing)()).toEqual([])

    for (const service of [undefined, null, 'permissionPresets', {}, { catalog: 'nope' }]) {
      expect(permissionOptionsSource(fakeContext(service))()).toEqual([])
    }

    expect(permissionOptionsSource(fakeContext(fakePresets(() => { throw new Error('boom') })))()).toEqual([])
    expect(permissionOptionsSource(fakeContext(fakePresets(() => undefined)))()).toEqual([])
    expect(permissionOptionsSource(fakeContext(fakePresets(() => ({ options: 'nope' }))))()).toEqual([])
  })

  it('ships a stable empty source for hosts without a permission service', () => {
    expect(NO_PERMISSION_OPTIONS()).toEqual([])
    expect(NO_PERMISSION_OPTIONS).toBe(NO_PERMISSION_OPTIONS)
  })
})
