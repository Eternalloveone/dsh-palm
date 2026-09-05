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
      { status: 200, body: { limits: { weekly: { usage: 0.459, models: [{ name: 'm', request_count: 3 }] }, session: { usage: 0.05 } } } },
      { status: 200, body: { Plan: 'pro' } },
    ])
    const view = await buildUsageView([
      { route: 'ollama', baseURL: 'https://ollama.com/v1', apiKeyEnv: 'OLLAMA_API_KEY' },
      { route: 'agnes', baseURL: 'https://apihub.agnes-ai.com/v1', apiKeyEnv: 'AGNES_AI_API_KEY' },
    ], async () => 'sk-test')

    expect(view.providers[0]).toMatchObject({ status: 'ok', kind: 'usage', plan: 'pro' })
    expect(view.providers[0]?.usedPercent).toBeCloseTo(0.459)
    expect(view.providers[0]?.sessionUsed).toBeCloseTo(0.05)
    expect(view.providers[0]?.models).toEqual([{ name: 'm', requestCount: 3 }])
    // No adapter for Agnes (no public balance/usage endpoint) → honest label.
    expect(view.providers[1]).toMatchObject({ status: 'unsupported' })
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
      { status: 200, body: { limits: { weekly: { usage: 0.1, models: [] }, session: { usage: 0.0 } } } },
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
