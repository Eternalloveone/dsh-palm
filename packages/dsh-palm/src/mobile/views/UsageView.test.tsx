// @vitest-environment jsdom
/**
 * 用量页：套餐配额（近 5 小时 / 本周）、失败重试、隐藏查不到的提供方。
 *
 * 这三条原来钉在 `SettingsView.test.tsx` 上（用量当时是设置里的一行）。2026-11-11
 * 用量整块搬到独立页（抽屉底部「用量」直接进），断言跟着搬过来并改成**页面口径**：
 * 不再有「收起 / 展开」，进页就是全部提供方的卡片。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api.ts', () => ({
  fetchUsage: vi.fn(),
}))
import { fetchUsage } from '../api.ts'
import { UsageView } from './UsageView.tsx'

const fetchUsageMock = vi.mocked(fetchUsage)

/** 一个「有真实配额」的提供方：近 5 小时 + 本周两条窗口。 */
function okProvider(overrides: Record<string, unknown> = {}) {
  return {
    name: 'ollama',
    baseURL: 'https://ollama.com/v1',
    kind: 'usage',
    status: 'ok',
    plan: 'pro',
    usedPercent: 0.459,
    sessionUsed: 0.054,
    fetchedAt: 0,
    models: [{ name: 'deepseek-v4-flash:0731', requestCount: 2934 }],
    ...overrides,
  }
}

beforeEach(() => {
  fetchUsageMock.mockReset()
  fetchUsageMock.mockResolvedValue({ providers: [okProvider()], fetchedAt: 0 } as never)
})

afterEach(() => { cleanup() })

describe('用量页', () => {
  it('进页就画出近 5 小时与本周两条窗口（不用再点一次展开）', async () => {
    render(<UsageView onBack={() => {}} />)

    // 5 小时窗口 5.4%、本周 45.9% · 余 54.1%（宿主给的是 0..1 分数，页面统一 ×100）。
    expect(await screen.findByText('近 5 小时')).toBeTruthy()
    expect(screen.getByText('5%')).toBeTruthy()
    expect(screen.getByText(/45\.9% · 余 54\.1%/)).toBeTruthy()
    expect(screen.getByText('2,934 次')).toBeTruthy()
    // 提供方没给重置时刻时，两条窗口都说明自己是滑动窗口（不编假的重置时间）。
    expect(screen.getAllByText(/窗口随请求持续滑动/).length).toBe(2)
  })

  it('「刷新」绕过宿主缓存（fetchUsage(true)）', async () => {
    render(<UsageView onBack={() => {}} />)
    await screen.findByText('近 5 小时')
    fetchUsageMock.mockClear()

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(fetchUsageMock).toHaveBeenCalledWith(true))
  })

  it('查不到余额/用量的提供方不上手机（unsupported 不渲染）', async () => {
    fetchUsageMock.mockResolvedValue({
      fetchedAt: 0,
      providers: [
        okProvider(),
        { name: 'agnes-ai', baseURL: 'https://apihub.agnes-ai.com/v1', kind: 'usage', status: 'unsupported', fetchedAt: 0 },
      ],
    } as never)
    render(<UsageView onBack={() => {}} />)

    expect(await screen.findByText('ollama')).toBeTruthy()
    expect(screen.queryByText('agnes-ai')).toBeNull()
  })

  it('重置时刻是真实时间时如实写出来（两条窗口各一句）', async () => {
    fetchUsageMock.mockResolvedValue({
      fetchedAt: 0,
      providers: [okProvider({
        usedPercent: 0.879,
        sessionUsed: 0.5,
        sessionResetsAt: Date.parse('2026-10-11T02:00:00Z'),
        weeklyResetsAt: Date.parse('2026-10-12T00:00:00Z'),
        summary: '近 7 天 9,764 次请求',
        models: [],
      })],
    } as never)
    render(<UsageView onBack={() => {}} />)

    expect(await screen.findByText('近 5 小时')).toBeTruthy()
    expect(screen.getByText('50%')).toBeTruthy()
    expect(screen.getByText(/87\.9% · 余 12\.1%/)).toBeTruthy()
    expect(screen.getAllByText(/重置于 \d{2}-\d{2} \d{2}:\d{2}/).length).toBe(2)
    expect(screen.getByText('近 7 天 9,764 次请求')).toBeTruthy()
  })

  it('读取失败如实说失败，点「重试」再拉一次', async () => {
    fetchUsageMock.mockRejectedValueOnce(new Error('boom'))
    render(<UsageView onBack={() => {}} />)

    expect(await screen.findByText(/读取用量失败/)).toBeTruthy()
    fetchUsageMock.mockResolvedValue({ providers: [okProvider()], fetchedAt: 0 } as never)
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('近 5 小时')).toBeTruthy()
  })
})
