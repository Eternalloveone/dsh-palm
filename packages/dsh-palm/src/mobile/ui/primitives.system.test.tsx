// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ActionBar, ResultRow, SectionCard, SectionHeader } from './primitives.tsx'

describe('区块标题行（SectionHeader）', () => {
  it('标题是 h2，右侧可放提示或动作', () => {
    const onAct = vi.fn()
    render(<SectionHeader title="最近通知" hint="3 条" action={{ label: '全部', onClick: onAct }} />)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('最近通知')
    expect(screen.getByText('3 条')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '全部' }))
    expect(onAct).toHaveBeenCalledTimes(1)
  })

  it('没有动作时右槽渲染提示，不渲染空按钮', () => {
    const { container } = render(<SectionHeader title="产物" hint="6 个文件" />)
    expect(container.querySelector('button')).toBeNull()
    expect(screen.getByText('6 个文件')).toBeTruthy()
  })
})

describe('区块卡（SectionCard）', () => {
  it('两级表面用 data-level 表达，页面不用自己写背景', () => {
    const { container, rerender } = render(<SectionCard title="送达情况">正文</SectionCard>)
    const card = container.querySelector('[data-section-card]')
    expect(card?.getAttribute('data-level')).toBe('surface')
    rerender(<SectionCard title="送达情况" level="raised">正文</SectionCard>)
    expect(container.querySelector('[data-section-card]')?.getAttribute('data-level')).toBe('raised')
  })

  it('有标题才有标题栏', () => {
    const { container, rerender } = render(<SectionCard title="送达情况">正文</SectionCard>)
    expect(container.querySelector('.palm-section-head')).toBeTruthy()
    rerender(<SectionCard>正文</SectionCard>)
    expect(container.querySelector('.palm-section-head')).toBeNull()
  })
})

describe('结果行（ResultRow）', () => {
  it('文件名 + 增删 + 动作在同一行；没增删就不渲染那两粒数字', () => {
    const { container, rerender } = render(
      <ResultRow name="delivery-card.tsx" added={42} removed={8} action={{ label: '看 diff', onClick: () => {} }} />,
    )
    expect(screen.getByText('delivery-card.tsx')).toBeTruthy()
    expect(screen.getByText('+42').getAttribute('data-sign')).toBe('added')
    expect(screen.getByText('−8').getAttribute('data-sign')).toBe('removed')
    expect(screen.getByRole('button', { name: '看 diff' })).toBeTruthy()
    rerender(<ResultRow name="delivery-card.tsx" />)
    expect(container.querySelector('[data-sign]')).toBeNull()
    expect(container.querySelector('button')).toBeNull()
  })
})

describe('操作条（ActionBar）', () => {
  it('主操作在前、拿到 is-primary；次操作在后', () => {
    const primary = vi.fn()
    const secondary = vi.fn()
    const { container } = render(
      <ActionBar primary={{ label: '按住 1.5 秒批准', onClick: primary }} secondary={{ label: '拒绝', onClick: secondary }} />,
    )
    const buttons = [...container.querySelectorAll('button')]
    expect(buttons.map(button => button.textContent)).toEqual(['按住 1.5 秒批准', '拒绝'])
    expect(buttons[0]?.hasAttribute('data-primary')).toBe(true)
    expect(buttons[1]?.hasAttribute('data-primary')).toBe(false)
    fireEvent.click(buttons[1]!)
    expect(secondary).toHaveBeenCalledTimes(1)
  })

  it('按钮禁用时不可点', () => {
    const onClick = vi.fn()
    render(<ActionBar primary={{ label: '批准', onClick, disabled: true }} />)
    fireEvent.click(screen.getByRole('button', { name: '批准' }))
    expect(onClick).not.toHaveBeenCalled()
  })
})
