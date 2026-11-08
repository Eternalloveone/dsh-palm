// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArtifactSummaryView } from './ArtifactSummaryView.tsx'
import type { ArtifactTurn } from '../session/artifacts.ts'

/** 三组产物：第 3 轮（交付物 + 工具产物）、第 2 轮、缺轮号的早期产物。 */
const turns: ArtifactTurn[] = [
  {
    turn: 3,
    files: [
      { path: 'docs/report.md', kind: 'deliverable', description: '交付报告' },
      { path: 'src/mobile/views/App.tsx', kind: 'produced' },
    ],
  },
  { turn: 2, files: [{ path: 'README.md', kind: 'produced' }] },
  { turn: undefined, files: [{ path: 'legacy/old.ts', kind: 'produced' }] },
]

afterEach(() => { cleanup() })

describe('产物摘要页（P6 ⑨ 屏）', () => {
  it('只汇总路由指定的那一轮：标题、计数与文件都只来自该轮', () => {
    render(<ArtifactSummaryView turns={turns} turn={3} onBack={() => {}} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('产物·摘要')
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('第 3 轮2 个文件')
    // 文件数并进分组标题右侧的说明，不再单独占一行。
    expect(screen.getByText('2 个文件')).toBeDefined()
    expect(screen.getByText('report.md')).toBeDefined()
    expect(screen.getByText('App.tsx')).toBeDefined()
    // 别的轮次一个文件都不许混进来。
    expect(screen.queryByText('README.md')).toBeNull()
    expect(screen.queryByText('old.ts')).toBeNull()
    expect(document.querySelectorAll('.palm-spec-row')).toHaveLength(2)
  })

  it('缺轮号的早期产物归到「更早的轮次」，不会显示第 undefined 轮', () => {
    render(<ArtifactSummaryView turns={turns} turn={undefined} onBack={() => {}} />)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('更早的轮次1 个文件')
    expect(screen.getByText('old.ts')).toBeDefined()
    expect(screen.queryByText('report.md')).toBeNull()
  })

  it('该轮没有产物时给解释与唯一动作，不是空白页', () => {
    const onBack = vi.fn()
    render(<ArtifactSummaryView turns={turns} turn={9} onBack={onBack} />)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('第 9 轮0 个文件')
    expect(screen.getByText('0 个文件')).toBeDefined()
    expect(screen.getByText('这一轮没有产出文件')).toBeDefined()
    expect(screen.getByText('回到产物列表，换一轮看看。')).toBeDefined()
    expect(document.querySelectorAll('.artifact-summary-row')).toHaveLength(0)
    screen.getByRole('button', { name: '回到产物列表' }).click()
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('点文件把完整路径交给调用方（看 diff 的活不在这一屏）', () => {
    const onOpenFile = vi.fn()
    render(<ArtifactSummaryView turns={turns} turn={3} onBack={() => {}} onOpenFile={onOpenFile} />)
    screen.getByText('report.md').closest('button')!.click()
    expect(onOpenFile).toHaveBeenCalledTimes(1)
    expect(onOpenFile).toHaveBeenCalledWith('docs/report.md')
  })

  it('交付物与工具产物用不同标签，卡片只排两行主信息', () => {
    render(<ArtifactSummaryView turns={turns} turn={3} onBack={() => {}} />)
    const delivered = screen.getByText('report.md').closest('button')
    expect(delivered?.textContent).toContain('交付物')
    // 宿主给的 description 不再占卡片行：定版图这一屏只有 名称/标签 + 路径。
    expect(delivered?.textContent).not.toContain('交付报告')
    const produced = screen.getByText('App.tsx').closest('button')
    expect(produced?.textContent).toContain('产物')
    expect(produced?.textContent).not.toContain('交付物')
  })

  it('行里只有拿得到的信息：文件名、类型、路径；不编大小与时间', () => {
    render(<ArtifactSummaryView turns={turns} turn={3} onBack={() => {}} />)
    const row = screen.getByText('report.md').closest('button')
    // 两行主信息固定：第一行文件名（右侧类型标签），第二行路径。
    expect(row?.textContent).toBe('report.mddocs/report.md交付物')
    // 产物流没有大小/时间字段：不出现 "12 KB"、"3 分钟前" 这类编出来的数。
    expect(row?.textContent).not.toMatch(/\d+\s*(KB|MB|B)\b/u)
    expect(row?.textContent).not.toMatch(/分钟|小时|天前/u)
  })

  it('摘要行与产物列表同款：左图标方块 + 文件名 / 路径 + 右侧类型标签', () => {
    render(<ArtifactSummaryView turns={turns} turn={3} onBack={() => {}} />)
    const row = screen.getByText('report.md').closest('button')!
    expect(row.classList.contains('palm-spec-row')).toBe(true)
    expect([...row.children].map(node => node.className)).toEqual([
      'palm-spec-row-ico',
      'palm-spec-row-main',
      'palm-spec-row-value',
    ])
    const main = row.children[1]!
    expect([...main.children].map(node => node.className)).toEqual(['palm-spec-row-title', 'palm-spec-row-sub'])
    // 类型标签走 data-kind，颜色在 CSS 里，屏内不写色值。
    const tag = row.querySelector('.palm-spec-tag')
    expect(tag?.getAttribute('data-kind')).toBe('ok')
  })

  it('返回按钮交回产物列表', () => {
    const onBack = vi.fn()
    render(<ArtifactSummaryView turns={turns} turn={2} onBack={onBack} />)
    screen.getByRole('button', { name: '返回' }).click()
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
