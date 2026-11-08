// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VerdictCard } from './verdict-card.tsx'

describe('VerdictCard（结论卡四态）', () => {
  it('四态各有自己的标签，且都带 data-state 供样式选边色', () => {
    const cases = [
      ['conclusion', '结论'],
      ['decision', '要你决定'],
      ['working', '正在做'],
      ['failed', '没做成'],
    ] as const
    for (const [state, label] of cases) {
      const { unmount } = render(<VerdictCard state={state} headline="成了" />)
      const card = screen.getByRole('region', { name: label })
      expect(card.getAttribute('data-state')).toBe(state)
      expect(card.textContent).toContain(label)
      unmount()
    }
  })

  it('结论句是第一个可读内容，且渲染成标题', () => {
    render(<VerdictCard state="conclusion" headline="重构已完成" detail="12 个文件" />)
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading.textContent).toBe('重构已完成')
    const text = screen.getByRole('region', { name: '结论' }).textContent ?? ''
    expect(text.indexOf('结论')).toBeLessThan(text.indexOf('重构已完成'))
    expect(text.indexOf('重构已完成')).toBeLessThan(text.indexOf('12 个文件'))
  })

  it('不给 detail / artifacts / footnote 时不留空壳元素', () => {
    render(<VerdictCard state="working" headline="正在跑测试" />)
    const card = screen.getByRole('region', { name: '正在做' })
    expect(card.querySelector('.verdict-detail')).toBeNull()
    expect(card.querySelector('.verdict-artifacts')).toBeNull()
    expect(card.querySelector('.verdict-footnote')).toBeNull()
  })

  it('交付物条逐项渲染名字与细节', () => {
    render(
      <VerdictCard
        state="conclusion"
        headline="改完了"
        artifacts={[{ label: '3 个文件', detail: '+128 / -24' }, { label: '1 份报告' }]}
      />,
    )
    expect(screen.getByText('3 个文件')).toBeDefined()
    expect(screen.getByText(/\+128 \/ -24/)).toBeDefined()
    expect(screen.getByText('1 份报告')).toBeDefined()
  })

  it('动作最多直接摆 3 个，其余收进 ⋯ 且点开后可用', () => {
    const onRun = vi.fn()
    render(
      <VerdictCard
        state="decision"
        headline="要我继续吗"
        actions={[
          { label: '继续', onRun, primary: true },
          { label: '看看', onRun },
          { label: '取消', onRun },
          { label: '稍后', onRun },
          { label: '不用了', onRun },
        ]}
      />,
    )
    expect(screen.getByRole('button', { name: '继续' })).toBeDefined()
    expect(screen.getByRole('button', { name: '看看' })).toBeDefined()
    expect(screen.getByRole('button', { name: '取消' })).toBeDefined()
    expect(screen.queryByRole('button', { name: '稍后' })).toBeNull()
    expect(screen.queryByRole('button', { name: '不用了' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '⋯' }))
    fireEvent.click(screen.getByRole('button', { name: '稍后' }))
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('脚注只渲染真实数字，缺的整段省略', () => {
    const first = render(
      <VerdictCard state="conclusion" headline="完成" footnote={{ seconds: 42, tools: 7, tokens: 1234 }} />,
    )
    expect(screen.getByText('42s')).toBeDefined()
    expect(screen.getByText('7 次工具 · 1.2k tokens')).toBeDefined()
    first.unmount()

    render(<VerdictCard state="conclusion" headline="完成" footnote={{ seconds: 3 }} />)
    expect(screen.getByText('3s')).toBeDefined()
  })

  it('绝不生成百分比（数字必须可验证）', () => {
    render(<VerdictCard state="failed" headline="没跑通" footnote={{ seconds: 9, tools: 2 }} />)
    const card = screen.getByRole('region', { name: '没做成' })
    expect(card.textContent).not.toContain('%')
  })
})
