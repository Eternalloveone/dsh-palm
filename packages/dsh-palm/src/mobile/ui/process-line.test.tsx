// @vitest-environment jsdom
/**
 * 过程折叠行的渲染契约（版式真源 overview.html「2 · 会话正文」）：
 * 1. 「▸ 7 步过程 · 31 次工具调用」：步数与工具调用数分开报，缺项少说一项；
 * 2. 两个计数都拿不到时退回状态词（`已完成`），不编数字；
 * 3. 展开状态与回调都由既有过程组传入（本组件不持有状态）：点整行走 onToggle；
 * 4. 运行中才显示「最近 3 步」，超出只留最后 3 条；
 * 5. 不给 onToggle 时是不可点的静态行（role=status，没有 aria-expanded）。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProcessLine } from './process-line.tsx'

afterEach(() => { cleanup() })

describe('ProcessLine（过程折叠行）', () => {
  it('主文案：步数 + 工具调用数，缺一项就少说一项', () => {
    const { container, unmount } = render(<ProcessLine steps={7} toolCalls={31} />)
    expect(container.querySelector('.palm-proc-main')!.textContent).toBe('7 步过程 · 31 次工具调用')
    unmount()
    const onlyCalls = render(<ProcessLine toolCalls={31} />)
    expect(onlyCalls.container.querySelector('.palm-proc-main')!.textContent).toBe('31 次工具调用')
    onlyCalls.unmount()
    const onlySteps = render(<ProcessLine steps={7} />)
    expect(onlySteps.container.querySelector('.palm-proc-main')!.textContent).toBe('7 步过程')
  })

  it('两个计数都拿不到时退回状态词，不编数字', () => {
    const { container } = render(<ProcessLine label="已完成" time="用时6分24秒" />)
    expect(container.querySelector('.palm-proc-main')!.textContent).toBe('已完成')
    expect(container.querySelector('.palm-proc-time')!.textContent).toBe('用时6分24秒')
    expect(container.textContent).not.toContain('工具调用')
    expect(container.textContent).not.toContain('步过程')
  })

  it('点击整行走既有 onToggle；展开状态是受控的（▸ / ▾）', () => {
    const onToggle = vi.fn()
    const { container, rerender } = render(<ProcessLine toolCalls={3} expanded={false} onToggle={onToggle} />)
    const line = container.querySelector('button.palm-proc') as HTMLButtonElement
    expect(line.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('.palm-proc-caret')!.textContent).toBe('▸')
    fireEvent.click(line)
    expect(onToggle).toHaveBeenCalledTimes(1)
    rerender(<ProcessLine toolCalls={3} expanded onToggle={onToggle} />)
    expect(container.querySelector('button.palm-proc')!.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('.palm-proc-caret')!.textContent).toBe('▾')
  })

  it('运行中才显示「最近 3 步」，只留最后 3 条', () => {
    const { container, unmount } = render(
      <ProcessLine toolCalls={9} running recent={['读 a.ts', '改 b.ts', '跑测试', '改 c.ts']} />,
    )
    expect(container.querySelector('.palm-proc-recent')!.textContent).toBe('最近：改 b.ts · 跑测试 · 改 c.ts')
    unmount()
    const settled = render(<ProcessLine toolCalls={9} recent={['读 a.ts']} />)
    expect(settled.container.querySelector('.palm-proc-recent')).toBeNull()
  })

  it('不给 onToggle 时是静态行；计数按千分位格式化', () => {
    const { container } = render(<ProcessLine toolCalls={1234} note="2 处报错" />)
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('[role="status"]')).not.toBeNull()
    expect(container.querySelector('.palm-proc-main')!.textContent).toBe('1,234 次工具调用')
    expect(container.querySelector('.palm-proc-note')!.textContent).toBe('2 处报错')
    expect(screen.queryByRole('button')).toBeNull()
  })
})
