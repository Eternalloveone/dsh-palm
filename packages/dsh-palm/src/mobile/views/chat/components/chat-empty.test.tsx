// @vitest-environment jsdom
/**
 * 空会话首屏（`single-surface.html` A 图）。
 *
 * 三条契约：① 首屏就是会话页的形状（顶栏 + 输入区），不是一个"新建页"；
 * ② 示例 chip 只填输入框、**不自动发**；③ 空会话的 ⋯ 菜单不画没有数据源的项
 * （没有产物、没有可搜索/可导出的正文）。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatEmptyView, EMPTY_CHIPS } from './chat-empty.tsx'

afterEach(() => { cleanup() })

describe('空会话首屏', () => {
  it('顶栏仍是三元素，正文是 56px 方块 + 说点什么开始 + 三个示例', () => {
    render(<ChatEmptyView title="新会话" workspaceName="dsh-palm" onOpenDrawer={() => {}} onStartSession={() => {}} />)
    expect(screen.getByRole('button', { name: '会话抽屉' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '更多' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '新会话' })).toBeTruthy()
    expect(screen.getByText('说点什么开始')).toBeTruthy()
    expect(screen.getByText('dsh-palm')).toBeTruthy()
    for (const chip of EMPTY_CHIPS) expect(screen.getByRole('button', { name: chip })).toBeTruthy()
    // 没有返回键：会话页就是根。
    expect(screen.queryByRole('button', { name: '返回' })).toBeNull()
  })

  it('点示例 chip 只把文案填进输入框，不发送', () => {
    const onStartSession = vi.fn()
    render(<ChatEmptyView title="新会话" onStartSession={onStartSession} />)
    fireEvent.click(screen.getByRole('button', { name: EMPTY_CHIPS[0] ?? '' }))
    const input = screen.getByRole('textbox', { name: '说点什么' }) as HTMLTextAreaElement
    expect(input.value).toBe(EMPTY_CHIPS[0])
    expect(onStartSession).not.toHaveBeenCalled()
  })

  it('输入后点发送：把首句交给 App（建会话与投递都由 App 负责）', async () => {
    const onStartSession = vi.fn().mockResolvedValue(undefined)
    render(<ChatEmptyView title="新会话" onStartSession={onStartSession} />)
    const input = screen.getByRole('textbox', { name: '说点什么' })
    fireEvent.change(input, { target: { value: '  修一下跳转  ' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(onStartSession).toHaveBeenCalledWith('修一下跳转')
  })

  it('空会话的 ⋯ 菜单只画有数据源的项：没有产物 / 搜索 / 导出', () => {
    render(<ChatEmptyView title="新会话" onStartSession={() => {}} onOpenSettings={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    expect(screen.getByRole('menuitem', { name: /设置/ })).toBeTruthy()
    // 2026-11-10：明暗由皮肤决定，「切换主题」已从菜单删掉。
    expect(screen.queryByRole('menuitem', { name: /主题/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /这一轮的产物/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /在本会话内搜索/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /导出会话/ })).toBeNull()
  })

  it('发送失败把原因说出来，输入内容不丢', async () => {
    const onStartSession = vi.fn().mockRejectedValue(new Error('宿主不在线'))
    render(<ChatEmptyView title="新会话" onStartSession={onStartSession} />)
    fireEvent.change(screen.getByRole('textbox', { name: '说点什么' }), { target: { value: '你好' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect((await screen.findByRole('alert')).textContent).toContain('宿主不在线')
    expect((screen.getByRole('textbox', { name: '说点什么' }) as HTMLTextAreaElement).value).toBe('你好')
  })
})
