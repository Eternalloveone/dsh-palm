/**
 * Usage/balance checks for configured LLM providers.
 *
 * Deliberately version-independent: pure HTTPS calls, no imports from any DSH
 * service package, so the same logic powers the plugin's `/m/api` surface and
 * a standalone script. The plugin layer supplies the key resolver (wired to
 * the host credentials service) and reads the configured provider list; this
 * file only knows how to match a provider to a balance/usage adapter and call
 * that adapter.
 *
 * An adapter that a provider does not map onto means *no public balance/usage
 * endpoint exists* for it — the phone renders an honest "unsupported" row
 * instead of a fabricated number. Keys never return from here: every method
 * hands back only display facts.
 *
 * @module dsh-palm/usage/usage-check
 */

/** One configured provider as discovered from the host settings surface. */
export interface UsageProviderConfig {
  /** The settings dict key (the provider route, as the desktop names it). */
  route: string
  /** OpenAI-compatible base URL when one is configured (used to identify the adapter). */
  baseURL?: string
  /** A human display name from the desktop config, when it supplies one. */
  displayName?: string
  /** The credential reference (env-style name) backing this provider's key. */
  apiKeyEnv?: string
}

/** Per-model usage inside a provider's weekly/session report. */
export interface UsageModelRow {
  name: string
  requestCount: number
}

/** One provider's displayed usage/balance row (never carries a key). */
export interface UsageProviderView {
  /** Route key (preferred) or displayName from the desktop config. */
  name: string
  /** baseURL host, for a label under the name. */
  baseURL?: string
  /** 'usage' = consumed quota report; 'balance' = account balance. */
  kind: 'usage' | 'balance'
  /**
   * 'ok' the adapter returned data; 'no-key' the provider has no resolvable
   * key; 'unsupported' no adapter matches (no public endpoint); 'error' the
   * adapter failed. 'unsupported' rows still render, so the phone shows what
   * the desktop configured even when nothing is queryable.
   */
  status: 'ok' | 'no-key' | 'unsupported' | 'error'
  /** Plan label (usage adapters, when the provider reports one). */
  plan?: string
  /** Weekly consumed quota, 0..1 (usage adapters). */
  usedPercent?: number
  /** Current session consumed quota, 0..1 (usage adapters). */
  sessionUsed?: number
  /** 最近 5 小时窗口的下次重置时刻（epoch millis），提供方给出时才有。 */
  sessionResetsAt?: number
  /** 每周窗口的下次重置时刻（epoch millis），提供方给出时才有。 */
  weeklyResetsAt?: number
  /**
   * 一句话事实摘要，给那些没有「已用/上限」可算的用量行：Ollama Cloud 的余额
   * 接口给剩余百分比、用量接口给请求数，手机端在两项都拿不到时用它显示
   * 「近 7 天 9,447 次请求」，而不是编一个数字或留一片空白。
   */
  summary?: string
  /** Per-model request counts (usage adapters). */
  models?: UsageModelRow[]
  /** Formatted balance for balance adapters. */
  balance?: string
  /** Epoch millis when this row was measured. */
  fetchedAt: number
}

/** The full usage surface the phone renders. */
export interface UsageView {
  providers: UsageProviderView[]
  fetchedAt: number
}

/** Display facts an adapter measures for one provider. */
interface ProviderUsage {
  kind: 'usage' | 'balance'
  plan?: string
  usedPercent?: number
  sessionUsed?: number
  sessionResetsAt?: number
  weeklyResetsAt?: number
  balance?: string
  summary?: string
  models?: UsageModelRow[]
}

/** A balance/usage adapter matched against a configured provider. */
interface UsageAdapter {
  kind: 'usage' | 'balance'
  /** Whether this adapter serves the provider (matched by baseURL host, then route). */
  match(provider: UsageProviderConfig): boolean
  check(key: string): Promise<ProviderUsage>
}

/**
 * Read one JSON endpoint with bearer auth; throws on transport or HTTP failure.
 *
 * `body` matters more than it looks: `/api/me` answers 411 Length Required to a
 * POST with no request body, so a bare POST fails even though the key is fine.
 * Endpoints that insist on one get the smallest valid body (`'{}'`).
 */
