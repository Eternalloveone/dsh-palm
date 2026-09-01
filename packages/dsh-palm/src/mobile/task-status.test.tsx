// @vitest-environment jsdom
/** TaskStatusBar: collapsible background-task strip driven by session/jobs snapshots. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TaskStatusBar } from './task-status.tsx'
import type { JobView } from '@deepseek-ai/dsh-host-apiproxy/api/jobs'

afterEach(cleanup)

const job = (overrides: { id: string } & Partial<Omit<JobView, 'id'>>): JobView =>
  ({
    kind: 'subagent',
    label: '整理记忆',
    status: 'running',
    startedAt: 1_700_000_000_000,
    ...overrides,
  }) as unknown as JobView

describe('TaskStatusBar', () => {
  it('renders nothing for an empty snapshot', () => {
    const { container } = render(<TaskStatusBar jobs={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows a running-count summary and expands to list jobs', () => {
    render(<TaskStatusBar jobs={[
      job({ id: 'subagent-1', status: 'running', label: '整理记忆' }),
      job({ id: 'subagent-2', status: 'completed', label: '安装依赖' }),
    ]} />)
    expect(screen.getByRole('button', { name: /后台任务/ })).toBeTruthy()
    expect(screen.getByText(/1 个运行中 · 共 2 个后台任务/)).toBeTruthy()

    // Collapsed: job rows are hidden.
    expect(screen.queryByText('整理记忆')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /后台任务/ }))
    expect(screen.getByText('整理记忆')).toBeTruthy()
    expect(screen.getByText('安装依赖')).toBeTruthy()
    expect(screen.getByText(/子代理 · 运行中/)).toBeTruthy()
    expect(screen.getByText(/子代理 · 已完成/)).toBeTruthy()
  })

  it('shows a plain count when nothing is running', () => {
    render(<TaskStatusBar jobs={[job({ id: 'subagent-1', status: 'failed', label: '失败任务' })]} />)
    expect(screen.getByText(/1 个后台任务/)).toBeTruthy()
    expect(screen.queryByText(/运行中/)).toBeNull()
  })

  it('renders the detail when the producer supplies one', () => {
    render(<TaskStatusBar jobs={[job({ id: 'bash-1', kind: 'bash', status: 'failed', label: 'npm install', detail: 'exit code: 1' })]} />)
    fireEvent.click(screen.getByRole('button', { name: /后台任务/ }))
    expect(screen.getByText(/exit code: 1/)).toBeTruthy()
  })

  it('shows a start time for an in-flight job and a range + duration for a settled one', () => {
    render(<TaskStatusBar jobs={[
      job({ id: 'subagent-1', status: 'running', label: '整理记忆', startedAt: 1_700_000_000_000 }),
      job({ id: 'bash-2', status: 'completed', label: '安装依赖', startedAt: 1_700_000_000_000, finishedAt: 1_700_000_120_000 }),
    ]} />)
    fireEvent.click(screen.getByRole('button', { name: /后台任务/ }))
    // In-flight: "开始于 HH:MM".
    expect(screen.getByText(/开始于 \d{2}:\d{2}/)).toBeTruthy()
    // Settled: "HH:MM → HH:MM · 用时 2 分钟" (120 s).
    expect(screen.getByText(/\d{2}:\d{2} → \d{2}:\d{2} · 用时 2 分钟/)).toBeTruthy()
  })

  it('lists in-flight jobs before settled ones regardless of snapshot order', () => {
    render(<TaskStatusBar jobs={[
      job({ id: 'bash-1', status: 'completed', label: '已完成任务' }),
      job({ id: 'subagent-2', status: 'running', label: '运行中任务' }),
      job({ id: 'bash-3', status: 'failed', label: '失败任务' }),
    ]} />)
    fireEvent.click(screen.getByRole('button', { name: /后台任务/ }))
    const labels = screen.getAllByRole('listitem').map(row => row.textContent ?? '')
    const runningIndex = labels.findIndex(text => text.includes('运行中任务'))
    const completedIndex = labels.findIndex(text => text.includes('已完成任务'))
    const failedIndex = labels.findIndex(text => text.includes('失败任务'))
    expect(runningIndex).toBeGreaterThanOrEqual(0)
    expect(runningIndex).toBeLessThan(completedIndex)
    expect(runningIndex).toBeLessThan(failedIndex)
  })
})
