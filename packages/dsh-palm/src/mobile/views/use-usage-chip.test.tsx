// @vitest-environment jsdom
/**
 * 「换模型 → 抽屉用量同时换」的行为契约（2026-11-14 用户原话：
 * 「我在输入框下方切换完模型之后，侧边栏的『用量』也要同时切换成当前模型的本周或者
 * 本月已用用量值」）。
 *
 * 钉三件事：
 * ① 换到另一家时，数字**立刻**变（不依赖那次真查询——内存里已经有那家的行）；
 * ② 新模型那家查不到数字时如实退回「余额」，不留旧家的数字冒充；
 * ③ 换的是别的会话，不动当前这一行。
 */
import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsageView } from '../mobile-types.ts'
import { announceModelSwitch, resetModelSwitchForTests } from '../platform/model-switch.ts'
import { useUsageChip, resetUsageChipForTests } from './use-usage-chip.ts'

const models = vi.fn()
const fetchUsage = vi.fn()
vi.mock('../data/settings.ts', () => ({ models: (...args: unknown[]) => models(...args) }))
vi.mock('../data/usage.ts', () => ({ fetchUsage: (...args: unknown[]) => fetchUsage(...args) }))

const view = (): UsageView => ({
  fetchedAt: 0,
  providers: [
    { name: 'Go', route: 'opencode-go', kind: 'usage', status: 'ok', usedPercent: 0.32, monthlyUsed: 0.96, fetchedAt: 0 },
    { name: 'DeepSeek 官方', route: 'deepseek', kind: 'balance', status: 'ok', balance: '23.05 CNY', fetchedAt: 0 },
  ],
})

let chip: string | undefined
function Harness({ sessionId, warmSessionId }: { sessionId: string | undefined; warmSessionId?: string }): null {
  chip = useUsageChip(sessionId, warmSessionId)
  return null
}

const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve() }) }

beforeEach(() => {
  chip = undefined
  localStorage.clear()
  resetModelSwitchForTests()
  resetUsageChipForTests()
  models.mockReset()
  fetchUsage.mockReset()
  models.mockResolvedValue({ current: { provider: 'opencode-go', model: 'm' }, routable: true, groups: [], failures: [] })
  fetchUsage.mockResolvedValue(view())
})

describe('useUsageChip：换模型后同时切换', () => {
  it('只有 warmSessionId（抽屉没开）时也会先把数字算出来并存下', async () => {
    // 回归：预热路径曾把 targetRef 记成 sessionId（undefined），结果预热结果被
    // "这已经不是当前那一行"挡掉，抽屉永远停在「余额」。
    // 用真计时器等满预热延迟（3s）：假计时器和 act 的微任务顺序会让这条断言假绿。
    render(<Harness sessionId={undefined} warmSessionId="s-1" />)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 3_400)) })
    expect(chip).toBe('本月已用 96%')
    expect(localStorage.getItem('dsh.palm.usageChip.v2')).toBe('本月已用 96%')
  }, 15_000)

  it('换到另一家时数字立刻跟着换（不等真查询）', async () => {
    render(<Harness sessionId="s-1" />)
    await flush()
    await flush()
    expect(chip).toBe('本月已用 96%')
    // 换模型：广播先到，宿主查询故意挂住不给结果 —— 界面必须已经变了。
    fetchUsage.mockReturnValue(new Promise(() => {}))
    act(() => { announceModelSwitch({ sessionId: 's-1', provider: 'deepseek', model: 'deepseek-flash' }) })
    expect(chip).toBe('余额 ¥23.05')
  })

  it('新模型那家查不到数字时退回「余额」，不留旧家的数字', async () => {
    render(<Harness sessionId="s-1" />)
    await flush()
    await flush()
    expect(chip).toBe('本月已用 96%')
    models.mockResolvedValue({
      current: { provider: 'modelflare', model: 'x' }, routable: true, groups: [], failures: [],
    })
    fetchUsage.mockResolvedValue({
      fetchedAt: 0,
      providers: [{ name: 'modelflare', route: 'modelflare', kind: 'usage', status: 'error', fetchedAt: 0 }],
    })
    await act(async () => {
      announceModelSwitch({ sessionId: 's-1', provider: 'modelflare', model: 'x' })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(chip).toBeUndefined()
  })

  it('换完之后紧跟的那次真查询就算目录还答旧 provider，也不能把数字顶回去', async () => {
    // 实测踩过（2026-11-14）：点完模型 104ms 小字已换成新那家，随后补的那次查询
    // 因为宿主 session.models 还没落盘、仍答旧 provider，把数字改回旧那家。
    render(<Harness sessionId="s-1" />)
    await flush()
    await flush()
    expect(chip).toBe('本月已用 96%')
    // 目录滞后：仍然说当前是 opencode-go，而用量面里两家都在。
    models.mockResolvedValue({ current: { provider: 'opencode-go', model: 'm' }, routable: true, groups: [], failures: [] })
    fetchUsage.mockResolvedValue(view())
    await act(async () => {
      announceModelSwitch({ sessionId: 's-1', provider: 'deepseek', model: 'deepseek-flash' })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(chip).toBe('余额 ¥23.05')
  })

  it('别的会话换了模型，当前这一行不动', async () => {
    render(<Harness sessionId="s-1" />)
    await flush()
    await flush()
    act(() => { announceModelSwitch({ sessionId: 's-2', provider: 'deepseek', model: 'deepseek-flash' }) })
    expect(chip).toBe('本月已用 96%')
  })
})
