// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { SessionHud } from './session-hud.tsx'

describe('SessionHud（会话 HUD 的摆放规则）', () => {
  it('三条都在：按「目标 → 排队 → 任务」排', () => {
    const { container } = render(
      <SessionHud
        goal={<span>目标A</span>}
        queue={<span>排队A</span>}
        status={<span>任务A</span>}
      />,
    )
    const hud = container.querySelector('.chat-hud')
    expect(hud).not.toBeNull()
    expect(hud?.getAttribute('data-hud-count')).toBe('3')
    const text = hud?.textContent ?? ''
    expect(text.indexOf('目标A')).toBeLessThan(text.indexOf('排队A'))
    expect(text.indexOf('排队A')).toBeLessThan(text.indexOf('任务A'))
  })

  it('只有一条在：照样渲染（不占位、不加壳）', () => {
    const { container } = render(<SessionHud status={<span>任务B</span>} />)
    expect(container.querySelector('.chat-hud')?.getAttribute('data-hud-count')).toBe('1')
    expect(container.textContent).toContain('任务B')
  })

  it('一条都没有：整块不渲染', () => {
    const { container } = render(<SessionHud />)
    expect(container.querySelector('.chat-hud')).toBeNull()
  })

  it('传进来的 null / false 也不算一条', () => {
    const { container } = render(<SessionHud goal={null} queue={false} status={<span>任务C</span>} />)
    expect(container.querySelector('.chat-hud')?.getAttribute('data-hud-count')).toBe('1')
  })
})
