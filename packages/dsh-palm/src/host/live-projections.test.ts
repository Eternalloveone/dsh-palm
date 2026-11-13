/**
 * 宿主投影按 key 直读的契约（2026-11-13 圆环不显示用量）。
 *
 * 宿主的 `contextPressure` 声明了 `summary: false`，页面/list 的 projections 里
 * 永远没有它；这里必须能绕开摘要、按 key 拿到值，并且任何能力缺失都退化成
 * `undefined`（调用方用摘要兜底），绝不抛错。
 */
import { describe, expect, it } from 'vitest'
import { installProjectionHost, liveProjections } from './live-projections.ts'

/** 一个够用的假宿主：sessions.get + sessionProjections.snapshot。 */
function hostOf(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const session = { id: 's-1' }
  return {
    sessions: { get: (id: string) => id === 's-1' ? session : undefined },
    sessionProjections: {
      snapshot: (target: unknown, keys: readonly string[]) => {
        if (target !== session) return undefined
        return {
          asOfSeq: 42,
          values: {
            contextPressure: { contextWindow: 200_000, pressureTokens: 50_000, projectedTokens: 50_000 },
            permissions: { currentValue: 'read' },
            turnOutline: { big: true },
          },
        }
      },
    },
    ...overrides,
  }
}

describe('liveProjections', () => {
  it('按 key 取到摘要里没有的 contextPressure', () => {
    installProjectionHost(hostOf())
    const block = liveProjections('s-1', ['contextPressure'])
    expect(block?.asOfSeq).toBe(42)
    expect(block?.values?.['contextPressure']).toEqual({ contextWindow: 200_000, pressureTokens: 50_000, projectedTokens: 50_000 })
    // 没要的键不许混进来（尾页体积靠这个保证）。
    expect(block?.values?.['turnOutline']).toBeUndefined()
  })

  it('sessions.get 缺失时退到 list() 按 id 找', () => {
    const session = { id: 's-9' }
    installProjectionHost({
      sessions: { list: () => [{ id: 'x' }, session] },
      sessionProjections: { snapshot: (target: unknown) => target === session ? { values: { permissions: { currentValue: 'all' } } } : undefined },
    })
    expect(liveProjections('s-9', ['permissions'])?.values?.['permissions']).toEqual({ currentValue: 'all' })
  })

  it('能力缺失 / 会话找不到 / snapshot 抛错，一律 undefined（调用方兜底）', () => {
    installProjectionHost({})
    expect(liveProjections('s-1', ['contextPressure'])).toBeUndefined()
    installProjectionHost(hostOf())
    expect(liveProjections('missing', ['contextPressure'])).toBeUndefined()
    installProjectionHost({
      sessions: { get: () => ({ id: 's-1' }) },
      sessionProjections: { snapshot: () => { throw new Error('boom') } },
    })
    expect(liveProjections('s-1', ['contextPressure'])).toBeUndefined()
    installProjectionHost(undefined)
    expect(liveProjections('s-1', ['contextPressure'])).toBeUndefined()
  })
})
