// @vitest-environment jsdom
/**
 * 顶栏运行徽标（2026-11-10）：任务清单与子代理从「输入框上方一行句子」搬到顶栏。
 *
 * 三条断言分别防：① 没东西也画一个空徽标（顶栏多一个空格）② 数字口径错
 * ③ 子代理/后台任务被吞掉（用户最关心的「还有东西在跑吗」）。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunBadge } from './run-status.tsx'

afterEach(() => { cleanup() })

const todo = (items: { status: string }[]) => ({ items }) as never

describe('RunBadge', () => {
  it('没计划、没后台任务、没子代理：不渲染（顶栏不多一个空格）', () => {
    const { container } = render(<RunBadge todo={undefined} jobs={[]} subagents={[]} onOpen={() => {}} />)
    expect(container.querySelector('.chat-run-badge')).toBeNull()
  })

  it('有计划在跑：写「已完成/总数」，点开详情', () => {
    const onOpen = vi.fn()
    render(
      <RunBadge
        todo={todo([{ status: 'completed' }, { status: 'completed' }, { status: 'in_progress' }, { status: 'pending' }])}
        jobs={[]}
        subagents={[]}
        onOpen={onOpen}
      />,
    )
    const badge = screen.getByRole('button')
    expect(badge.textContent).toBe('2/4')
    fireEvent.click(badge)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('子代理与后台任务都进徽标（用户最关心的「还有东西在跑吗」）', () => {
    render(
      <RunBadge
        todo={todo([{ status: 'completed' }])}
        jobs={[{ id: 'j1', status: 'running' }] as never}
        subagents={[{ id: 's1', label: '调研', activity: 'running' }] as never}
        onOpen={() => {}}
      />,
    )
    const text = screen.getByRole('button').textContent ?? ''
    expect(text).toContain('代理 1')
    expect(text).toContain('后台 1')
    // 计划全完成时不占位（3/3 没有信息量）。
    expect(text).not.toContain('1/1')
  })
})
