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
    const groups = [...document.querySelectorAll('.artifacts-group-title')].map(node => node.textContent)
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
    expect(screen.getByText(/会出现在这里/)).toBeDefined()
  })

  it('缺轮号的老产物归到「更早」', () => {
    render(<ArtifactsView turns={[{ turn: undefined, files: [{ path: 'old.ts', kind: 'produced' }] }]} onBack={() => {}} />)
    expect(screen.getByText('更早')).toBeDefined()
  })

  it('长路径完整显示在副标题里（不丢目录）', () => {
    render(<ArtifactsView turns={turns} onBack={() => {}} />)
    expect(screen.getByText('src/mobile/views/App.tsx')).toBeDefined()
  })
})
