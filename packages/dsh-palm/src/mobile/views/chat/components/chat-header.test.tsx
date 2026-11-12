// @vitest-environment jsdom
/**
 * 对话页头部（2026-11-08 架构收敛后）：**只有三个元素**。
 *
 * 为什么单独测：⑭ 外观页那次事故证明「页面写好了、prop 也传了，但没人调用」
 * 能一路绿到线上。顶栏收敛后返回键、列表/设置/搜索/主题四个图标都不该再出现，
 * 而 ☰ / ⋯ 必须真的可点。
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatHeader } from './chat-header.tsx'

afterEach(() => { cleanup() })

describe('对话页头部三元素', () => {
  it('只有 ☰、标题（+工作区名）、⋯：没有返回/搜索/主题/产物/模型图标', () => {
    render(<ChatHeader title="会话" workspaceName="dsh-palm" onOpenDrawer={() => {}} onMore={() => {}} />)
    expect(screen.getByRole('button', { name: '会话抽屉' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '更多' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '会话' })).toBeTruthy()
    expect(screen.getByText('dsh-palm')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '返回' })).toBeNull()
    expect(screen.queryByRole('button', { name: '搜索本会话' })).toBeNull()
    expect(screen.queryByRole('button', { name: /主题|浅色|深色/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '产物' })).toBeNull()
    expect(screen.queryByRole('button', { name: '模型与思考' })).toBeNull()
  })

  it('点 ☰ 调用 onOpenDrawer，点 ⋯ 调用 onMore', () => {
    const onOpenDrawer = vi.fn()
    const onMore = vi.fn()
    render(<ChatHeader title="会话" onOpenDrawer={onOpenDrawer} onMore={onMore} />)
    screen.getByRole('button', { name: '会话抽屉' }).click()
    screen.getByRole('button', { name: '更多' }).click()
    expect(onOpenDrawer).toHaveBeenCalledTimes(1)
    expect(onMore).toHaveBeenCalledTimes(1)
  })
})

  it('运行徽标画在标题下面那一行：右槽只剩 ⋯，标题不再被盖住', () => {
    // 2026-11-11 用户截图：「代理 4」压在会话标题上。根因是右槽是定宽 48px 的网格列，
    // 徽标比它宽就被顶到左边、正好落在标题文字上。徽标搬到第二行后，右槽只放 ⋯。
    const { container } = render(
      <ChatHeader
        title="梳理 dsh palm 源码问题评估"
        workspaceName="dsh-palm"
        onMore={() => {}}
        run={<span className="chat-run-badge">代理 4</span>}
      />,
    )
    const subRow = container.querySelector('.mobile-titlePath')
    expect(subRow).toBeTruthy()
    expect(subRow!.textContent).toContain('dsh-palm')
    expect(subRow!.textContent).toContain('代理 4')
    // 右槽里只有 ⋯：徽标不在里面，就不会再顶到标题上。
    const rightSlot = container.querySelector('.mobile-headerSlot-right')
    expect(rightSlot!.querySelector('.chat-run-badge')).toBeNull()
    expect(rightSlot!.querySelectorAll('button').length).toBe(1)
    // 标题仍是独立一行，且带截断（长标题不再溢出到徽标下面）。
    const heading = screen.getByRole('heading', { name: '梳理 dsh palm 源码问题评估' })
    expect(heading.className).toContain('mobile-title')
  })
