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
