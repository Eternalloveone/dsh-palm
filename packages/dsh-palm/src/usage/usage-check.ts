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
  /**
   * 这行数字到底是什么（`账户余额` / `已用` / `额度`）。
   *
   * 中转站只给得了「累计已用」，给不了「还能用多少」：一律写成「账户余额」时，
   * `$517` 会被读成「我还有 517 美元」（真机截图就是这么误读的）。
   */
  balanceLabel?: string
  /**
   * 失败原因（`失败` 之外的一句话）。
   *
   * 以前只有「失败」两个字：key 无效、接口下线（410）、超时在界面上长得一模一样，
   * 用户没法判断该去改 key 还是等到明天。适配器把原因带上来。
   */
  detail?: string
  /**
   * 该提供方的控制台计费页（`不支持` 的行给一个能点的地方）。
   *
   * 云厂商的用量要 AK/SK 签名或云账号，手机端做不了 —— 与其显示一句冷冰冰的
   * 「不支持」，不如直接把人送到能看的地方。
   */
  consoleUrl?: string
  /** Epoch millis when this row was measured. */
  fetchedAt: number
}

/** 从 `getJson` 的错误串里取出 HTTP 状态码（`HTTP 401 (GET) from …`）。 */
function httpStatusOf(error: unknown): number | undefined {
  const text = error instanceof Error ? error.message : String(error)
  const status = /HTTP (\d{3})/.exec(text)?.[1]
  return status === undefined ? undefined : Number(status)
}

/**
 * 把适配器抛出的错误翻成一句能行动的话。
 *
 * `getJson` 的错误串形如 `HTTP 401 (GET) from https://…`：401 是 key 无效、402 是余额
 * 不足、410 是接口下线、超时是网络。只写「失败」的时候这四种长得一模一样。
 */
export function describeUsageError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const status = /HTTP (\d{3})/.exec(text)?.[1]
  if (status === '401' || status === '403') return `API Key 无效或没有权限（${status}）`
  if (status === '402') return '余额不足（402）'
  if (status === '410') return '该接口已下线（410）'
  if (status === '429') return '查询太频繁，稍后再试（429）'
  if (status !== undefined) return `查询失败（HTTP ${status}）`
  if (/timed? ?out|aborted/i.test(text)) return '查询超时，检查网络'
  return '查询失败，稍后重试'
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
  balanceLabel?: string
  summary?: string
  models?: UsageModelRow[]
  /** 这一行如果失败/不支持，给一句原因。 */
  detail?: string
}

/**
 * 该提供方**没有**可查的用量接口（不是查询失败）。
 *
 * 上行据此把它标成 `unsupported` 而不是 `error`：浏览器里「接口不存在」和「key 错了」
 * 是两件完全不同的事。
 */
export class NoUsageEndpointError extends Error {
  constructor() {
    super('no usage endpoint')
    this.name = 'NoUsageEndpointError'
  }
}

