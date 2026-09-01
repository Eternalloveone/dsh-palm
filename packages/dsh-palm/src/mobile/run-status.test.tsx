// @vitest-environment jsdom
/** RunStatusBar + RunStatusSheet: combined strip text, live dot, sheet sections. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RunStatusBar, RunStatusSheet } from './run-status.tsx'
import type { TodoSnapshot } from './messages.ts'

// No global auto-cleanup (globals: false): unmount between tests so screen
// queries never see a previous test's DOM.
afterEach(() => { cleanup() })

const TODO: TodoSnapshot = {
  seq: 40,
  items: [
    { content: '写代码', status: 'in_progress' },
    { content: '跑测试', status: 'pending' },
    { content: '发版', status: 'completed' },
  ],
}

const job = (id: string, status: string, label = '整理记忆'): never => ({
  id, kind: 'subagent', label, status, startedAt: 1_700_000_000_000,
}) as never

describe('RunStatusBar', () => {
  it('renders nothing when both inputs are empty', () => {
    const { container } = render(<RunStatusBar todo={undefined} jobs={[]} onOpen={() => {}} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when the todo list is empty', () => {
    const { container } = render(<RunStatusBar todo={{ seq: 1, items: [] }} jobs={[]} onOpen={() => {}} />)
    expect(container.innerHTML).toBe('')
  })

  it('combines todo count and live job count in one line', () => {
    render(<RunStatusBar todo={TODO} jobs={[job('a', 'running')]} onOpen={() => {}} />)
    expect(screen.getByRole('button', { name: /任务 1\/3 · 后台任务 1 个运行中/ })).toBeTruthy()
  })

  it('shows only the job part when there is no todo and all jobs settled', () => {
    render(<RunStatusBar todo={undefined} jobs={[job('a', 'completed'), job('b', 'failed')]} onOpen={() => {}} />)
    expect(screen.getByRole('button', { name: /后台任务 2 个/ })).toBeTruthy()
  })

  it('marks the dot live while a job or todo item is in flight', () => {
    const { container, rerender } = render(<RunStatusBar todo={TODO} jobs={[]} onOpen={() => {}} />)
    expect(container.querySelector('.chat-status-dot-live')).toBeTruthy()
    rerender(<RunStatusBar todo={undefined} jobs={[job('a', 'completed')]} onOpen={() => {}} />)
    expect(container.querySelector('.chat-status-dot-live')).toBeNull()
  })

  it('invokes onOpen when tapped', () => {
    const onOpen = vi.fn()
    render(<RunStatusBar todo={TODO} jobs={[]} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /任务 1\/3/ }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})

describe('RunStatusSheet', () => {
  it('renders nothing when both inputs are empty', () => {
    const { container } = render(<RunStatusSheet todo={undefined} jobs={[]} onClose={() => {}} />)
    expect(container.innerHTML).toBe('')
  })

  it('lists the plan items with their section count', () => {
    render(<RunStatusSheet todo={TODO} jobs={[]} onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: '运行状态' })).toBeTruthy()
    expect(screen.getByText('任务清单')).toBeTruthy()
    expect(screen.getByText('1/3')).toBeTruthy()
    expect(screen.getByText('写代码')).toBeTruthy()
    expect(screen.getByText('发版')).toBeTruthy()
    expect(screen.queryByText('后台任务')).toBeNull()
  })

  it('lists the jobs with their section count and no todo section', () => {
    render(<RunStatusSheet
      todo={undefined}
      jobs={[job('a', 'running', '整理记忆'), job('b', 'completed', '备份')] as never[]}
      onClose={() => {}}
    />)
    expect(screen.getByText('后台任务')).toBeTruthy()
    expect(screen.getByText('1 个运行中')).toBeTruthy()
    expect(screen.getByText('整理记忆')).toBeTruthy()
    expect(screen.getByText(/子代理 · 运行中/)).toBeTruthy()
    expect(screen.queryByText('任务清单')).toBeNull()
  })

  it('shows both sections, plan first, when both have content', () => {
    render(<RunStatusSheet todo={TODO} jobs={[job('a', 'running')] as never[]} onClose={() => {}} />)
    const sections = screen.getAllByRole('region').map(el => el.getAttribute('aria-label'))
    expect(sections).toEqual(['任务清单', '后台任务'])
  })
})
