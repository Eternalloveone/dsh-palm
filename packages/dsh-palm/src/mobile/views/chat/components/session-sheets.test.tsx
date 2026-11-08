// @vitest-environment jsdom
/**
 * ⋯ 菜单（`single-surface.html` B 图）：五个入口，**没数据源就不画**。
 *
 * 这条负断言是防"死按钮"的：以前顶栏四个图标常驻，点开是空的；现在每一项
 * 都必须带着数据或回调才出现。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatMoreMenu } from './session-sheets.tsx'

afterEach(() => { cleanup() })

function renderMenu(overrides: Partial<Parameters<typeof ChatMoreMenu>[0]> = {}): void {
  render(<ChatMoreMenu open onClose={() => {}} {...overrides} />)
}

describe('会话 ⋯ 菜单', () => {
  it('数据齐全时是五项：产物 / 会话内搜索 / 导出 / 主题 / 设置', () => {
    renderMenu({
      artifactCount: 3,
      onOpenArtifacts: () => {},
      onToggleSearch: () => {},
      onOpenExport: () => {},
      onOpenSettings: () => {},
    })
    expect(screen.getByRole('menuitem', { name: /这一轮的产物/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /在本会话内搜索/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /导出会话/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /切换主题/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /设置/ })).toBeTruthy()
    expect(screen.getByText('3 个文件')).toBeTruthy()
    expect(screen.getByText('Markdown')).toBeTruthy()
  })

  it('没有产物就整项不画（不是画一个 0）', () => {
    renderMenu({ artifactCount: 0, onOpenArtifacts: () => {}, onToggleSearch: () => {} })
    expect(screen.queryByRole('menuitem', { name: /这一轮的产物/ })).toBeNull()
    expect(screen.queryByText('0 个文件')).toBeNull()
  })

  it('没有会话正文：搜索 / 导出都不画，只剩主题（和调用方给的设置）', () => {
    renderMenu({ onOpenSettings: () => {} })
    expect(screen.queryByRole('menuitem', { name: /在本会话内搜索/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /导出会话/ })).toBeNull()
    expect(screen.getByRole('menuitem', { name: /切换主题/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /设置/ })).toBeTruthy()
  })

  it('点项先关菜单，再执行动作', () => {
    const onClose = vi.fn()
    const onToggleSearch = vi.fn()
    render(<ChatMoreMenu open onClose={onClose} onToggleSearch={onToggleSearch} />)
    fireEvent.click(screen.getByRole('menuitem', { name: /在本会话内搜索/ }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onToggleSearch).toHaveBeenCalledTimes(1)
  })
})
