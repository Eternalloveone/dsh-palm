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
  balance?: string
  models?: UsageModelRow[]
}

/** A balance/usage adapter matched against a configured provider. */
interface UsageAdapter {
  kind: 'usage' | 'balance'
  /** Whether this adapter serves the provider (matched by baseURL host, then route). */
  match(provider: UsageProviderConfig): boolean
  check(key: string): Promise<ProviderUsage>
}

/** Read one JSON endpoint with bearer auth; throws on transport or HTTP failure. */
async function getJson(url: string, key: string, method: 'GET' | 'POST' = 'GET'): Promise<unknown> {
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${key}` },
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

/** Ollama Cloud: consumed-quota report + plan. Endpoints verified read-only. */
const ollamaAdapter: UsageAdapter = {
  kind: 'usage',
  match: provider => hostIs(provider.baseURL, 'ollama.com') || provider.route === 'ollama',
  async check(key) {
    const usage = (await getJson('https://ollama.com/api/usage', key)) as {
      limits?: {
        weekly?: { usage?: unknown; models?: Array<{ name?: unknown; request_count?: unknown }> }
        session?: { usage?: unknown }
      }
    }
    // /api/me is POST-only (GET answers 405) — verified read-only against the
    // live endpoint; the plan label is optional display garnish.
    const me = (await getJson('https://ollama.com/api/me', key, 'POST')) as { Plan?: unknown }
    const weekly = usage.limits?.weekly
    return {
      kind: 'usage',
      plan: typeof me.Plan === 'string' ? me.Plan : undefined,
      usedPercent: clampUnit(weekly?.usage),
      sessionUsed: clampUnit(usage.limits?.session?.usage),
      models: (weekly?.models ?? []).flatMap(model =>
        typeof model.name === 'string' && model.name.length > 0
          ? [{ name: model.name, requestCount: Number(model.request_count) || 0 }]
          : []),
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
        models: measured.models,
        balance: measured.balance,
      }
    } catch {
      return { ...base, status: 'error' as const }
    }
  }))
  return { providers: rows, fetchedAt }
}
