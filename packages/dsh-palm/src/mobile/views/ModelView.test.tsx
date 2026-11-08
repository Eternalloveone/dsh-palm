// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionModels } from '../../api-proxy-types'

const modelsFn = vi.fn()
const selectFn = vi.fn()

vi.mock('../data/settings.ts', () => ({
  models: (sessionId: string) => modelsFn(sessionId),
  selectModel: (sessionId: string, selection: unknown) => selectFn(sessionId, selection),
}))

const { ModelView } = await import('./ModelView.tsx')

/** 造一份模型目录：两个 provider、三个模型，其中 sonnet 支持三档思考。 */
function catalog(): SessionModels {
  return {
    current: { provider: 'anthropic', model: 'sonnet' },
    groups: [
      {
        id: 'anthropic',
        name: 'Anthropic',
        models: [
          {
            id: 'sonnet',
            name: 'Sonnet',
            description: '日常首选，快而稳',
            reasoning: {
              defaultEffort: 'medium',
              efforts: [
                { id: 'low', name: '低', description: '更快' },
                { id: 'medium', name: '中', description: '均衡' },
                { id: 'high', name: '高', description: '慢而稳' },
              ],
            },
          },
          { id: 'haiku', name: 'Haiku', description: '最省' },
        ],
      },
      { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt', name: 'GPT' }] },
    ],
  } as unknown as SessionModels
}

/** 目录读得通，但宿主一个模型都没报（空态）。 */
function emptyCatalog(): SessionModels {
  return { current: { provider: 'none', model: 'none' }, groups: [] } as unknown as SessionModels
}

afterEach(() => {
  cleanup()
  modelsFn.mockReset()
  selectFn.mockReset()
})

describe('模型与思考页（P6 ⑤ 屏 · 定版视觉）', () => {
  it('顶部当前模型卡写清名字与说明，右侧只有一个「切换」入口', async () => {
    modelsFn.mockResolvedValue(catalog())
    render(<ModelView sessionId="s-1" onBack={() => {}} />)
    expect(await screen.findByText('Sonnet')).toBeDefined()
    expect(screen.getByText('日常首选，快而稳')).toBeDefined()
    const toggle = screen.getByRole('button', { name: '切换' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('思考强度是三档分段选择器，默认选中模型默认档（中）', async () => {
    modelsFn.mockResolvedValue(catalog())
    render(<ModelView sessionId="s-1" onBack={() => {}} />)
    const group = await screen.findByRole('group', { name: '思考强度' })
    expect(within(group).getAllByRole('button')).toHaveLength(3)
    expect(within(group).getByRole('button', { name: /^中/ }).getAttribute('aria-pressed')).toBe('true')
    expect(within(group).getByRole('button', { name: /^低/ }).getAttribute('aria-pressed')).toBe('false')
    expect(within(group).getByRole('button', { name: /^高/ }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText(/档位越高想得越久/)).toBeDefined()
  })

  it('点另一档思考会落选择、回传新选择，选中态跟着走', async () => {
    modelsFn.mockResolvedValue(catalog())
    selectFn.mockImplementation((_id: string, selection: unknown) => Promise.resolve({ selected: selection }))
    const onSelected = vi.fn()
    render(<ModelView sessionId="s-1" onBack={() => {}} onSelected={onSelected} />)
    await screen.findByRole('group', { name: '思考强度' })
    fireEvent.click(screen.getByRole('button', { name: /^高/ }))
    await waitFor(() => { expect(onSelected).toHaveBeenCalled() })
    expect(selectFn).toHaveBeenCalledWith('s-1', { provider: 'anthropic', model: 'sonnet', reasoningEffort: 'high' })
    await waitFor(() => { expect(screen.getByRole('button', { name: /^高/ }).getAttribute('aria-pressed')).toBe('true') })
    expect(screen.getByRole('button', { name: /^中/ }).getAttribute('aria-pressed')).toBe('false')
  })

  it('点「切换」才展开模型列表；选另一个模型落选择并收起列表', async () => {
    modelsFn.mockResolvedValue(catalog())
    selectFn.mockImplementation((_id: string, selection: unknown) => Promise.resolve({ selected: selection }))
    render(<ModelView sessionId="s-1" onBack={() => {}} />)
    await screen.findByText('Sonnet')
    // 平时不展开：列表里的 Haiku 不该占地方
    expect(screen.queryByText('Haiku')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '切换' }))
    fireEvent.click(await screen.findByRole('button', { name: /Haiku/ }))
    await waitFor(() => { expect(selectFn).toHaveBeenCalledWith('s-1', { provider: 'anthropic', model: 'haiku' }) })
    // 选完自动收起：卡片换成 Haiku，列表里的那一行不在了
    await waitFor(() => { expect(screen.getByText('Haiku')).toBeDefined() })
    expect(screen.queryByRole('button', { name: /Haiku/ })).toBeNull()
  })

  it('目录空的时候给空态与重新加载，不是一片空白', async () => {
    modelsFn.mockResolvedValue(emptyCatalog())
    render(<ModelView sessionId="s-1" onBack={() => {}} />)
    expect(await screen.findByText('还没有可选的模型')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await waitFor(() => { expect(modelsFn).toHaveBeenCalledTimes(2) })
  })

  it('落选择失败时给一句人话，不吞错', async () => {
    modelsFn.mockResolvedValue(catalog())
    selectFn.mockRejectedValue(new Error('宿主不在线'))
    render(<ModelView sessionId="s-1" onBack={() => {}} />)
    await screen.findByRole('group', { name: '思考强度' })
    fireEvent.click(screen.getByRole('button', { name: /^高/ }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('宿主不在线') })
  })

  it('目录读取失败时给出错误态，页面不崩', async () => {
    modelsFn.mockRejectedValue(new Error('读不到模型'))
    render(<ModelView sessionId="s-1" onBack={() => {}} />)
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('读不到模型') })
  })

  it('加载失败时给重试入口，点了会重新拉一次（不让人重进页面）', async () => {
    modelsFn.mockRejectedValueOnce(new Error('boom'))
    render(<ModelView sessionId="s1" onBack={() => {}} />)
    const retry = await screen.findByText('重新加载')
    modelsFn.mockResolvedValueOnce(catalog())
    fireEvent.click(retry)
    await waitFor(() => { expect(modelsFn).toHaveBeenCalledTimes(2) })
  })

  it('生效说明写清"只影响这个会话"', async () => {
    modelsFn.mockResolvedValue(catalog())
    render(<ModelView sessionId="s-1" onBack={() => {}} />)
    await waitFor(() => { expect(screen.getByText(/只影响这个会话/)).toBeDefined() })
  })
})
