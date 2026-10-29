// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildUsageView, consoleUrlOf } from './usage-check.ts'

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
      // 没有 baseURL 的 provider：谁都不匹配（含最后那个「中转站」兜底）→ unsupported。
      { route: 'agnes', apiKeyEnv: 'AGNES_AI_API_KEY' },
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

describe('OpenCode（Console / Go）', () => {
  it('按量付费：用模型列表验证 key，并如实说明余额要去控制台看', async () => {
    mockFetch([{ status: 200, body: { data: [{ id: 'glm-5.3' }, { id: 'kimi-k3' }, { id: 'gpt-6-luna' }] } }])
    const calls: string[] = []
    const wrapped = globalThis.fetch
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input))
      return await wrapped(input as never, init)
    }) as unknown as typeof fetch

    const view = await buildUsageView([
      { route: 'opencode', apiKeyEnv: 'OPENCODE_API_KEY' },
    ], async () => 'oc_sk_test')

    const row = view.providers[0]
    expect(row).toMatchObject({ status: 'ok', kind: 'usage', plan: 'Console 按量付费' })
    // 走的是按量付费的模型端点，不是 Go 的
    expect(calls[0]).toBe('https://opencode.ai/inference/v1/models')
    // 数出可用模型，且不编造余额数字
    expect(row?.summary).toContain('可用模型 3 个')
    expect(row?.summary).toContain('opencode.ai/console')
    expect(row?.balance).toBeUndefined()
    expect(row?.usedPercent).toBeUndefined()
  })

  it('带 opencode.ai baseURL 也能匹配（host 判定优先于路由名）', async () => {
    mockFetch([{ status: 200, body: { data: [] } }])
    const view = await buildUsageView([
      { route: 'my-gateway', baseURL: 'https://opencode.ai/inference/v1', apiKeyEnv: 'OPENCODE_API_KEY' },
    ], async () => 'oc_sk_test')
    expect(view.providers[0]).toMatchObject({ status: 'ok', kind: 'usage' })
  })

  it('key 无效（401）时报失败，而不是显示一行空白', async () => {
    // 401 的响应体不是 JSON：getJson 会在非 2xx 时先抛，状态落成 error。
    mockFetch([{ status: 401, body: { error: { message: 'Invalid credential' } } }])
    const view = await buildUsageView([
      { route: 'opencode', apiKeyEnv: 'OPENCODE_API_KEY' },
    ], async () => 'oc_sk_bad')
    expect(view.providers[0]?.status).toBe('error')
  })

  it('没有 key 时是 no-key，一次网络都不发', async () => {
    mockFetch([{ status: 200, body: {} }])
    const view = await buildUsageView([
      { route: 'opencode', apiKeyEnv: 'OPENCODE_API_KEY' },
    ], async () => undefined)
    expect(view.providers[0]?.status).toBe('no-key')
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled()
  })
})

