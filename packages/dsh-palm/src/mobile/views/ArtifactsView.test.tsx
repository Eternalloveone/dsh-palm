// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArtifactsView } from './ArtifactsView.tsx'
import type { ArtifactTurn } from '../session/artifacts.ts'

const turns: ArtifactTurn[] = [
  {
    turn: 2,
    files: [
      { path: 'src/mobile/views/App.tsx', kind: 'produced' },
      { path: 'docs/report.md', kind: 'deliverable', description: '交付报告' },
    ],
  },
  { turn: 1, files: [{ path: 'README.md', kind: 'produced' }] },
]

afterEach(() => { cleanup() })

describe('产物列表页（P6 ⑧ 屏）', () => {
  it('按轮分组，最近的在前，并给出总数', () => {
    render(<ArtifactsView turns={turns} onBack={() => {}} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('产物')
    expect(screen.getByText(/3 个文件，其中 1 个是交付物/)).toBeDefined()
    const groups = [...document.querySelectorAll('.palm-spec-group-head')].map(node => node.firstChild?.textContent)
    expect(groups).toEqual(['第 2 轮', '第 1 轮'])
  })

  it('交付物有标记，工具产物没有', () => {
    render(<ArtifactsView turns={turns} onBack={() => {}} />)
    const delivered = screen.getByText('report.md').closest('button')
    expect(delivered?.textContent).toContain('交付物')
    const produced = screen.getByText('App.tsx').closest('button')
    expect(produced?.textContent).not.toContain('交付物')
  })

  it('点文件把完整路径交给调用方（去看 diff）', () => {
    const onOpenFile = vi.fn()
    render(<ArtifactsView turns={turns} onBack={() => {}} onOpenFile={onOpenFile} />)
    screen.getByText('App.tsx').closest('button')!.click()
    expect(onOpenFile).toHaveBeenCalledWith('src/mobile/views/App.tsx')
  })

  it('没有产物时给解释，不是空白页', () => {
    render(<ArtifactsView turns={[]} onBack={() => {}} />)
    expect(screen.getByText(/还没有产出文件/)).toBeDefined()
    expect(screen.getByText(/会按轮列在这里/)).toBeDefined()
  })

  it('缺轮号的老产物归到「更早」', () => {
    render(<ArtifactsView turns={[{ turn: undefined, files: [{ path: 'old.ts', kind: 'produced' }] }]} onBack={() => {}} />)
    expect(screen.getByText('更早')).toBeDefined()
  })

  it('长路径完整显示在副标题里（不丢目录）', () => {
    render(<ArtifactsView turns={turns} onBack={() => {}} />)
    expect(screen.getByText('src/mobile/views/App.tsx')).toBeDefined()
  })

  it('每行是「左图标 + 文件名 / 路径 + 类型标签」，DOM 顺序即视觉顺序', () => {
    render(<ArtifactsView turns={turns} onBack={() => {}} />)
    const row = screen.getByText('App.tsx').closest('button')!
    expect([...row.children].map(node => node.className)).toEqual([
      'palm-spec-row-ico',
      'palm-spec-row-main',
      'palm-spec-row-value',
    ])
    // 左图标是 16px 线性 SVG（尺寸由 CSS 令牌定）
    expect(row.querySelector('.palm-spec-row-ico svg')).not.toBeNull()
    const main = row.querySelector('.palm-spec-row-main')!
    expect([...main.children].map(node => node.className)).toEqual(['palm-spec-row-title', 'palm-spec-row-sub'])
    // 标签在右列：交付物绿 / 改动蓝
    expect(row.querySelector('.palm-spec-tag')?.getAttribute('data-kind')).toBe('edit')
  })

  it('分组标题可点，右侧带一个 16px 线性箭头（图标由 CSS 定尺寸）', () => {
    render(<ArtifactsView turns={turns} onBack={() => {}} />)
    const title = screen.getByText('第 2 轮').closest('button')!
    const icon = title.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(icon?.querySelector('path')?.getAttribute('d')).toBe('m10 6 6 6-6 6')
  })

  it('页脚说明已并入顶部那一句，不再占一条底栏', () => {
    render(<ArtifactsView turns={turns} onBack={() => {}} />)
    expect(document.querySelector('.artifacts-page-hint')).toBeNull()
    expect(document.querySelector('[data-slot="footer"]')).toBeNull()
  })

  it('点每轮分组标题进入这一轮的产物摘要', () => {
    const onOpenTurn = vi.fn()
    render(<ArtifactsView turns={turns} onBack={() => {}} onOpenTurn={onOpenTurn} />)
    screen.getByText('第 2 轮').closest('button')!.click()
    expect(onOpenTurn).toHaveBeenCalledTimes(1)
    expect(onOpenTurn).toHaveBeenCalledWith(2)
  })

  it('「更早」分组标题也能点进去（轮号传 undefined，摘要页据此归组）', () => {
    const onOpenTurn = vi.fn()
    render(
      <ArtifactsView
        turns={[{ turn: undefined, files: [{ path: 'old.ts', kind: 'produced' }] }]}
        onBack={() => {}}
        onOpenTurn={onOpenTurn}
      />,
    )
    screen.getByText('更早').closest('button')!.click()
    expect(onOpenTurn).toHaveBeenCalledWith(undefined)
  })
})
