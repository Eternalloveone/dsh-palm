// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ContextView } from './ContextView.tsx'

afterEach(() => { cleanup() })

describe('上下文占用页（P6 ⑦ 屏）', () => {
  it('三个真数字都展示出来（按 k 缩写）', () => {
    render(<ContextView contextWindow={128_000} pressureTokens={41_200} projectedTokens={58_000} onBack={() => {}} />)
    expect(screen.getByText('128.0k')).toBeDefined()
    expect(screen.getByText('41.2k')).toBeDefined()
    expect(screen.getByText('58.0k')).toBeDefined()
  })

  it('占用条按比例给档位（无行内样式）', () => {
    render(<ContextView contextWindow={100_000} pressureTokens={10_000} onBack={() => {}} />)
    const fill = document.querySelector('.context-bar-fill')
    expect(fill?.getAttribute('data-level')).toBe('1')
    expect(fill?.getAttribute('style')).toBeNull()
  })

  it('占用到 90% 换警示色并给满档', () => {
    render(<ContextView contextWindow={100_000} pressureTokens={90_000} onBack={() => {}} />)
    const fill = document.querySelector('.context-bar-fill')
    expect(fill?.getAttribute('data-level')).toBe('4')
    expect(fill?.getAttribute('data-pressure')).toBe('high')
  })

  it('宿主只给部分字段时只显示给得出的', () => {
    render(<ContextView pressureTokens={2_000} onBack={() => {}} />)
    expect(screen.getByText('2.0k')).toBeDefined()
    expect(screen.queryByText('窗口总量')).toBeNull()
    expect(document.querySelector('.context-bar')).toBeNull()
  })

  it('宿主什么都没报时给一句解释，不画空条', () => {
    render(<ContextView onBack={() => {}} />)
    expect(screen.getByText(/还没报这个会话的上下文用量/)).toBeDefined()
  })

  it('不编造三段构成（只说压缩会发生）', () => {
    render(<ContextView contextWindow={100_000} pressureTokens={50_000} onBack={() => {}} />)
    expect(document.querySelector('.context-bar')).toBeDefined()
    expect(screen.getByText(/接近上限时会自动压缩/)).toBeDefined()
  })
})
