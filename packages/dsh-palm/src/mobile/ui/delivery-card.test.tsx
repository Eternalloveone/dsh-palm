// @vitest-environment jsdom
/**
 * 交付卡的渲染契约（版式真源 delivery-card.html A 图）：
 * 1. 卡头（✓ 交付完成 + 耗时·步数）→ 交付物行 → 改动最大的 2 个文件行 → 汇总 → 卡尾；
 * 2. 失败/中断（completed=false）与「什么都没交回」都不画卡（全页唯一卡片）；
 * 3. 增删行数按千分位格式化；同一份 tally 同时服务行内与汇总行；
 * 4. 文件行点开走既有 onOpenFile，卡尾「看全部改动」走 onOpenChanges。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeliveryCard } from './delivery-card.tsx'

afterEach(() => { cleanup() })

const CHANGES = [
  { path: 'chat/jump-window.ts', adds: 18, dels: 6 },
  { path: 'styles/240-toolbar.css', adds: 22, dels: 31 },
  { path: 'platform/budget.json', adds: 1, dels: 1 },
]

describe('DeliveryCard（交付卡）', () => {
  it('卡头 → 交付物 → 改动最大的 2 个文件 → 汇总 → 卡尾', () => {
    const { container } = render(
      <DeliveryCard
        completed
        durationMs={12_400}
        steps={7}
        deliverables={[{ path: 'docs/jump.md', description: '跳转排查说明' }]}
        changes={CHANGES}
        testsPassed={2923}
        commit="8a8e13b"
        pushed
        onOpenChanges={() => undefined}
      />,
    )
    expect(screen.getByText('交付完成')).toBeTruthy()
    expect(screen.getByText('12.4s · 7 步')).toBeTruthy()
    expect(screen.getByText('跳转排查说明')).toBeTruthy()
    // 只上卡增删总量最大的 2 个改动；第三名（budget.json）留给「看全部改动」。
    expect(screen.getByText('styles/240-toolbar.css')).toBeTruthy()
    expect(screen.getByText('chat/jump-window.ts')).toBeTruthy()
    expect(screen.queryByText('platform/budget.json')).toBeNull()
    // 行内 tally 与汇总行同源。
    expect(screen.getByText('+22')).toBeTruthy()
    expect(screen.getByText('−31')).toBeTruthy()
    expect(container.querySelector('.palm-delivery-tag')!.textContent).toBe('交付物')
    const summary = container.querySelector('.palm-delivery-sum')!.textContent ?? ''
    expect(summary).toContain('4 个文件')
    expect(summary).toContain('+41')
    expect(summary).toContain('−38')
    expect(summary).toContain('2,923 测试通过')
    // 卡尾：提交 + 已推送 + 看全部改动。
    expect(container.querySelector('.palm-delivery-foot')!.textContent).toContain('提交 8a8e13b · 已推送')
    expect(screen.getByRole('button', { name: '看全部改动 ›' })).toBeTruthy()
  })

  it('失败/中断不画卡（终态交给状态条）', () => {
    const { container } = render(
      <DeliveryCard completed={false} deliverables={[{ path: 'a.ts' }]} changes={CHANGES} />,
    )
    expect(container.querySelector('.palm-delivery')).toBeNull()
  })

  it('完成但没有任何产物/改动时不画空壳卡', () => {
    const { container } = render(<DeliveryCard completed />)
    expect(container.querySelector('.palm-delivery')).toBeNull()
  })

  it('拿不到增删行数时只给路径，不补 0；测试数/提交缺省不占位', () => {
    const { container } = render(<DeliveryCard completed changes={[{ path: 'src/a.ts' }, { path: 'src/b.ts' }]} />)
    expect(container.querySelector('.palm-delivery-tally')).toBeNull()
    const summary = container.querySelector('.palm-delivery-sum')!.textContent ?? ''
    expect(summary).toContain('2 个文件')
    expect(summary).not.toContain('+0')
    expect(container.querySelector('.palm-delivery-foot')).toBeNull()
  })

  it('文件行点开走既有 onOpenFile，只给一条回调也不崩', () => {
    const onOpenFile = vi.fn()
    const { unmount } = render(
      <DeliveryCard completed changes={[{ path: 'src/one.ts' }]} onOpenFile={onOpenFile} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '打开 src/one.ts' }))
    expect(onOpenFile).toHaveBeenCalledWith('src/one.ts')
    unmount()
    const plain = render(<DeliveryCard completed changes={[{ path: 'src/one.ts' }]} />)
    expect(plain.container.querySelector('button.palm-delivery-row')).toBeNull()
    expect(plain.container.querySelector('.palm-delivery-row')!.textContent).toContain('src/one.ts')
  })

  it('增删行数按千分位格式化', () => {
    const { container } = render(<DeliveryCard completed changes={[{ path: 'big.ts', adds: 1234, dels: 5678 }]} />)
    const tally = container.querySelector('.palm-delivery-tally')!
    expect(tally.textContent).toBe('+1,234 −5,678')
    expect(container.querySelector('.palm-delivery-sum')!.textContent).toContain('+1,234')
  })
})
