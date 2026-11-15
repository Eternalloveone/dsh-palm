// @vitest-environment node
/**
 * `mobile.usage` 的 stale-while-revalidate 契约。
 *
 * 背景（2026-11-15）：全量查一次用量实测 3.3 s，而宿主是单线程 —— 那 3.3 s 里
 * 所有 `/m/api` 排队，用户切会话/开抽屉就是"卡一下"。所以这里钉死四条：
 * 新鲜就走缓存、过期先给旧值再后台刷、冷启动也不等、只有 `refresh: true` 才真等。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../usage/usage-check.ts', () => ({
  buildUsageView: vi.fn(async () => ({ providers: [{ route: 'fresh', label: '新值' }] })),
}))
vi.mock('../../http.ts', () => ({ writeJson: vi.fn() }))

const { buildUsageView } = await import('../../usage/usage-check.ts')
const { writeJson } = await import('../../http.ts')
const { mobileUsage } = await import('./mobile-usage.ts')
const { processState } = await import('./process-state.ts')

const buildMock = vi.mocked(buildUsageView)
const writeMock = vi.mocked(writeJson)

/** 造一份 ctx：设置面返回空 ip-ai 路由表 + 无 deepseek，discover 立刻返回空。 */
const makeCtx = (payload: Record<string, unknown> = {}) => ({
  res: {} as never,
  parsed: { payload } as never,
  rpcId: 'r-usage' as never,
  apiProxy: {
    settings: { describe: async () => ({ result: { ok: true, value: { namespaces: [] } } }) },
  } as never,
  deps: { resolveKey: undefined } as never,
})

/** 取出这次写回的响应体。 */
const lastBody = () => {
  const call = writeMock.mock.calls.at(-1)
  return call?.[2] as { result?: { ok?: boolean; value?: unknown } } | undefined
}

const OLD_VIEW = { providers: [{ route: 'cached', label: '旧值' }] } as never

beforeEach(() => {
  vi.clearAllMocks()
  processState.usageCache = undefined
  processState.usageRefreshing = false
})

describe('mobile.usage：不许把宿主堵住', () => {
  it('缓存新鲜：直接用缓存，不去查', async () => {
    processState.usageCache = { at: Date.now(), view: OLD_VIEW }
    await mobileUsage(makeCtx())
    expect(buildMock).not.toHaveBeenCalled()
    expect(lastBody()?.result?.value).toBe(OLD_VIEW)
  })

  it('缓存过期：**先回旧值**，后台再刷（这是本次修复的核心）', async () => {
    processState.usageCache = { at: Date.now() - 10 * 60_000, view: OLD_VIEW }
    const started = Date.now()
    await mobileUsage(makeCtx())
    expect(Date.now() - started).toBeLessThan(100)
    expect(lastBody()?.result?.value).toBe(OLD_VIEW)
    // 后台刷新真的发生了，并且结果进了缓存
    await vi.waitFor(() => expect(buildMock).toHaveBeenCalled())
    await vi.waitFor(() => expect(processState.usageCache?.view).not.toBe(OLD_VIEW))
  })

  it('冷启动（一次都没查过）也不等：先答“查不到”，后台补齐', async () => {
    const started = Date.now()
    await mobileUsage(makeCtx())
    expect(Date.now() - started).toBeLessThan(100)
    expect(lastBody()?.result?.ok).toBe(false)
    await vi.waitFor(() => expect(processState.usageCache).toBeDefined())
  })

  it('用户主动 refresh：这一次必须等真值', async () => {
    processState.usageCache = { at: Date.now() - 10 * 60_000, view: OLD_VIEW }
    await mobileUsage(makeCtx({ refresh: true }))
    expect(buildMock).toHaveBeenCalledTimes(1)
    expect(lastBody()?.result?.ok).toBe(true)
    expect(lastBody()?.result?.value).not.toBe(OLD_VIEW)
  })

  it('后台刷新不并发：连续两次过期请求只起一次查询', async () => {
    processState.usageCache = { at: Date.now() - 10 * 60_000, view: OLD_VIEW }
    await mobileUsage(makeCtx())
    await mobileUsage(makeCtx())
    await vi.waitFor(() => expect(processState.usageCache?.view).not.toBe(OLD_VIEW))
    expect(buildMock).toHaveBeenCalledTimes(1)
  })
})
