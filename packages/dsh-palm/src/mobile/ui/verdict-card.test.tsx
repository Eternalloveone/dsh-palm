// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VerdictCard } from './verdict-card.tsx'

describe('VerdictCard（结论卡四态 · 对照稿三段式）', () => {
  it('四态各有自己的标签，且都带 data-state 供样式选顶边色带', () => {
    const cases = [
      ['conclusion', '已完成'],
      ['decision', '要你决定'],
      ['working', '正在做'],
      ['failed', '没做成'],
    ] as const
    for (const [state, label] of cases) {
      const { unmount } = render(<VerdictCard state={state} headline="成了" />)
      const card = screen.getByRole('region', { name: label })
      expect(card.getAttribute('data-state')).toBe(state)
      expect(card.textContent).toContain(label)
      // 标签行用 16px 线性 SVG，不用 ✓ 之类的字形。
      expect(card.querySelector('.verdict-tag svg')).not.toBeNull()
      unmount()
    }
  })

  it('结论句是第一个可读内容，且渲染成标题', () => {
    render(<VerdictCard state="conclusion" headline="重构已完成" detail="12 个文件" />)
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading.textContent).toBe('重构已完成')
    const text = screen.getByRole('region', { name: '已完成' }).textContent ?? ''
    expect(text.indexOf('已完成')).toBeLessThan(text.indexOf('重构已完成'))
    expect(text.indexOf('重构已完成')).toBeLessThan(text.indexOf('12 个文件'))
  })

  it('不给 detail / stats / chips 时不留空壳元素', () => {
    render(<VerdictCard state="working" headline="正在跑测试" />)
    const card = screen.getByRole('region', { name: '正在做' })
    expect(card.querySelector('.verdict-detail')).toBeNull()
    expect(card.querySelector('.verdict-stats')).toBeNull()
    expect(card.querySelector('.verdict-foot')).toBeNull()
    expect(card.querySelector('.chip')).toBeNull()
  })

  it('一行大号数字逐项渲染数字与说明（缺项由调用方省略）', () => {
    render(
      <VerdictCard
        state="conclusion"
        headline="改完了"
        stats={[{ value: '12.4s', label: '耗时' }, { value: '9', label: '文件' }]}
      />,
    )
    const stats = document.querySelector('.verdict-stats') as HTMLElement
    expect(stats.querySelectorAll(':scope > div')).toHaveLength(2)
    expect(stats.textContent).toContain('12.4s')
    expect(stats.textContent).toContain('耗时')
    expect(stats.textContent).toContain('9')
    expect(stats.textContent).toContain('文件')
  })

  it('底部彩色标签逐枚渲染，并带上 chip-ok / chip-info / chip-warn 的色调', () => {
    render(
      <VerdictCard
        state="conclusion"
        headline="改完了"
        chips={[
          { label: '12 个文件', tone: 'ok' },
          { label: '+214 / −86', tone: 'info' },
          { label: '待真机验证', tone: 'warn' },
        ]}
      />,
    )
    const chips = Array.from(document.querySelectorAll('.verdict-foot .chip'))
    expect(chips.map(chip => chip.textContent)).toEqual(['12 个文件', '+214 / −86', '待真机验证'])
    expect(chips.map(chip => chip.getAttribute('data-tone'))).toEqual(['ok', 'info', 'warn'])
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

  it('绝不生成百分比（数字必须可验证）', () => {
    render(<VerdictCard state="failed" headline="没跑通" stats={[{ value: '9s', label: '耗时' }]} />)
    const card = screen.getByRole('region', { name: '没做成' })
    expect(card.textContent).not.toContain('%')
  })
})
