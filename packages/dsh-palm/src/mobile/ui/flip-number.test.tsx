// @vitest-environment jsdom
/**
 * 数字滚动的行为契约（2026-11-11 用户二次拍板：要滚动、不要牌面）：
 * 1. **静止时 DOM 里只有一个数字**：不是 0-9 一整条轨道 —— 复制、读屏、测试都拿到"3"；
 * 2. 变化时临时铺开轨道，且**朝上滚**（3 → 7 经过 4、5、6），滚完收回成单独一格；
 * 3. 关掉动效的人（prefers-reduced-motion）直接看到新数字，不铺轨道、不等 480ms；
 * 4. 千分位逗号不参与滚动（不是数字就原样渲染）。
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FlipNumber } from './flip-number.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** 把 matchMedia 换成指定结果（其余方法给空壳，够组件用）。 */
function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
}

describe('FlipNumber（数字滚动）', () => {
  it('静止时只有一个数字，不是整条轨道', () => {
    const { container } = render(<FlipNumber value={3} />)
    const cells = container.querySelectorAll('.palm-roll-cell')
    expect(cells).toHaveLength(1)
    expect(container.textContent).toBe('3')
  })

  it('3 → 7 朝上滚过 4、5、6，滚完收回成单独一格', async () => {
    vi.useFakeTimers()
    stubReducedMotion(false)
    const { container, rerender } = render(<FlipNumber value={3} />)

    rerender(<FlipNumber value={7} />)
    // 铺开的轨道含起点与终点，且顺序朝上。
    const spread = [...container.querySelectorAll('.palm-roll-cell')].map(cell => cell.textContent)
    expect(spread).toEqual(['3', '4', '5', '6', '7'])

    // 两帧之后才开始滚（否则铺开与滚动同帧，浏览器直接跳到终点）。
    await act(async () => { vi.advanceTimersByTime(40) })
    const track = container.querySelector('.palm-roll-track')!
    expect(track.className).toContain('is-gliding')
    expect((track as HTMLElement).style.transform).toContain('-4')

    // 滚完收回：DOM 里只剩新数字。
    await act(async () => { vi.advanceTimersByTime(600) })
    expect([...container.querySelectorAll('.palm-roll-cell')].map(cell => cell.textContent)).toEqual(['7'])
    expect(container.querySelector('.palm-roll-track')!.className).not.toContain('is-gliding')
  })

  it('关掉动效时直接落到新数字（不铺轨道）', () => {
    vi.useFakeTimers()
    stubReducedMotion(true)
    const { container, rerender } = render(<FlipNumber value={3} />)
    rerender(<FlipNumber value={7} />)
    expect([...container.querySelectorAll('.palm-roll-cell')].map(cell => cell.textContent)).toEqual(['7'])
    expect(container.querySelector('.palm-roll-track')!.className).not.toContain('is-gliding')
  })

  it('千分位逗号原样输出，不进滚轮', () => {
    const { container } = render(<FlipNumber value={1234} />)
    expect(container.textContent).toBe('1,234')
    expect(container.querySelectorAll('.palm-roll-cell')).toHaveLength(4)
  })
})
