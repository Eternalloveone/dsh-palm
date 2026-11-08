// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
            reasoning: {
              defaultEffort: 'medium',
              efforts: [
                { id: 'low', name: '低', description: '快' },
                { id: 'medium', name: '中', description: '均衡' },
                { id: 'high', name: '高', description: '慢而稳' },
              ],
            },
          },
          { id: 'haiku', name: 'Haiku' },
        ],
      },
      { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt', name: 'GPT' }] },
    ],
  } as unknown as SessionModels
}

afterEach(() => {
  cleanup()
  modelsFn.mockReset()
  selectFn.mockReset()
})

describe('模型与思考页（P6 ⑤ 屏）', () => {
  it('目录加载后列出模型与思考档位，并标出当前项', async () => {
    modelsFn.mockResolvedValue(catalog())
    render(<ModelView sessionId="s-1" onBack={() => {}} />)
    await waitFor(() => { expect(screen.getByText('Sonnet')).toBeDefined() })
    expect(screen.getByText('Haiku')).toBeDefined()
    expect(screen.getByText('GPT')).toBeDefined()
    // 两组标题与两段标题
    expect(screen.getByText('用哪个模型')).toBeDefined()
    expect(screen.getByText('想多久')).toBeDefined()
    // 当前模型打标
    const sonnet = screen.getByText('Sonnet').closest('button')
    expect(sonnet?.getAttribute('aria-pressed')).toBe('true')
  })

  it('默认思考档位来自模型默认值（medium）', async () => {
    modelsFn.mockResolvedValue(catalog())
    render(<ModelView sessionId="s-1" onBack={() => {}} />)
    await waitFor(() => { expect(screen.getByText('中')).toBeDefined() })
    const medium = screen.getByText('中').closest('button')
    expect(medium?.getAttribute('aria-pressed')).toBe('true')
  })

  it('点另一档思考会落选择，并回传新选择', async () => {
    modelsFn.mockResolvedValue(catalog())
    selectFn.mockImplementation((_id: string, selection: unknown) => Promise.resolve({ selected: selection }))
    const onSelected = vi.fn()
    render(<ModelView sessionId="s-1" onBack={() => {}} onSelected={onSelected} />)
    await waitFor(() => { expect(screen.getByText('高')).toBeDefined() })
    screen.getByText('高').closest('button')!.click()
    await waitFor(() => { expect(onSelected).toHaveBeenCalled() })
    expect(selectFn).toHaveBeenCalledWith('s-1', { provider: 'anthropic', model: 'sonnet', reasoningEffort: 'high' })
  })

  it('落选择失败时给一句人话，不吞错', async () => {
    modelsFn.mockResolvedValue(catalog())
    selectFn.mockRejectedValue(new Error('宿主不在线'))
    render(<ModelView sessionId="s-1" onBack={() => {}} />)
    await waitFor(() => { expect(screen.getByText('高')).toBeDefined() })
    screen.getByText('高').closest('button')!.click()
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('宿主不在线') })
  })

  it('目录读取失败时给出错误态，页面不崩', async () => {
    modelsFn.mockRejectedValue(new Error('读不到模型'))
    render(<ModelView sessionId="s-1" onBack={() => {}} />)
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('读不到模型') })
  })

  it('生效说明写清"只影响这个会话"', async () => {
    modelsFn.mockResolvedValue(catalog())
    render(<ModelView sessionId="s-1" onBack={() => {}} />)
    await waitFor(() => { expect(screen.getByText(/只影响这个会话/)).toBeDefined() })
  })
})
