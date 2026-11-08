// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiffView } from './DiffView.tsx'

// 页面外壳只做排版与标题；文件内容由 FilePreviewSheet 自己取（这里不重复测它）。
vi.mock('../components/file-preview-sheet.tsx', () => ({
  FilePreviewSheet: (props: { path: string }) => <div data-testid="preview">{props.path}</div>,
}))

afterEach(() => { cleanup() })

describe('单文件 diff 页（P6 ⑩ 屏）', () => {
  it('标题只放文件名，目录单独一行', () => {
    render(<DiffView path="src/mobile/views/App.tsx" sessionId="s-1" onBack={() => {}} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('App.tsx')
    expect(screen.getByText('src/mobile/views')).toBeDefined()
  })

  it('没有目录时不留空行', () => {
    render(<DiffView path="README.md" sessionId="s-1" onBack={() => {}} />)
    expect(document.querySelector('.diff-page-path')).toBeNull()
  })

  it('按 diffLayout 出三个槽，并复用预览组件', () => {
    const { container } = render(<DiffView path="a/b.ts" sessionId="s-1" onBack={() => {}} />)
    const slots = [...container.querySelectorAll('[data-slot]')].map(node => node.getAttribute('data-slot'))
    expect(slots).toEqual(['header', 'diff', 'pager'])
    expect(screen.getByTestId('preview').textContent).toBe('a/b.ts')
  })

  it('返回按钮调用 onBack（由页面栈回到会话）', () => {
    const onBack = vi.fn()
    render(<DiffView path="a.ts" sessionId="s-1" onBack={onBack} />)
    screen.getByRole('button', { name: '返回' }).click()
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('Windows 路径也能正确取目录', () => {
    render(<DiffView path={'src\\mobile\\App.tsx'} sessionId="s-1" onBack={() => {}} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('App.tsx')
    expect(screen.getByText('src\\mobile')).toBeDefined()
  })
})
