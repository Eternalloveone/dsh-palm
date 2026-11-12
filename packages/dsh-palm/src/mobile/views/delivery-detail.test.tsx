// @vitest-environment jsdom
/**
 * 交付详情页的渲染契约（设计稿 overview.html「3 · 交付详情」）：
 * - 三个分组：交付物 / 新增 / 修改，标题带条数；空组整组不画；
 * - 行内 +A −D 真实格式化；点击行回传文件路径（由 App 走既有 diff 路由）；
 * - 每组超过 5 条才折叠，默认只展开第一组。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DeliveryDetailView } from './DeliveryDetailView.tsx'
import type { TurnDeliveryFacts } from '../render/message-row.tsx'

afterEach(() => { cleanup() })

/** 一份可控的回合事实：只填本用例关心的字段。 */
function facts(overrides: Partial<TurnDeliveryFacts> = {}): TurnDeliveryFacts {
  return {
    turn: 3,
    durationMs: 12_400,
    deliverables: [],
    changes: [],
    ...overrides,
  }
}

function renderView(input: Partial<TurnDeliveryFacts> = {}, testsPassed?: number) {
  const opened: string[] = []
  const { container } = render(
    <DeliveryDetailView
      facts={facts(input)}
      {...(testsPassed === undefined ? {} : { testsPassed })}
      onBack={() => {}}
      onOpenFile={(path: string) => { opened.push(path) }}
    />,
  )
  return { opened, container }
}

describe('交付详情页', () => {
  it('按交付物 / 新增 / 修改三组渲染，标题带真实条数', () => {
    const { container } = renderView({
      deliverables: [{ path: 'docs/report.md', description: '交付报告' }],
      changes: [
        { path: 'src/a.ts', adds: 96, dels: 0 },
        { path: 'src/b.ts', adds: 6, dels: 12 },
      ],
    })
    expect(screen.getByText('交付物 · 1')).toBeTruthy()
    expect(screen.getByText('新增 · 1')).toBeTruthy()
    expect(screen.getByText('修改 · 1')).toBeTruthy()
    expect(screen.getByText('交付报告')).toBeTruthy()
    // 两行式：第一行文件名，第二行路径（2026-11-10 实机排版修正）。
    const files = [...container.querySelectorAll('.palm-dd-file')].map(node => node.textContent)
    const dirs = [...container.querySelectorAll('.palm-dd-dir')].map(node => node.textContent)
    expect(files).toContain('a.ts')
    expect(files).toContain('b.ts')
    expect(dirs).toContain('src')
  })

  it('空分组整组不画', () => {
    renderView({ changes: [{ path: 'src/a.ts', adds: 1, dels: 0 }] })
    expect(screen.queryByText(/^交付物/)).toBeNull()
    expect(screen.queryByText(/^修改/)).toBeNull()
    expect(screen.getByText('新增 · 1')).toBeTruthy()
  })

  it('点交付物行或修改行都回传文件路径', () => {
    const { opened } = renderView({
      deliverables: [{ path: 'docs/report.md' }],
      changes: [{ path: 'src/b.ts', adds: 6, dels: 12 }],
    })
    fireEvent.click(screen.getByText('report.md'))
    fireEvent.click(screen.getByText('b.ts'))
    expect(opened).toEqual(['docs/report.md', 'src/b.ts'])
  })

  it('+A −D 按千分位格式化，新增只有 +N、修改是 +A 与 −D', () => {
    const { container } = renderView({
      changes: [
        { path: 'src/new.ts', adds: 2923, dels: 0 },
        { path: 'src/edit.ts', adds: 6, dels: 12 },
      ],
    })
    const added = container.querySelectorAll('.palm-dd-tally')
    expect(added[0]?.textContent).toBe('+2,923')
    expect(added[1]?.textContent).toBe('+6−12')
    expect(container.querySelectorAll('.palm-dd-add').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.palm-dd-del').length).toBeGreaterThan(0)
  })

  it('超过 5 条才折叠：第一组默认展开，其余组先露 5 条、可展开可收起', () => {
    const sixDeliverables = Array.from({ length: 6 }, (_, index) => ({ path: `docs/d${index}.md` }))
    const sevenChanges = Array.from({ length: 7 }, (_, index) => ({ path: `src/e${index}.ts`, adds: 1, dels: 1 }))
    const { container } = renderView({ deliverables: sixDeliverables, changes: sevenChanges })
    const visibleNames = (): string[] => [...container.querySelectorAll('.palm-dd-file')].map(node => node.textContent ?? '')
    // 第一组（交付物）默认展开：6 条全在。
    expect(visibleNames().filter(name => name.startsWith('d'))).toHaveLength(6)
    // 修改组默认收起：只露前 5 条。
    expect(visibleNames().filter(name => name.startsWith('e'))).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: '展开全部' }))
    expect(visibleNames().filter(name => name.startsWith('e'))).toHaveLength(7)
    // 展开后两个组都可「收起」：按 DOM 顺序点第一组的那个。
    fireEvent.click(screen.getAllByRole('button', { name: '收起' })[0]!)
    expect(visibleNames().filter(name => name.startsWith('d'))).toHaveLength(5)
  })

  it('顶部汇总给文件数 / 增删 / 测试通过；拿不到测试数就不画那一项', () => {
    const { container } = renderView({
      deliverables: [{ path: 'docs/report.md' }],
      changes: [
        { path: 'src/a.ts', adds: 96, dels: 0 },
        { path: 'src/b.ts', adds: 6, dels: 12 },
      ],
    }, 2923)
    const sum = container.querySelector('.palm-dd-sum')!.textContent ?? ''
    expect(sum).toContain('3')
    expect(sum).toContain('个文件')
    expect(sum).toContain('+102')
    expect(sum).toContain('−12')
    expect(sum).toContain('2,923')
    expect(sum).toContain('测试通过')

    cleanup()
    renderView({ changes: [{ path: 'src/a.ts', adds: 1, dels: 0 }] })
    expect(screen.queryByText(/测试通过/)).toBeNull()
  })
})
