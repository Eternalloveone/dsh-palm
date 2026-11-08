// @vitest-environment jsdom
/**
 * 对话页头部入口（P6 迁出后新增）。
 *
 * 为什么要单独测：⑭ 外观页那次事故证明「页面写好了、prop 也传了，但没人调用」
 * 能一路绿到线上。头部这三个入口是 ⑤⑦⑧⑫ 的唯一入口，必须有一条
 * **点了会调用回调**的断言。
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatHeader } from './chat-header.tsx'

afterEach(() => { cleanup() })

describe('对话页头部入口', () => {
  it('给了回调才渲染产物 / 模型入口（没给就不占位置）', () => {
    render(<ChatHeader title="会话" onBack={() => {}} onToggleSearch={() => {}} onMore={() => {}} />)
    expect(screen.queryByRole('button', { name: '产物' })).toBeNull()
    expect(screen.queryByRole('button', { name: '模型与思考' })).toBeNull()
  })

  it('点「产物」调用 onOpenArtifacts', () => {
    const onOpenArtifacts = vi.fn()
    render(
      <ChatHeader
        title="会话"
        onBack={() => {}}
        onToggleSearch={() => {}}
        onMore={() => {}}
        onOpenArtifacts={onOpenArtifacts}
      />,
    )
    screen.getByRole('button', { name: '产物' }).click()
    expect(onOpenArtifacts).toHaveBeenCalledTimes(1)
  })

  it('点「模型与思考」调用 onOpenModel', () => {
    const onOpenModel = vi.fn()
    render(
      <ChatHeader
        title="会话"
        onBack={() => {}}
        onToggleSearch={() => {}}
        onMore={() => {}}
        onOpenModel={onOpenModel}
      />,
    )
    screen.getByRole('button', { name: '模型与思考' }).click()
    expect(onOpenModel).toHaveBeenCalledTimes(1)
  })

  it('原有按钮（返回 / 搜索 / 更多）不受影响', () => {
    const onBack = vi.fn()
    const onToggleSearch = vi.fn()
    const onMore = vi.fn()
    render(
      <ChatHeader
        title="会话"
        onBack={onBack}
        onToggleSearch={onToggleSearch}
        onMore={onMore}
        onOpenModel={() => {}}
        onOpenArtifacts={() => {}}
      />,
    )
    screen.getByRole('button', { name: '返回' }).click()
    screen.getByRole('button', { name: '搜索本会话' }).click()
    screen.getByRole('button', { name: '更多' }).click()
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onToggleSearch).toHaveBeenCalledTimes(1)
    expect(onMore).toHaveBeenCalledTimes(1)
  })
})
