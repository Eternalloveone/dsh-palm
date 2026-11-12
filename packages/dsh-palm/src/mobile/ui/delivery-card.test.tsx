// @vitest-environment jsdom
/**
 * 交付卡的渲染契约（版式真源 delivery-card.html A 图 + handoff P4「四态一骨架」）：
 * 1. 卡头（✓ 交付完成 + 步数）→ 交付物行 → 改动最大的 2 个文件行 → 汇总 → 卡尾；
 * 2. 四态各有明确文案：running / success / failure / unknown —— 未知字段不得猜成功；
 * 3. success 但什么都没交回时不画空壳卡；failure / unknown 即使没有文件也要画（那是这一轮的结论）；
 * 4. 增删行数按千分位格式化；同一份 tally 同时服务行内与汇总行；
 * 5. 文件行点开走既有 onOpenFile，卡尾「看全部改动」走 onOpenChanges。
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
        state="success"
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
    expect(container.querySelector('.palm-delivery')!.getAttribute('data-state')).toBe('success')
    // 卡头只报步数：这一轮的时长只在任务头状态条里说一次（卡面不再重复）。
    expect(screen.getByText('7 步')).toBeTruthy()
    expect(container.textContent).not.toMatch(/\d+分\d+秒|\d+(\.\d+)?s\b/)
    expect(container.querySelector('.palm-delivery-time')).toBeNull()
    expect(screen.getByText('跳转排查说明')).toBeTruthy()
    // 只上卡增删总量最大的 2 个改动；第三名（budget.json）留给「看全部改动」。
    // 2026-11-10：卡只有 288px，行内只显示**文件名**（完整路径去交付详情页看）。
    expect(screen.getByText('240-toolbar.css')).toBeTruthy()
    expect(screen.getByText('jump-window.ts')).toBeTruthy()
    expect(screen.queryByText('budget.json')).toBeNull()
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

  it('失败态：画「没做成」而不是「交付完成」，并给出失败原因与重试入口', () => {
    const onRetry = vi.fn()
    const { container } = render(
      <DeliveryCard
        state="failure"
        changes={CHANGES}
        reason="宿主在「跑测试」这一步断开"
        onRetry={onRetry}
      />,
    )
    expect(container.querySelector('.palm-delivery')!.getAttribute('data-state')).toBe('failure')
    expect(screen.getByText('没做成')).toBeTruthy()
    expect(screen.queryByText('交付完成')).toBeNull()
    expect(container.textContent).toContain('宿主在「跑测试」这一步断开')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    // 改过的文件照样列出来：失败也要能看见「动了哪些东西」。
    expect(container.textContent).toContain('240-toolbar.css')
  })

  it('失败态即使没有任何文件也画卡（那是这一轮的结论，不能悄悄消失）', () => {
    const { container } = render(<DeliveryCard state="failure" />)
    expect(container.querySelector('.palm-delivery')).not.toBeNull()
    expect(screen.getByText('没做成')).toBeTruthy()
  })

  it('未知态：不猜成功，标题是「结局未知」且没有「交付完成」', () => {
    const { container } = render(<DeliveryCard state="unknown" />)
    expect(container.querySelector('.palm-delivery')!.getAttribute('data-state')).toBe('unknown')
    expect(screen.getByText('结局未知')).toBeTruthy()
    expect(screen.queryByText('交付完成')).toBeNull()
    expect(container.textContent ?? '').not.toContain('✓')
  })

  it('进行中：不写「交付完成」，只报步数与已产生的改动', () => {
    const { container } = render(<DeliveryCard state="running" steps={3} changes={CHANGES} />)
    expect(container.querySelector('.palm-delivery')!.getAttribute('data-state')).toBe('running')
    expect(screen.getByText('进行中')).toBeTruthy()
    expect(screen.queryByText('交付完成')).toBeNull()
    expect(container.textContent).toContain('3 步')
  })

  it('完成但没有任何产物/改动时不画空壳卡', () => {
    const { container } = render(<DeliveryCard state="success" />)
    expect(container.querySelector('.palm-delivery')).toBeNull()
  })

  it('拿不到增删行数时只给路径，不补 0；测试数/提交缺省不占位', () => {
    const { container } = render(<DeliveryCard state="success" changes={[{ path: 'src/a.ts' }, { path: 'src/b.ts' }]} />)
    expect(container.querySelector('.palm-delivery-tally')).toBeNull()
    const summary = container.querySelector('.palm-delivery-sum')!.textContent ?? ''
    expect(summary).toContain('2 个文件')
    expect(summary).not.toContain('+0')
    // 2026-11-10：汇总与「看全部改动」合成同一行卡尾；没有提交信息就只不画那一段。
    expect(container.querySelector('.palm-delivery-foot')!.textContent).not.toContain('提交')
  })

  it('文件行点开走既有 onOpenFile，只给一条回调也不崩', () => {
    const onOpenFile = vi.fn()
    const { unmount } = render(
      <DeliveryCard state="success" changes={[{ path: 'src/one.ts' }]} onOpenFile={onOpenFile} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '打开 src/one.ts' }))
    expect(onOpenFile).toHaveBeenCalledWith('src/one.ts')
    unmount()
    const plain = render(<DeliveryCard state="success" changes={[{ path: 'src/one.ts' }]} />)
    expect(plain.container.querySelector('button.palm-delivery-row')).toBeNull()
    expect(plain.container.querySelector('.palm-delivery-row')!.textContent).toContain('one.ts')
  })

  it('增删行数按千分位格式化', () => {
    const { container } = render(<DeliveryCard state="success" changes={[{ path: 'big.ts', adds: 1234, dels: 5678 }]} />)
    const tally = container.querySelector('.palm-delivery-tally')!
    expect(tally.textContent).toBe('+1,234 −5,678')
    expect(container.querySelector('.palm-delivery-sum')!.textContent).toContain('+1,234')
  })
})