describe('OpenCode Go：真实用量接口', () => {
  it('三个窗口的百分比与重置时刻都落到行上', async () => {
    mockFetch([{ status: 200, body: {
      usage: {
        rolling: { status: 'ok', percent: 4, resetsAt: '2026-10-28T15:44:11.000Z' },
        weekly: { status: 'ok', percent: 10, resetsAt: '2026-11-02T00:00:00.000Z' },
        monthly: { status: 'ok', percent: 5, resetsAt: '2026-11-28T04:45:30.000Z' },
      },
    } }])
    const view = await buildUsageView([
      { route: 'opencode-go', apiKeyEnv: 'OPENCODE_GO_API_KEY' },
    ], async () => 'oc_sk_test')
    const row = view.providers[0]
    expect(row).toMatchObject({ status: 'ok', kind: 'usage', plan: 'Go' })
    // percent 是「已用」：10% → 0.10
    expect(row?.usedPercent).toBeCloseTo(0.1)
    expect(row?.sessionUsed).toBeCloseTo(0.04)
    expect(row?.sessionResetsAt).toBe(Date.parse('2026-10-28T15:44:11.000Z'))
    expect(row?.weeklyResetsAt).toBe(Date.parse('2026-11-02T00:00:00.000Z'))
    expect(row?.summary).toBe('5 小时 4% · 本周 10% · 本月 5%')
  })

  it('走的是 Go 的用量端点（不是按量付费的模型列表）', async () => {
    const calls: string[] = []
    const original = globalThis.fetch
    mockFetch([{ status: 200, body: { usage: { rolling: { percent: 1 } } } }])
    const wrapped = globalThis.fetch
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input))
      return await wrapped(input as never, init)
    }) as unknown as typeof fetch
    try {
      await buildUsageView([{ route: 'opencode-go', apiKeyEnv: 'OPENCODE_GO_API_KEY' }], async () => 'oc_sk_test')
    } finally {
      globalThis.fetch = original
    }
    expect(calls[0]).toBe('https://opencode.ai/inference/go/v1/usage')
  })

  it('三个窗口都读不出来才报失败（形状变了不静默显示 0%）', async () => {
    mockFetch([{ status: 200, body: { usage: {} } }])
    const view = await buildUsageView([{ route: 'opencode-go', apiKeyEnv: 'OPENCODE_GO_API_KEY' }], async () => 'oc_sk_test')
    expect(view.providers[0]?.status).toBe('error')
  })

  it('按量付费（opencode）仍然走模型列表校验，不被 Go 的适配器抢走', async () => {
    const calls: string[] = []
    const original = globalThis.fetch
    mockFetch([{ status: 200, body: { data: [{ id: 'glm-5.3' }] } }])
    const wrapped = globalThis.fetch
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input))
      return await wrapped(input as never, init)
    }) as unknown as typeof fetch
    try {
      await buildUsageView([{ route: 'opencode', apiKeyEnv: 'OPENCODE_API_KEY' }], async () => 'oc_sk_test')
    } finally {
      globalThis.fetch = original
    }
    expect(calls[0]).toBe('https://opencode.ai/inference/v1/models')
  })
})

describe('通用中转站（one-api / new-api 兜底）', () => {
  it('有上限时算出百分比，并标明这是「累计已用」', async () => {
    mockFetch([
      { status: 200, body: { object: 'billing_subscription', hard_limit_usd: 20, soft_limit_usd: 20 } },
      { status: 200, body: { object: 'list', total_usage: 5 } },
    ])
    const view = await buildUsageView([
      { route: 'agnes', baseURL: 'https://apihub.agnes-ai.com/v1', apiKeyEnv: 'AGNES_AI_API_KEY' },
    ], async () => 'sk-test')
    const row = view.providers[0]
    expect(row).toMatchObject({ status: 'ok', kind: 'balance', plan: '中转站' })
    expect(row?.usedPercent).toBeCloseTo(0.25)
    expect(row?.balance).toBe('$5.00')
    // 真机截图：写成「账户余额 $517」会被读成「还剩 517 美元」，其实是累计已花。
    expect(row?.balanceLabel).toBe('累计已用')
  })

  it('1e8 这种「不限额」约定不算百分比，只报已用', async () => {
    mockFetch([
      { status: 200, body: { hard_limit_usd: 100000000, soft_limit_usd: 100000000 } },
      { status: 200, body: { total_usage: 517.16064 } },
    ])
    const view = await buildUsageView([
      { route: 'modelflare', baseURL: 'https://modelflare.dev/v1', apiKeyEnv: 'MODELFLARE_API_KEY' },
    ], async () => 'sk-test')
    const row = view.providers[0]
    expect(row?.status).toBe('ok')
    expect(row?.usedPercent).toBeUndefined()
    expect(row?.summary).toBe('已用 $517（无额度上限）')
    expect(row?.balanceLabel).toBe('累计已用')
  })

  it('两张表都 404：标「不支持」而不是「失败」，并带上控制台地址', async () => {
    mockFetch([{ status: 404, body: {} }])
    const view = await buildUsageView([
      { route: 'mistral', baseURL: 'https://api.mistral.ai/v1', apiKeyEnv: 'MISTRAL_API_KEY' },
    ], async () => 'sk-test')
    const row = view.providers[0]
    expect(row?.status).toBe('unsupported')
    expect(row?.detail).toBe('官方没有可查的余额/用量接口')
    expect(row?.consoleUrl).toBe('https://console.mistral.ai/usage')
  })

  it('401 说成「API Key 无效」，不是笼统的「失败」', async () => {
    mockFetch([{ status: 401, body: { error: 'bad key' } }])
    const view = await buildUsageView([
      { route: 'modelflare', baseURL: 'https://modelflare.dev/v1', apiKeyEnv: 'MODELFLARE_API_KEY' },
    ], async () => 'sk-bad')
    expect(view.providers[0]?.status).toBe('error')
    expect(view.providers[0]?.detail).toBe('API Key 无效或没有权限（401）')
  })
})

