/**
 * 抽屉「用量」那一行右侧的小字：**当前模型所在那家**的余额/用量数字。
 *
 * ## 为什么不是写死的「余额」
 *
 * 2026-11-14 用户：「这个『余额』我想让它显示当前模型所在的 coding plan 或者 api
 * 接口的具体余额或者用量数字」。原来那两个字是纯装饰（`session-drawer.tsx` 里写死），
 * 而数字其实早就有 —— 用量页要跑的那套 `mobile.usage` 适配器已经按提供方把余额、
 * 每周/5 小时配额、甚至中转站累计已花都查回来了。缺的只有两件事：
 *
 * ①**对上是哪一家**：模型目录给的 provider id 是路由键（`opencode-go`、
 *   `deepseek-official`），而用量行的 `name` 可能是 displayName（「DeepSeek 官方」）。
 *   所以宿主侧补了 `route`，这里再按 route → name 的顺序对齐；
 * ②**怎么压成一个 46px 行高里塞得下的短语**：「本周 32%」「¥23.05」「已用 $0.49」。
 *   完整口径仍在用量页，这里只放**一眼能读**的那个数。
 *
 * ## 查不到就退回「余额」
 *
 * `unsupported` / `no-key` / `error` 一律不编数字（那正是用量页花大力气区分开的三种
 * 情况）：退回原来的「余额」两个字。宁可少一个数，也不给一个错数。
 *
 * @module dsh-palm/mobile/views/drawer-usage
 */
import type { UsageProviderView, UsageView } from '../mobile-types.ts'

/** 模型目录的 provider id → 用量行路由键（两边叫法不同的那几家）。 */
const ROUTE_ALIASES: Readonly<Record<string, string>> = {
  // llm-deepseek 命名空间在用量侧统一叫 deepseek（见 mobile/api/mobile-usage.ts）。
  'deepseek-official': 'deepseek',
  // 「DeepSeek Account」是 llm-pi-ai 里另起的一条 deepseek 路由，余额是**同一个账户**，
  // 所以它也该报同一个数（实测 2026-11-14：这家在用量面上没有独立行）。
  'deepseek-account': 'deepseek',
  'opencode-zen': 'opencode',
  'zen': 'opencode',
  'kimi': 'moonshot',
}

/** 币种代码 → 符号（只收真实出现过的；不认识就照原样拼）。 */
const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  CNY: '¥',
  RMB: '¥',
  USD: '$',
  EUR: '€',
}

/**
 * 一行用量里**最该显示的那个数**（没有可显示的给 undefined，调用方退回「余额」）。
 *
 * @param provider - 用量行（可能是 undefined：当前模型那家没被查到）
 * @returns 短语，例如 `本周 32%` / `¥23.05` / `已用 $0.49`
 */
export function usageChipText(provider: UsageProviderView | undefined): string | undefined {
  // 只有真的量到东西才给数字：失败/未配置/不支持都退回「余额」。
  if (provider === undefined || provider.status !== 'ok') return undefined
  if (provider.kind === 'balance') {
    const money = compactMoney(provider.balance)
    if (money === undefined) return undefined
    // 「累计已用」不是余额：写成「已用 $x」，否则 $0.49 会被读成「还剩 0.49」。
    if (provider.balanceLabel === '累计已用') return `已用 ${money}`
    // 其余（没有标签 / 自定义标签）尽量把「这是什么」也说出来：光一个 `¥23.05`
    // 同样会被读成已花。自定义标签跟着用量页的文案走。
    if (provider.balanceLabel !== undefined && provider.balanceLabel !== '') {
      return `${provider.balanceLabel} ${money}`
    }
    return `余额 ${money}`
  }
  // coding plan：报的是**已用**比例（0..1 的分数，见 mobile-types 的单位铁律）。
  // 2026-11-14 用户第二版：「本周 32% 不够明显，我还以为是还剩这么多」——所以方向词
  // 必须写出来（「已用」），不能靠读者猜是已用还是剩余。
  // 同日第三版：「切换完模型之后要显示当前模型的本周或者本月已用值」——所以窗口取
  // **最紧的那个**：本月 96% 而本周 32% 时，先撞墙的是本月，报本周等于报了个平安。
  const tightest = tightestWindow(provider)
  if (tightest !== undefined) return `${tightest.label}已用 ${percentText(tightest.used)}`
  // 没有配额百分比但有一句短事实（如 `Go 订阅`）：塞得下才用，塞不下就退回「余额」——
  // 46px 的行宽里把「近 7 天 27,845 次请求」切成「近 7 天 27,84…」比不给更糟。
  if (provider.summary !== undefined && provider.summary !== '' && provider.summary.length <= 10) {
    return provider.summary
  }
  return undefined
}

