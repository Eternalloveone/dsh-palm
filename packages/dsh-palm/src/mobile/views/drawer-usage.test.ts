/**
 * 抽屉「用量」行的小字：挑对提供方 + 压成一个短语（2026-11-14）。
 *
 * 钉住四件事：
 * ① 当前模型那家优先（route 精确、route 别名、name 兜底）；
 * ② 查不到/失败/不支持一律不给数字（退回「余额」）；
 * ③ 单位口径：`usedPercent` 是 0..1 的分数，32% 不能画成 3200%；
 * ④ 「累计已用」不能被读成余额。
 */
import { describe, expect, it } from 'vitest'
import { pickUsageProvider, usageChipText } from './drawer-usage.ts'
import type { UsageProviderView, UsageView } from '../mobile-types.ts'

const row = (patch: Partial<UsageProviderView>): UsageProviderView => ({
  name: 'provider',
  kind: 'usage',
  status: 'ok',
  fetchedAt: 0,
  ...patch,
})

const view = (...providers: UsageProviderView[]): UsageView => ({ providers, fetchedAt: 0 })

describe('pickUsageProvider', () => {
  it('按 route 精确对上当前模型的提供方（即使 name 是 displayName）', () => {
    const deepseek = row({ name: 'DeepSeek 官方', route: 'deepseek', kind: 'balance', balance: '23.05 CNY' })
    const others = row({ name: 'ollama', route: 'ollama', usedPercent: 0.99 })
    expect(pickUsageProvider(view(others, deepseek), 'deepseek')).toBe(deepseek)
  })

  it('模型 id 与用量路由叫法不同的那几家走别名（deepseek-official → deepseek）', () => {
    const deepseek = row({ name: 'DeepSeek 官方', route: 'deepseek', kind: 'balance', balance: '1.00 CNY' })
    expect(pickUsageProvider(view(deepseek), 'deepseek-official')).toBe(deepseek)
  })

  it('「DeepSeek Account」是同一个 DeepSeek 账户，报同一行', () => {
    const deepseek = row({ name: 'DeepSeek 官方', route: 'deepseek', kind: 'balance', balance: '1.00 CNY' })
    expect(pickUsageProvider(view(deepseek), 'deepseek-account')).toBe(deepseek)
  })

  it('老宿主没有 route 字段时按 name 兜底', () => {
    const ollama = row({ name: 'ollama', usedPercent: 0.5 })
    expect(pickUsageProvider(view(ollama), 'ollama')).toBe(ollama)
  })

  it('对不上任何一行就不猜（返回 undefined，抽屉退回「余额」）', () => {
    const a = row({ name: 'agnes-ai', route: 'agnes-ai', kind: 'balance', balance: '$0.49' })
    const b = row({ name: 'ollama', route: 'ollama', usedPercent: 0.5 })
    expect(pickUsageProvider(view(a, b), 'modelflare')).toBeUndefined()
  })

  it('不知道当前模型时，只有一家查到数字才敢用它', () => {
    const a = row({ name: 'agnes-ai', route: 'agnes-ai', kind: 'balance', balance: '$0.49' })
    const b = row({ name: 'modelflare', route: 'modelflare', status: 'error' })
    expect(pickUsageProvider(view(a, b), undefined)).toBe(a)
    expect(pickUsageProvider(view(a, row({ name: 'ollama', route: 'ollama', usedPercent: 0.5 })), undefined)).toBeUndefined()
  })
})

describe('usageChipText', () => {
  it('coding plan 把方向词写出来：0.32 → 「本周已用 32%」（不是 3200%，也不是「还剩 32%」）', () => {
    // 2026-11-14 用户：「本周 32% 不够明显，我还以为是还剩这么多」。
    expect(usageChipText(row({ usedPercent: 0.32 }))).toBe('本周已用 32%')
  })

  it('三个窗口里挑最紧的那个：本月 96% 压过本周 32% 和 5 小时 6%', () => {
    // 2026-11-14 用户：「显示当前模型的本周或者本月已用用量值」——先撞墙的是本月。
    expect(usageChipText(row({ sessionUsed: 0.06, usedPercent: 0.32, monthlyUsed: 0.96 })))
      .toBe('本月已用 96%')
  })

  it('本月不是最紧时不抢镜：本周 70% / 本月 20% 报本周', () => {
    expect(usageChipText(row({ usedPercent: 0.7, monthlyUsed: 0.2 }))).toBe('本周已用 70%')
  })

  it('没有本月字段的老宿主照旧只看两个窗口', () => {
    expect(usageChipText(row({ sessionUsed: 0.85, usedPercent: 0.32 }))).toBe('5 小时已用 85%')
  })

  it('平手时偏向更长的窗口（同样是 50%，本月更值得先看见）', () => {
    expect(usageChipText(row({ usedPercent: 0.5, monthlyUsed: 0.5 }))).toBe('本月已用 50%')
  })

  it('余额把货币代码换成符号、去掉 .00 尾零，并说清是余额：23.05 CNY → 余额 ¥23.05', () => {
    expect(usageChipText(row({ kind: 'balance', balance: '23.05 CNY' }))).toBe('余额 ¥23.05')
    expect(usageChipText(row({ kind: 'balance', balance: '110.00 CNY' }))).toBe('余额 ¥110')
  })

  it('自定义标签跟着用量页的文案走（额度上限 100）', () => {
    expect(usageChipText(row({ kind: 'balance', balance: '100.00', balanceLabel: '额度上限' }))).toBe('额度上限 100')
  })

  it('中转站的「累计已用」写成「已用 $x」，不能被读成余额', () => {
    // 中转站适配器给的 balance 已经是 `$0.49` 这种带符号串（见 usage-check 的 usd()）。
    expect(usageChipText(row({ kind: 'balance', balance: '$0.49', balanceLabel: '累计已用' }))).toBe('已用 $0.49')
  })

  it('已经带符号的金额原样用（$3.20）', () => {
    expect(usageChipText(row({ kind: 'balance', balance: '$3.20' }))).toBe('余额 $3.20')
  })

  it('没有百分比时只收短事实（塞不下就不给，别切一半数字）', () => {
    expect(usageChipText(row({ summary: 'Go 订阅' }))).toBe('Go 订阅')
    expect(usageChipText(row({ summary: '近 7 天 27,845 次请求' }))).toBeUndefined()
  })

  it('失败/未配置/不支持/没有这一行：一律不给数字', () => {
    expect(usageChipText(undefined)).toBeUndefined()
    expect(usageChipText(row({ status: 'error' }))).toBeUndefined()
    expect(usageChipText(row({ status: 'no-key', kind: 'balance', balance: '1 CNY' }))).toBeUndefined()
    expect(usageChipText(row({ status: 'unsupported' }))).toBeUndefined()
  })

  it('数值缺字段时给 undefined，不画空串', () => {
    expect(usageChipText(row({ kind: 'balance' }))).toBeUndefined()
  })
})