/** A balance/usage adapter matched against a configured provider. */
interface UsageAdapter {
  kind: 'usage' | 'balance'
  /** Whether this adapter serves the provider (matched by baseURL host, then route). */
  match(provider: UsageProviderConfig): boolean
  /**
   * 量一次这个提供方的余额/用量。`provider` 给那些「同一个 baseURL、不同路由对应不同
   * 套餐」的提供方用（OpenCode Console 与 OpenCode Go 就是这种）。
   */
  check(key: string, provider: UsageProviderConfig): Promise<ProviderUsage>
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

/**
 * OpenCode（Console / Go）—— 官方**没有**余额或额度查询接口：文档明确写着"在 console
 * 里看用量"，公开 API 只有推理端点。可它把每次请求的花费直接写进推理响应：
 *
 *   usage: { prompt_tokens, completion_tokens, cost,
 *            opencode: { billing_source: 'balance'|'go'|'free'|'byok',
 *                        list_cost, allowance, tokens: {...} } }
 *
 * 也就是说"用量"只能**逐次响应**累计，没有任何一次 GET 能问出"还剩多少"。
 *
 * 所以这一行只报能真报的两件事，绝不编一个余额数字：
 *  ①用 `/inference/v1/models`（Go 是 `/inference/go/v1/models`）验证 key —— 200 说明
 *    key 有效，顺手数出可用模型数；
 *  ②按路由给出套餐形态（Go 订阅 / 按量付费），并如实说明"余额请去控制台看"。
 *
 * 真要做"本月花了多少"，得在宿主侧把每次响应的 `usage.opencode` 累加进本地账本 ——
 * 那是另一条链路（需要宿主配合），不在这一行能解决的范围内。
 */
const opencodeAdapter: UsageAdapter = {
  kind: 'usage',
  match: provider => hostIs(provider.baseURL, 'opencode.ai')
    || provider.route === 'opencode'
    || provider.route === 'opencode-go'
    || provider.route === 'zen'
    || provider.route === 'opencode-zen',
  async check(key, provider) {
    const go = provider.route === 'opencode-go'
    const url = go
      ? 'https://opencode.ai/inference/go/v1/models'
      : 'https://opencode.ai/inference/v1/models'
    const data = (await getJson(url, key)) as { data?: unknown }
    const models = Array.isArray(data.data) ? data.data.length : undefined
    const plan = go ? 'Go 订阅' : 'Console 按量付费'
    // 模型数是"可用性"事实，不是用量；余额/额度官方不给查，就明说去哪看。
    const head = models === undefined
      ? 'key 有效'
      : `key 有效 · 可用模型 ${models} 个`
    return {
      kind: 'usage',
      plan,
      summary: `${head} · 余额与额度请在 opencode.ai/console 查看`,
    }
  },
}

/**
 * OpenCode **Go 订阅**：有真正的用量接口（2026-10-28 实测）。
 *
 *   GET https://opencode.ai/inference/go/v1/usage   （Bearer oc_sk_…）
 *   → { usage: {
 *         rolling: { status, percent, resetsAt },   // 5 小时窗口
 *         weekly:  { status, percent, resetsAt },   // 每周
 *         monthly: { status, percent, resetsAt } } }// 每月
 *
 * `percent` 是**已用**百分比（0..100，与 Go 文档里 5h=20%、周=50%、月=100% 的额度模型
 * 一致）。这比按量付费那条（官方没有余额接口，只能验 key + 数模型）强得多：直接把三条
 * 进度条和重置时刻都填上。
 *
 * 按量付费（`opencode` 路由）没有这个接口 —— 那条走下面的 models 校验。
 */
const opencodeGoAdapter: UsageAdapter = {
  kind: 'usage',
  match: provider => provider.route === 'opencode-go',
  async check(key) {
    type Window = { status?: unknown; percent?: unknown; resetsAt?: unknown }
    const data = (await getJson('https://opencode.ai/inference/go/v1/usage', key)) as {
      usage?: { rolling?: Window; weekly?: Window; monthly?: Window }
    }
    const used = (window: Window | undefined): number | undefined => {
      const percent = window?.percent
      if (typeof percent !== 'number' || !Number.isFinite(percent)) return undefined
      return Math.min(1, Math.max(0, percent / 100))
    }
    const rolling = used(data.usage?.rolling)
    const weekly = used(data.usage?.weekly)
    const monthly = used(data.usage?.monthly)
    if (rolling === undefined && weekly === undefined && monthly === undefined) {
      throw new Error('opencode-go: 用量的三个窗口都不可识别')
    }
    const pct = (value: number | undefined): string => value === undefined ? '-' : `${Math.round(value * 100)}%`
    return {
      kind: 'usage',
      plan: 'Go',
      // 主进度条用「每周」，会话条用「5 小时窗口」，与桌面端两个窗口的语义对齐。
      usedPercent: weekly,
      sessionUsed: rolling,
      sessionResetsAt: epochOf(data.usage?.rolling?.resetsAt),
      weeklyResetsAt: epochOf(data.usage?.weekly?.resetsAt),
      // 每月额度没有独立字段，放进摘要里（重置时刻一并给出）。
      summary: `5 小时 ${pct(rolling)} · 本周 ${pct(weekly)} · 本月 ${pct(monthly)}`,
    }
  },
}

/**
 * **通用「中转站」账单适配器**（one-api / new-api 系）。
 *
 * 国内一大批「模型聚合 / API 中转」都是这两个开源网关的分支，它们统一实现了 OpenAI
 * 兼容的两张表（2026-10-28 用真实 key 实测 Agnes 与 ModelFlare 均 200）：
 *
 *   GET {origin}/v1/dashboard/billing/subscription → { hard_limit_usd, soft_limit_usd, … }
 *   GET {origin}/v1/dashboard/billing/usage        → { total_usage }   // 美元，已花
 *
 * 所以它排在注册表**最后**当兜底：前面那些厂商适配器都没命中时才试它。命中就给出
 * 「已用 $x / 上限 $y」；`hard_limit_usd` 常见 1e8（等于没有上限）时只报已用。
 *
 * 两条都 404/非 JSON 说明这家不是中转站 —— 抛 `NoUsageEndpointError`，上行映射成
 * 「不支持」（而不是「失败」），界面语义才对。
 */
const relayBillingAdapter: UsageAdapter = {
  kind: 'balance',
  match: provider => typeof provider.baseURL === 'string' && /^https?:\/\//.test(provider.baseURL),
  async check(key, provider) {
    const base = (provider.baseURL ?? '').replace(/\/+$/, '')
    const origin = base.replace(/\/v1$/, '')
    const prefix = `${origin}/v1`
    type Subscription = { hard_limit_usd?: unknown; soft_limit_usd?: unknown }
    type Usage = { total_usage?: unknown }
    let subscription: Subscription | undefined
    let usage: Usage | undefined
    try {
      subscription = (await getJson(`${prefix}/dashboard/billing/subscription`, key)) as Subscription
    } catch (error) {
      // 只有「404 / 压根不是这个接口」才算「这家不是中转站」。
      // 401/403/402/429/5xx 是**真的出事了**：照实往上抛，界面才能说清是 key 无效还是余额不足
      // （以前一律当成「不支持」，用户换了 key 也还是「不支持」，等于把问题藏起来）。
      const status = httpStatusOf(error)
      if (status !== undefined && status !== 404) throw error
    }
    if (subscription === undefined) throw new NoUsageEndpointError()
    try {
      usage = (await getJson(`${prefix}/dashboard/billing/usage`, key)) as Usage
    } catch {
      // 配额读到了、用量没读到：至少还能显示上限。
    }
    const spent = typeof usage?.total_usage === 'number' && Number.isFinite(usage.total_usage)
      ? usage.total_usage
      : undefined
    const hard = typeof subscription.hard_limit_usd === 'number' && Number.isFinite(subscription.hard_limit_usd)
      ? subscription.hard_limit_usd
      : undefined
    // 1e8 这类天文数字是 one-api 的「不限额」约定，别拿它算百分比。
    const capped = hard !== undefined && hard > 0 && hard < 1e7
    const usedPercent = capped && spent !== undefined ? Math.min(1, Math.max(0, spent / hard)) : undefined
    const usd = (value: number): string => `$${value.toFixed(value >= 100 ? 0 : 2)}`
    const parts: string[] = []
    if (spent !== undefined) parts.push(`已用 ${usd(spent)}`)
    if (capped && hard !== undefined) parts.push(`上限 ${usd(hard)}`)
    if (parts.length === 0) throw new NoUsageEndpointError()
    return {
      kind: 'balance',
      plan: '中转站',
      balance: spent !== undefined ? usd(spent) : undefined,
      // 这是**累计已花**，不是余额。写成余额会把 $517 读成「还剩 517」。
      // 标签只写「累计已用」（2026-10-29 用户要求去掉「（自开户）」：这句话对读者没用，
      // 反而让标签变长、在小屏上挤掉金额）。
      balanceLabel: spent !== undefined ? '累计已用' : '额度上限',
      usedPercent,
      summary: capped ? parts.join(' / ') : `${parts.join(' / ')}（无额度上限）`,
    }
  },
}

/**
 * 各家「控制台计费页」。用于给那些**结构上查不到**的提供方一个可落地的去处：
 * 云厂商要 AK/SK 签名，闭源厂商只给控制台。按 hostname 后缀匹配，最长优先。
 */
const CONSOLE_URLS: ReadonlyArray<{ host: string; url: string }> = [
  { host: 'api.deepseek.com', url: 'https://platform.deepseek.com/usage' },
  { host: 'api.moonshot.cn', url: 'https://platform.moonshot.cn/console/info' },
  { host: 'openrouter.ai', url: 'https://openrouter.ai/settings/credits' },
  { host: 'ollama.com', url: 'https://ollama.com/settings/keys' },
  { host: 'opencode.ai', url: 'https://opencode.ai/console' },
  { host: 'api.siliconflow.cn', url: 'https://cloud.siliconflow.cn/account/ak' },
  { host: 'bigmodel.cn', url: 'https://bigmodel.cn/usercenter/proj-mgmt/usage' },
  { host: 'dashscope.aliyuncs.com', url: 'https://bailian.console.aliyun.com/' },
  { host: 'volces.com', url: 'https://console.volcengine.com/ark' },
  { host: 'hunyuan.tencentcloudapi.com', url: 'https://console.cloud.tencent.com/hunyuan' },
  { host: 'api.openai.com', url: 'https://platform.openai.com/usage' },
  { host: 'api.anthropic.com', url: 'https://console.anthropic.com/settings/usage' },
  { host: 'generativelanguage.googleapis.com', url: 'https://console.cloud.google.com/billing' },
  { host: 'api.mistral.ai', url: 'https://console.mistral.ai/usage' },
  { host: 'api.groq.com', url: 'https://console.groq.com/dashboard/usage' },
  { host: 'api.x.ai', url: 'https://console.x.ai/' },
  { host: 'api.together.xyz', url: 'https://api.together.xyz/settings/billing' },
  { host: 'api.fireworks.ai', url: 'https://fireworks.ai/account/billing' },
  { host: 'api.cerebras.ai', url: 'https://cloud.cerebras.ai/' },
  { host: 'openai.azure.com', url: 'https://portal.azure.com/#view/Microsoft_Azure_CostManagement' },
  { host: 'amazonaws.com', url: 'https://console.aws.amazon.com/billing/home' },
]

/**
 * 路由名 → 控制台。用在**没有 baseURL** 的 provider 上：DeepSeek 官方、OpenCode Go
 * 在路由表里只有 key 的环境变量名，按 host 匹配永远匹配不到，界面上就是「没有深链」。
 */
const CONSOLE_BY_ROUTE: Readonly<Record<string, string>> = {
  'deepseek': 'https://platform.deepseek.com/usage',
  'deepseek-official': 'https://platform.deepseek.com/usage',
  'opencode': 'https://opencode.ai/console',
  'opencode-go': 'https://opencode.ai/console',
  'opencode-zen': 'https://opencode.ai/console',
  'moonshot': 'https://platform.moonshot.cn/console/info',
  'kimi': 'https://platform.moonshot.cn/console/info',
  'ollama': 'https://ollama.com/settings/keys',
  'openrouter': 'https://openrouter.ai/settings/credits',
  'siliconflow': 'https://cloud.siliconflow.cn/account/ak',
  'zhipu': 'https://bigmodel.cn/usercenter/proj-mgmt/usage',
  'openai': 'https://platform.openai.com/usage',
  'anthropic': 'https://console.anthropic.com/settings/usage',
}

/**
 * 已知「官方把余额接口关掉了」的提供方 → 一句实话。
 *
 * 硅基流动 2026-08-14 正式下线 `/user/info`，国内区至今没有替代接口（余额转成券，只在
 * 控制台看）。这种情况写「官方没有可查的接口」没错但太笼统 —— 用户会以为是我们的问题，
 * 反复换 key。把日期和去处写清楚。
 */
const UNSUPPORTED_NOTES: ReadonlyArray<{ host: string; note: string }> = [
  {
    host: 'siliconflow.cn',
    note: '官方 2026-08-14 已下线余额接口（余额转为券），请到控制台查看',
  },
]

/** 该提供方「查不到」的具体原因（没有就 undefined）。 */
export function unsupportedNoteOf(baseURL: string | undefined, route?: string): string | undefined {
  if (baseURL !== undefined) {
    try {
      const host = new URL(baseURL).hostname
      const hit = UNSUPPORTED_NOTES.find(entry => host === entry.host || host.endsWith(`.${entry.host}`))
      if (hit !== undefined) return hit.note
    } catch {
      // 地址畸形：按路由兜底
    }
  }
  if (route === 'siliconflow') return UNSUPPORTED_NOTES[0]?.note
  return undefined
}

/** 该提供方的控制台计费页（没有就 undefined）。先按 baseURL 的 host，再按路由名兜底。 */
export function consoleUrlOf(baseURL: string | undefined, route?: string): string | undefined {
  const byRoute = route === undefined ? undefined : CONSOLE_BY_ROUTE[route]
  if (baseURL === undefined) return byRoute
  let host: string
  try {
    host = new URL(baseURL).hostname
  } catch {
    return byRoute
  }
  const hit = CONSOLE_URLS.find(entry => host === entry.host || host.endsWith(`.${entry.host}`))
  return hit?.url ?? byRoute
}

/** The adapter registry — add providers that expose a balance/usage endpoint here. */
const ADAPTERS: UsageAdapter[] = [
  ollamaAdapter,
  deepseekAdapter,
  moonshotAdapter,
  openrouterAdapter,
  // `opencode-go` 必须先于 `opencode`：前者有真正的用量接口，后者是按量付费。
  opencodeGoAdapter,
  opencodeAdapter,
  // 兜底必须最后：前面都没命中时，才把这家当 one-api/new-api 中转站试一试。
  relayBillingAdapter,
]

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
    const consoleUrl = consoleUrlOf(provider.baseURL, provider.route)
    const withConsole = consoleUrl === undefined ? {} : { consoleUrl }
    const adapter = ADAPTERS.find(candidate => candidate.match(provider))
    if (adapter === undefined) {
      return { ...base, ...withConsole, status: 'unsupported' as const }
    }
    if (provider.apiKeyEnv === undefined) {
      return { ...base, ...withConsole, status: 'no-key' as const }
    }
    const key = await resolveKey(provider.apiKeyEnv)
    if (key === undefined || key === '') {
      return { ...base, ...withConsole, status: 'no-key' as const }
    }
    try {
      const measured = await adapter.check(key, provider)
      return {
        ...base,
        ...withConsole,
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
        balanceLabel: measured.balanceLabel,
      }
    } catch (error) {
      // 接口不存在 ≠ 查询失败：标「不支持」并把控制台地址带上。
      if (error instanceof NoUsageEndpointError) {
        return {
          ...base,
          ...withConsole,
          status: 'unsupported' as const,
          detail: unsupportedNoteOf(provider.baseURL, provider.route) ?? '官方没有可查的余额/用量接口',
        }
      }
      return { ...base, ...withConsole, status: 'error' as const, detail: describeUsageError(error) }
    }
  }))
  return { providers: rows, fetchedAt }
}
