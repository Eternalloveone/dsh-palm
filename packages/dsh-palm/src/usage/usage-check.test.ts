// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildUsageView } from './usage-check.ts'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

/** Stub global fetch to replay a scripted list of JSON responses. */
function mockFetch(responses: Array<{ status: number; body: unknown }>): void {
  let i = 0
  globalThis.fetch = vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)]
    i += 1
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } })
  })
}

describe('buildUsageView', () => {
  it('maps an Ollama provider to a usage row and labels a keyless provider unsupported', async () => {
    mockFetch([
      // /api/balance —— 剩余百分比 + 重置时刻
      { status: 200, body: { included: {
        session: { remaining_percent: 95, resets_at: '2026-10-11T02:00:00Z' },
        weekly: { remaining_percent: 54.1, resets_at: '2026-10-12T00:00:00Z' },
      }, purchased: { balance_usd: 0 } } },
      // /api/usage?range=7d —— 请求数与逐日桶
      { status: 200, body: { range: '7d', totals: { request_count: 9447 }, buckets: [
        { from: '2026-10-03T00:00:00Z', until: '2026-10-04T00:00:00Z', request_count: 3852 },
      ] } },
      // /api/me —— 套餐名
      { status: 200, body: { Plan: 'pro' } },
    ])
    const view = await buildUsageView([
      { route: 'ollama', baseURL: 'https://ollama.com/v1', apiKeyEnv: 'OLLAMA_API_KEY' },
      { route: 'agnes', baseURL: 'https://apihub.agnes-ai.com/v1', apiKeyEnv: 'AGNES_AI_API_KEY' },
    ], async () => 'sk-test')

    const row = view.providers[0]
    expect(row).toMatchObject({ status: 'ok', kind: 'usage', plan: 'pro' })
    // remaining_percent 是"剩余"：95% 剩余 ⇒ 5% 已用。
    expect(row?.sessionUsed).toBeCloseTo(0.05)
    expect(row?.usedPercent).toBeCloseTo(0.459)
    expect(row?.sessionResetsAt).toBe(Date.parse('2026-10-11T02:00:00Z'))
    expect(row?.weeklyResetsAt).toBe(Date.parse('2026-10-12T00:00:00Z'))
    expect(row?.summary).toBe('近 7 天 9,447 次请求')
    expect(row?.models).toEqual([{ name: '10-03', requestCount: 3852 }])
    // No adapter for Agnes (no public balance/usage endpoint) → honest label.
    expect(view.providers[1]).toMatchObject({ status: 'unsupported' })
  })

  it('keeps the percentages when the request-count report is unrecognised', async () => {
    // 用量报告换形状不该拖垮百分比：余额这一块自己能成立。
    mockFetch([
      { status: 200, body: { included: { weekly: { remaining_percent: 40 } }, purchased: { balance_usd: 0 } } },
      { status: 200, body: { something: 'else' } },
      { status: 200, body: { Plan: 'pro' } },
    ])
    const view = await buildUsageView([
      { route: 'ollama', baseURL: 'https://ollama.com/v1', apiKeyEnv: 'OLLAMA_API_KEY' },
    ], async () => 'sk-test')
    const row = view.providers[0]
    expect(row?.status).toBe('ok')
    expect(row?.usedPercent).toBeCloseTo(0.6)
    expect(row?.summary).toBeUndefined()
  })

  it('keeps the request counts when the balance endpoint fails', async () => {
    mockFetch([
      { status: 500, body: {} },
      { status: 200, body: { range: '7d', totals: { request_count: 12 }, buckets: [] } },
      { status: 200, body: { Plan: 'free' } },
    ])
    const view = await buildUsageView([
      { route: 'ollama', baseURL: 'https://ollama.com/v1', apiKeyEnv: 'OLLAMA_API_KEY' },
    ], async () => 'sk-test')
    const row = view.providers[0]
    expect(row?.status).toBe('ok')
    expect(row?.summary).toBe('近 7 天 12 次请求')
    expect(row?.usedPercent).toBeUndefined()
    expect(row?.plan).toBe('free')
  })

  it('keeps the usage row alive when /api/me fails without a request body', async () => {
    // 线上真实故障：/api/me 对裸 POST 回 411 Length Required。它只是套餐名点缀，
    // 整行不能因此变成「用量查询失败」。
    mockFetch([
      { status: 200, body: { included: { weekly: { remaining_percent: 10 } } } },
      { status: 200, body: { range: '7d', totals: { request_count: 12 }, buckets: [] } },
      { status: 411, body: { error: 'Length Required' } },
    ])
    const view = await buildUsageView([
      { route: 'ollama', baseURL: 'https://ollama.com/v1', apiKeyEnv: 'OLLAMA_API_KEY' },
    ], async () => 'sk-test')
    expect(view.providers[0]).toMatchObject({ status: 'ok', summary: '近 7 天 12 次请求' })
    expect(view.providers[0]?.plan).toBeUndefined()
  })

  it('reports an unrecognised payload as error instead of a made-up zero', async () => {
    mockFetch([
      { status: 200, body: { something: 'else' } },
      { status: 200, body: { also: 'unknown' } },
      { status: 200, body: { Plan: 'pro' } },
    ])
    const view = await buildUsageView([
      { route: 'ollama', baseURL: 'https://ollama.com/v1', apiKeyEnv: 'OLLAMA_API_KEY' },
    ], async () => 'sk-test')
    expect(view.providers[0]?.status).toBe('error')
  })

  it('labels a provider with no resolvable key as no-key', async () => {
    mockFetch([])
    const view = await buildUsageView([
      { route: 'ollama', baseURL: 'https://ollama.com/v1', apiKeyEnv: 'OLLAMA_API_KEY' },
    ], async () => undefined)
    expect(view.providers[0]?.status).toBe('no-key')
  })

  it('labels an adapter failure as error', async () => {
    mockFetch([{ status: 500, body: {} }])
    const view = await buildUsageView([
      { route: 'ollama', baseURL: 'https://ollama.com/v1', apiKeyEnv: 'OLLAMA_API_KEY' },
    ], async () => 'sk-test')
    expect(view.providers[0]?.status).toBe('error')
  })

  it('matches by baseURL host rather than route name', async () => {
    mockFetch([
      { status: 200, body: { included: { weekly: { remaining_percent: 90 } } } },
      { status: 200, body: { range: '7d', totals: { request_count: 1 }, buckets: [] } },
      { status: 200, body: { Plan: 'pro' } },
    ])
    const view = await buildUsageView([
      // A user-named route (like the desktop's `ollama-1`) still resolves the
      // Ollama adapter because the host is ollama.com.
      { route: 'ollama-1', baseURL: 'https://ollama.com/v1', apiKeyEnv: 'OLLAMA_API_KEY' },
    ], async () => 'sk-test')
    expect(view.providers[0]?.status).toBe('ok')
  })

  it('maps a DeepSeek provider to a balance row', async () => {
    mockFetch([{ status: 200, body: {
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '42.50', granted_balance: '0.00', topped_up_balance: '42.50' }],
    } }])
    const view = await buildUsageView([
      // The dedicated gateway row carries no baseURL (route alone identifies
      // it); the ref name rides the config so the key resolves host-side.
      { route: 'deepseek', apiKeyEnv: 'DEEPSEEK_API_KEY' },
    ], async () => 'sk-test')
    expect(view.providers[0]).toMatchObject({ status: 'ok', kind: 'balance', balance: '42.50 CNY' })
  })

  it('maps a Moonshot/Kimi provider to a balance row', async () => {
    mockFetch([{ status: 200, body: {
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '12.00', granted_balance: '0.00', topped_up_balance: '12.00' }],
    } }])
    const view = await buildUsageView([
      { route: 'kimi', baseURL: 'https://api.moonshot.cn/v1', apiKeyEnv: 'MOONSHOT_API_KEY' },
    ], async () => 'sk-test')
    expect(view.providers[0]).toMatchObject({ status: 'ok', kind: 'balance', balance: '12.00 CNY' })
  })

  it('maps an OpenRouter provider with a credit limit to a usage share', async () => {
    mockFetch([{ status: 200, body: { data: { label: 'Personal', usage: 4.5, limit: 10, is_free_tier: false } } }])
    const view = await buildUsageView([
      { route: 'openrouter', baseURL: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY' },
    ], async () => 'sk-test')
    expect(view.providers[0]).toMatchObject({ status: 'ok', kind: 'usage', plan: 'Personal', usedPercent: 0.45 })
  })

  it('reports OpenRouter spent dollars when the limit is pay-as-you-go', async () => {
    mockFetch([{ status: 200, body: { data: { label: 'Personal', usage: 3.2, limit: null, is_free_tier: true } } }])
    const view = await buildUsageView([
      { route: 'openrouter', baseURL: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY' },
    ], async () => 'sk-test')
    const provider = view.providers[0]
    expect(provider?.status).toBe('ok')
    expect(provider?.usedPercent).toBeUndefined()
    expect(provider?.plan).toBe('Free')
    expect(provider?.balance).toMatch(/3\.20/)
  })
})