describe('余额行的标签', () => {
  it('真余额（DeepSeek）不标「累计已用」', async () => {
    mockFetch([{ status: 200, body: { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '12.00' }] } }])
    const view = await buildUsageView([
      { route: 'deepseek', baseURL: 'https://api.deepseek.com', apiKeyEnv: 'DEEPSEEK_API_KEY' },
    ], async () => 'sk-test')
    const row = view.providers[0]
    expect(row?.kind).toBe('balance')
    expect(row?.balanceLabel).toBeUndefined()
  })
})

describe('consoleUrlOf', () => {
  it('按 host 映射到控制台计费页', () => {
    expect(consoleUrlOf('https://api.deepseek.com/v1')).toBe('https://platform.deepseek.com/usage')
    expect(consoleUrlOf('https://bedrock-runtime.us-east-1.amazonaws.com')).toBe('https://console.aws.amazon.com/billing/home')
    expect(consoleUrlOf('https://example.invalid/v1')).toBeUndefined()
    expect(consoleUrlOf(undefined)).toBeUndefined()
  })
})

describe('consoleUrlOf 按路由兜底', () => {
  it('没有 baseURL 的 provider（DeepSeek 官方 / OpenCode Go）也能给出控制台', () => {
    expect(consoleUrlOf(undefined, 'deepseek')).toBe('https://platform.deepseek.com/usage')
    expect(consoleUrlOf(undefined, 'opencode-go')).toBe('https://opencode.ai/console')
    expect(consoleUrlOf(undefined, 'unheard-of-route')).toBeUndefined()
  })

  it('baseURL 认不出来时退回路由，认得出时以 host 为准', () => {
    expect(consoleUrlOf('https://unknown.example.com/v1', 'ollama')).toBe('https://ollama.com/settings/keys')
    expect(consoleUrlOf('https://api.deepseek.com/v1', 'ollama')).toBe('https://platform.deepseek.com/usage')
  })
})

describe('查不到时的具体原因', () => {
  it('硅基流动说清「官方已下线余额接口」并给控制台', async () => {
    // 2026-08-14 官方下线 /user/info，国内区没有替代接口；笼统的「不支持」会让人
    // 反复换 key。这里要求把日期和去处写出来。
    mockFetch([{ status: 404, body: {} }])
    const view = await buildUsageView([
      { route: 'siliconflow', baseURL: 'https://api.siliconflow.cn/v1', apiKeyEnv: 'SILICONFLOW_API_KEY' },
    ], async () => 'sk-test')
    const row = view.providers[0]
    expect(row?.status).toBe('unsupported')
    expect(row?.detail).toContain('2026-08-14')
    expect(row?.consoleUrl).toBe('https://cloud.siliconflow.cn/account/ak')
  })

  it('其它家仍用通用说法', async () => {
    mockFetch([{ status: 404, body: {} }])
    const view = await buildUsageView([
      { route: 'mistral', baseURL: 'https://api.mistral.ai/v1', apiKeyEnv: 'MISTRAL_API_KEY' },
    ], async () => 'sk-test')
    expect(view.providers[0]?.detail).toBe('官方没有可查的余额/用量接口')
  })
})
