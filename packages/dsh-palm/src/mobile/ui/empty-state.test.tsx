// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EmptyState } from './empty-state.tsx'

afterEach(() => { cleanup() })

describe('空态（P6 ⑯）', () => {
  it('一句人话 + 可选说明', () => {
    render(<EmptyState title="这次会话还没有产出文件" hint="改动过的文件会出现在这里。" />)
    expect(screen.getByText('这次会话还没有产出文件')).toBeDefined()
    expect(screen.getByText('改动过的文件会出现在这里。')).toBeDefined()
  })

  it('没有动作就不渲染按钮区（不给假入口）', () => {
    render(<EmptyState title="还没有内容" />)
    expect(document.querySelector('.empty-state-action')).toBeNull()
  })

  it('有动作时渲染出来', () => {
    render(<EmptyState title="还没有会话" action={<button type="button">新建</button>} />)
    expect(document.querySelector('.empty-state-action button')?.textContent).toBe('新建')
  })

  it('对读屏是状态而不是正文噪声（role=status）', () => {
    render(<EmptyState title="还没有内容" />)
    expect(document.querySelector('.empty-state')?.getAttribute('role')).toBe('status')
  })
})