/** `0.32` → `32%`（四舍五入到整数；已用比例是 0..1 的分数）。 */
function percentText(fraction: number): string {
  const clamped = Math.min(1, Math.max(0, fraction))
  return `${String(Math.round(clamped * 100))}%`
}

/**
 * 三个配额窗口里**最紧**的那一个（已用比例最高的）。
 *
 * 为什么不是固定「本周」：Go 这类套餐是 5 小时 / 本周 / 本月三段同时管，本月 96%
 * 而本周 32% 时，先撞墙的是本月；固定报本周等于报了个平安。
 *
 * 平手时偏向**更长的窗口**（本月 > 本周 > 5 小时）：同样是 50%，本月 50% 说明后面
 * 半个月没得用，更值得先看见。
 *
 * @param provider - 一条已量到数字的用量行
 * @returns 窗口名与已用比例；三个窗口都没有时给 undefined
 */
function tightestWindow(provider: UsageProviderView): { label: string; used: number } | undefined {
  const windows: Array<{ label: string; used: number | undefined }> = [
    { label: '5 小时', used: provider.sessionUsed },
    { label: '本周', used: provider.usedPercent },
    { label: '本月', used: provider.monthlyUsed },
  ] 

  let best: { label: string; used: number } | undefined
  for (const window of windows) {
    if (window.used === undefined) continue
    // `>=`：平手让后出现的长窗口赢（顺序就是短→长）。
    if (best === undefined || window.used >= best.used) best = { label: window.label, used: window.used }
  }
  return best
}

/**
 * `23.05 CNY` → `¥23.05`、`$0.49` → `$0.49`。
 *
 * 货币代码换成符号，并把「.00」这类尾零去掉（抽屉里那点宽度经不起 `110.00 CNY`）。
 */
function compactMoney(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const text = raw.trim()
  if (text === '') return undefined
  let amount = text
  let symbol = ''
  const trailing = /^(.*?)\s*([A-Z]{3})$/.exec(text)
  if (trailing !== null && trailing[1] !== undefined && trailing[2] !== undefined) {
    amount = trailing[1].trim()
    symbol = CURRENCY_SYMBOLS[trailing[2]] ?? ` ${trailing[2]}`
  } else if (text.startsWith('$') || text.startsWith('¥') || text.startsWith('€')) {
    // 适配器里已经带了符号的（中转站/OpenRouter 的 `$3.20`）原样用。
    return text.replace(/\.00$/, '')
  }
  return `${symbol}${amount.replace(/\.00$/, '')}`
}

/**
 * 当前模型对应哪一行用量。
 *
 * 对齐顺序：`route` 精确 → `route` 别名 → `name`。都对不上时，只有**恰好一家**查到了
 * 数字才用它（单提供方配置的常规情况）；多于一家就不知道是谁了，交回「余额」。
 *
 * @param view - 宿主给的用量面
 * @param providerId - 会话模型目录里的 `current.provider`
 * @returns 匹配到的用量行
 */
export function pickUsageProvider(
  view: UsageView | undefined,
  providerId: string | undefined,
): UsageProviderView | undefined {
  const rows = view?.providers ?? []
  if (providerId !== undefined && providerId !== '') {
    const key = providerId.toLowerCase()
    const alias = ROUTE_ALIASES[key]
    const hit = rows.find((row) => {
      const route = row.route?.toLowerCase()
      if (route !== undefined && (route === key || route === alias)) return true
      return row.name.toLowerCase() === key || (alias !== undefined && row.name.toLowerCase() === alias)
    })
    if (hit !== undefined) return hit
    return undefined
  }
  const ok = rows.filter(row => row.status === 'ok')
  return ok.length === 1 ? ok[0] : undefined
}

/** 上一次查到的短语存在哪：抽屉一开就能先显示，不必每次等 3 秒的查询。
 *  `.v2`：2026-11-14 把「本周 32%」改成「本周已用 32%」，旧值里的方向是含糊的，
 *  宁可当没存过让它重查，也不让旧格式再露一次脸。 */
const CHIP_KEY = 'dsh.palm.usageChip.v2'

/** 读上次存下的短语；坏数据当没有（绝不因此让抽屉打不开）。 */
export function readCachedUsageChip(): string | undefined {
  try {
    const raw = localStorage.getItem(CHIP_KEY)
    return raw === null || raw === '' ? undefined : raw
  } catch {
    return undefined
  }
}

/** 存下这次查到的短语（下一次冷启动第一眼就有数）。 */
export function writeCachedUsageChip(text: string | undefined): void {
  try {
    if (text === undefined) localStorage.removeItem(CHIP_KEY)
    else localStorage.setItem(CHIP_KEY, text)
  } catch {
    // 隐私模式/配额满：少一个数字而已，不影响抽屉。
  }
}