async function getJson(url: string, key: string, method: 'GET' | 'POST' = 'GET', body?: string): Promise<unknown> {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} (${method}) from ${url}`)
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`non-JSON response from ${url}`)
  }
}

/** Clamp a 0..1-ish fraction defensively. */
function clampUnit(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : undefined
}

/** `2026-10-03T00:00:00Z` → `10-03`：一条按天用量桶覆盖的那一天。 */
function dayLabel(from: unknown): string | undefined {
  return typeof from === 'string' && from.length >= 10 ? from.slice(5, 10) : undefined
}

/** `7d` → 7：这次报告覆盖的滚动窗口天数。 */
function rangeDays(range: unknown): number | undefined {
  const match = typeof range === 'string' ? /^(\d+)d$/.exec(range.trim()) : null
  return match === null ? undefined : Number(match[1])
}

/** `remaining_percent`（0..100，剩余）→ 已用 0..1；非数字给 undefined。 */
function remainingToUsed(remainingPercent: unknown): number | undefined {
  return typeof remainingPercent === 'number' && Number.isFinite(remainingPercent)
    ? clampUnit(1 - remainingPercent / 100)
    : undefined
}

/** ISO 时间串 → epoch millis；解析不出来的给 undefined。 */
function epochOf(iso: unknown): number | undefined {
  if (typeof iso !== 'string') return undefined
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Ollama Cloud —— 三个端点各管一块事实，任何一块单独失败都不该毁掉整行：
 *
 * · `GET /api/balance` —— **剩余百分比**（`included.session/weekly.remaining_percent`
 *   为 0..100，另带各自的 `resets_at`）。这才是手机端过去那两条「近 5 小时 / 本周」
 *   进度条的来源；旧代码把它当成 `/api/usage` 的 `limits.*.usage` 去读，而那个字段
 *   已经不在用量报告里了。按额度计费的新形态给的是 `balance_usd`/`allowance_usd`
 *   （如实转成金额文案，不硬凑百分比）。
 * · `GET /api/usage?range=7d` —— 请求数报告（`totals.request_count` + 逐日桶）；文档
 *   里的档位只有 24h / 7d / 30d，多传 `granularity` 之类的参数会被 400 拒掉。
 * · `POST /api/me` —— 套餐名，纯点缀；它现在要求带请求体（裸 POST 回 411）。
 *
 * 余额与用量**至少取到一块**就算 ok（有事实可看），两块都取不到才诚实地报失败。
 */
const ollamaAdapter: UsageAdapter = {
  kind: 'usage',
  match: provider => hostIs(provider.baseURL, 'ollama.com') || provider.route === 'ollama',
  async check(key) {
    type QuotaBlock = { remaining_percent?: unknown; resets_at?: unknown }
    type Included = {
      session?: QuotaBlock
      weekly?: QuotaBlock
      balance_usd?: unknown
      allowance_usd?: unknown
    }
    let included: Included | undefined
    try {
      const balance = (await getJson('https://ollama.com/api/balance', key)) as { included?: Included }
      included = balance.included
    } catch {
      // 余额拿不到还有请求数可用；两块都没了才在下面报失败。
    }
    let usage: {
      range?: unknown
      totals?: { request_count?: unknown }
      buckets?: Array<{ from?: unknown; request_count?: unknown }>
    } | undefined
    try {
      usage = (await getJson('https://ollama.com/api/usage?range=7d', key)) as typeof usage
    } catch {
      // 同上：有余额就够了。
    }
    let plan: string | undefined
    try {
      const me = (await getJson('https://ollama.com/api/me', key, 'POST', '{}')) as { Plan?: unknown }
      if (typeof me.Plan === 'string' && me.Plan.length > 0) plan = me.Plan
    } catch {
      // 点缀而已：整行不能因为套餐名读不到就变 error。
    }
    const days = (usage?.buckets ?? []).flatMap((bucket) => {
      const label = dayLabel(bucket.from)
      return label !== undefined && typeof bucket.request_count === 'number'
        ? [{ name: label, requestCount: bucket.request_count }]
        : []
    })
    const total = typeof usage?.totals?.request_count === 'number'
      ? usage.totals.request_count
      : days.reduce((sum, day) => sum + day.requestCount, 0)
    const hasCounts = typeof usage?.totals?.request_count === 'number' || days.length > 0
    const sessionUsed = remainingToUsed(included?.session?.remaining_percent)
    const usedPercent = remainingToUsed(included?.weekly?.remaining_percent)
    const credits = typeof included?.balance_usd === 'number' && typeof included?.allowance_usd === 'number'
      ? `剩余 $${included.balance_usd} / 额度 $${included.allowance_usd}`
      : undefined
    if (!hasCounts && sessionUsed === undefined && usedPercent === undefined && credits === undefined) {
      // 端点答了 200 但形状不认识：宁可诚实地报失败，也不要显示一行空白。
      throw new Error('ollama: 余额与用量都不可识别')
    }
    const window = rangeDays(usage?.range) ?? (days.length > 0 ? days.length : 7)
    return {
      kind: 'usage',
      plan,
      usedPercent,
      sessionUsed,
      sessionResetsAt: epochOf(included?.session?.resets_at),
      weeklyResetsAt: epochOf(included?.weekly?.resets_at),
      summary: hasCounts ? `近 ${String(window)} 天 ${total.toLocaleString()} 次请求` : credits,
      models: days,
    }
  },
}

/** DeepSeek: pay-per-token balance. */
const deepseekAdapter: UsageAdapter = {
  kind: 'balance',
  match: provider => hostIs(provider.baseURL, 'api.deepseek.com') || provider.route === 'deepseek',
  async check(key) {
    const data = (await getJson('https://api.deepseek.com/user/balance', key)) as {
      is_available?: unknown
      balance_infos?: Array<{ total_balance?: unknown; currency?: unknown }>
    }
    const first = data.balance_infos?.[0]
    return {
      kind: 'balance',
      balance: typeof first?.total_balance === 'string' && typeof first.currency === 'string'
        ? `${first.total_balance} ${first.currency}`
        : undefined,
    }
  },
}

/** Moonshot / Kimi: pay-per-token balance (same shape family as DeepSeek). */
const moonshotAdapter: UsageAdapter = {
  kind: 'balance',
  match: provider => hostIs(provider.baseURL, 'api.moonshot.cn')
    || provider.route === 'moonshot'
    || provider.route === 'kimi',
  async check(key) {
    const data = (await getJson('https://api.moonshot.cn/v1/users/me/balance', key)) as {
      is_available?: unknown
      balance_infos?: Array<{ total_balance?: unknown; currency?: unknown }>
    }
    const first = data.balance_infos?.[0]
    // total_balance may come back as a number or a decimal string; normalize.
    const total = typeof first?.total_balance === 'number'
      ? String(first.total_balance)
      : first?.total_balance
    return {
      kind: 'balance',
      balance: typeof total === 'string' && typeof first?.currency === 'string'
        ? `${total} ${first.currency}`
        : undefined,
    }
  },
}

/**
 * OpenRouter: spent vs limit from the key-detail endpoint. `limit` is the
 * prepaid credit ceiling (null/0 = pay-as-you-go, no quota to measure); when a
 * ceiling exists the spent share becomes the weekly-style meter, otherwise the
 * spent dollars ride the balance slot so the phone still shows something.
 */
const openrouterAdapter: UsageAdapter = {
  kind: 'usage',
  match: provider => hostIs(provider.baseURL, 'openrouter.ai') || provider.route === 'openrouter',
  async check(key) {
    const data = (await getJson('https://openrouter.ai/api/v1/auth/key', key)) as {
      data?: { label?: unknown; usage?: unknown; limit?: unknown; is_free_tier?: unknown }
    }
    const info = data.data
    const usage = typeof info?.usage === 'number' ? info.usage : undefined
    const limit = typeof info?.limit === 'number' ? info.limit : undefined
    const usedPercent = usage !== undefined && limit !== undefined && limit > 0
      ? Math.min(1, usage / limit)
      : undefined
    return {
      kind: 'usage',
      plan: info?.is_free_tier === true
        ? 'Free'
        : typeof info?.label === 'string' && info.label.length > 0
          ? info.label
          : undefined,
      usedPercent,
      balance: usage !== undefined ? `已消耗 $${usage.toFixed(2)}` : undefined,
    }
  },
}

/** The adapter registry — add providers that expose a balance/usage endpoint here. */
const ADAPTERS: UsageAdapter[] = [ollamaAdapter, deepseekAdapter, moonshotAdapter, openrouterAdapter]

/** Whether a base URL string's hostname equals `host`. */
function hostIs(baseURL: string | undefined, host: string): boolean {
  if (baseURL === undefined) return false
  try {
    return new URL(baseURL).hostname === host
  } catch {
    return false
  }
}

/**
 * Build the full usage surface for the configured providers.
 * @param providers - providers discovered from the host settings.
 * @param resolveKey - async resolver from a credential ref name to its value
 *   (the host credentials service) — the only seam that touches keys, and it
 *   never returns a key here.
 */
export async function buildUsageView(
  providers: UsageProviderConfig[],
  resolveKey: (refName: string) => Promise<string | undefined>,
): Promise<UsageView> {
  const fetchedAt = Date.now()
  const rows = await Promise.all(providers.map(async (provider) => {
    const base: Omit<UsageProviderView, 'status'> = {
      name: provider.displayName ?? provider.route,
      baseURL: provider.baseURL,
      kind: 'usage',
      fetchedAt,
    }
    const adapter = ADAPTERS.find(candidate => candidate.match(provider))
    if (adapter === undefined) {
      return { ...base, status: 'unsupported' as const }
    }
    if (provider.apiKeyEnv === undefined) {
      return { ...base, status: 'no-key' as const }
    }
    const key = await resolveKey(provider.apiKeyEnv)
    if (key === undefined || key === '') {
      return { ...base, status: 'no-key' as const }
    }
    try {
      const measured = await adapter.check(key)
      return {
        ...base,
        kind: measured.kind,
        status: 'ok' as const,
        plan: measured.plan,
        usedPercent: measured.usedPercent,
        sessionUsed: measured.sessionUsed,
        sessionResetsAt: measured.sessionResetsAt,
        weeklyResetsAt: measured.weeklyResetsAt,
        summary: measured.summary,
        models: measured.models,
        balance: measured.balance,
      }
    } catch {
      return { ...base, status: 'error' as const }
    }
  }))
  return { providers: rows, fetchedAt }
}
