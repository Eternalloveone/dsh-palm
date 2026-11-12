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

  it('占用比例直接写在数字旁边（原来只有读屏能听到百分比）', () => {
    // 2026-11-10 上下文页实拍：148.0k / 200.0k 分两行摆着，占用条没有刻度，
    // 用户得自己心算 148/200；aria-label 里有百分比，但那只有读屏能拿到。
    render(<ContextView contextWindow={128_000} pressureTokens={41_200} onBack={() => {}} />)
    const pct = document.querySelector('.context-page-figure-pct')
    expect(pct?.textContent).toBe('32%')
    // 占用条自己的 aria-label 仍报同一个数，读屏不丢信息。
    expect(document.querySelector('.context-bar')?.getAttribute('aria-label')).toContain('32%')
  })

  // 2026-11-10 实拍发现：原来按 ceil(ratio*4) 只给 4 档宽度 —— 26% 会画成半满，
  // 74% 画成 75%，用户看到的"条子"和数字对不上。改用原生 <progress>：
  // 值就是真值，宽度由浏览器按比例算，既不需要行内样式，也不需要 4 档规则。
  it('占用条是原生 progress，值是真实用量', () => {
    render(<ContextView contextWindow={100_000} pressureTokens={26_000} onBack={() => {}} />)
    const bar = document.querySelector('progress.context-bar') as HTMLProgressElement | null
    expect(bar).not.toBeNull()
    expect(bar!.value).toBe(26_000)
    expect(bar!.max).toBe(100_000)
    // 4 档宽度规则已删：26% 不该被画成半满。
    expect(document.querySelector('.context-bar-fill')).toBeNull()
    expect(bar!.getAttribute('style')).toBeNull()
  })

  it('占用到 90% 换警示色', () => {
    render(<ContextView contextWindow={100_000} pressureTokens={90_000} onBack={() => {}} />)
    const bar = document.querySelector('progress.context-bar')
    expect(bar?.getAttribute('data-pressure')).toBe('high')
  })

  it('宿主只给部分字段时只显示给得出的', () => {
    render(<ContextView pressureTokens={2_000} onBack={() => {}} />)
    expect(screen.getByText('2.0k')).toBeDefined()
    expect(screen.queryByText('窗口总量')).toBeNull()
    expect(document.querySelector('.context-bar')).toBeNull()
  })

  it('宿主什么都没报时给一句解释，不画空条', () => {
    render(<ContextView onBack={() => {}} />)
    expect(screen.getByText(/宿主还没报上下文用量/)).toBeDefined()
  })

  it('不编造三段构成（只说压缩会发生）', () => {
    render(<ContextView contextWindow={100_000} pressureTokens={50_000} onBack={() => {}} />)
    expect(document.querySelector('.context-bar')).toBeDefined()
    expect(screen.getByText(/接近上限时会自动压缩/)).toBeDefined()
  })

  it('给出「剩余」一行：两个数字摆在一起却不给差，用户还得心算', () => {
    // 2026-11-10 上下文页实拍：148.0k「已占用」/ 200.0k「窗口总量」/ 161.5k「压缩前预计」，
    // 三个数字并列，最常被问的"还能装多少"却要自己减。剩余直接由前两个算得出，
    // 不引入任何新数据。
    render(<ContextView contextWindow={200_000} pressureTokens={148_000} onBack={() => {}} />)
    expect(screen.getByText('剩余')).toBeDefined()
    expect(screen.getByText('52.0k')).toBeDefined()
  })

  it('没有窗口总量时不给「剩余」（算不出来就不猜）', () => {
    render(<ContextView pressureTokens={2_000} onBack={() => {}} />)
    expect(screen.queryByText('剩余')).toBeNull()
  })
})
