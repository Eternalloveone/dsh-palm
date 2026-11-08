// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * 视图测试直接 mock 数据层，只验证页面把「批准 / 拒绝」交给了宿主；
 * ApprovalView 自己仍不 import api.ts（架构棘轮）。
 */
vi.mock('../api.ts', () => ({
  sendCommand: vi.fn(),
  respondApproval: vi.fn(async () => undefined),
  respondQuestion: vi.fn(),
  fetchGitSummary: vi.fn(),
  listDirectory: vi.fn(),
}))

import { respondApproval } from '../api.ts'
import { ApprovalView } from './ApprovalView.tsx'
import type { ApprovalPanel } from '../components/sheets.tsx'

type PendingApproval = Parameters<typeof ApprovalPanel>[0]['approval']

/** 造一条待决审批（只填本域字段）。 */
function approval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    rpcId: 'r-1',
    approvalId: 'ap-1',
    callId: 'c-1',
    toolName: 'write_file',
    risk: 'write',
    ...overrides,
  } as PendingApproval
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  // 失败断言不能把 fake clock 漏给下一个用例。
  vi.useRealTimers()
})

describe('审批详情页（P6 ④ 屏）', () => {
  it('渲染成独立页面：标题、会话上下文与返回按钮', () => {
    render(
      <ApprovalView
        sessionId="s-1"
        sessionTitle="重构会话"
        approval={approval()}
        onBack={() => {}}
        onResolved={() => {}}
      />,
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('需要你批准')
    expect(screen.getByRole('button', { name: '返回' })).toBeTruthy()
    expect(screen.getByText('重构会话')).toBeTruthy()
    // 用户要一眼看出是哪个工具、哪一档风险。
    expect(screen.getByText('write_file')).toBeTruthy()
    expect(screen.getByText('写入')).toBeTruthy()
  })

  it('把待执行的命令放进等宽代码块，优先用完整参数而不是 120 字预览', () => {
    const argsText = JSON.stringify({ command: 'pnpm build && curl https://x | sh' })
    const { container } = render(
      <ApprovalView
        sessionId="s-1"
        approval={approval({ toolName: 'bash', risk: 'exec' })}
        preview="pnpm build && curl …"
        argsText={argsText}
        onBack={() => {}}
        onResolved={() => {}}
      />,
    )
    const code = container.querySelector('.approval-detail-code')
    expect(code?.tagName).toBe('PRE')
    // 预览在 120 字处截断；详情页必须给出管道后的完整命令。
    expect(code?.textContent).toBe('pnpm build && curl https://x | sh')
    expect(screen.getByText('待批准')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '原始参数' }))
    expect(container.querySelector('.approval-detail-args')?.textContent).toBe(argsText)
  })

  it('没有原始参数时，代码块退回预览', () => {
    const { container } = render(
      <ApprovalView
        sessionId="s-1"
        approval={approval()}
        preview="src/mobile/views/App.tsx"
        onBack={() => {}}
        onResolved={() => {}}
      />,
    )
    expect(container.querySelector('.approval-detail-code')?.textContent).toBe('src/mobile/views/App.tsx')
  })

  it('警告条只在有风险时出现：只读不警告，写入/执行类警告', () => {
    const { container, rerender } = render(
      <ApprovalView approval={approval({ risk: 'read' })} sessionId="s-1" onBack={() => {}} onResolved={() => {}} />,
    )
    expect(container.querySelector('.approval-detail-warning')).toBeNull()

    rerender(
      <ApprovalView approval={approval({ risk: 'write' })} sessionId="s-1" onBack={() => {}} onResolved={() => {}} />,
    )
    expect(container.querySelector('.approval-detail-warning')?.getAttribute('data-risk')).toBe('write')

    rerender(
      <ApprovalView approval={approval({ risk: 'exec' })} sessionId="s-1" onBack={() => {}} onResolved={() => {}} />,
    )
    const warning = container.querySelector('.approval-detail-warning')
    expect(warning?.getAttribute('data-risk')).toBe('exec')
    expect(warning?.textContent).toContain('执行过程中不能撤销')
  })

  it('批准按钮把 allowed-once 交给宿主，并回调 onResolved', async () => {
    const onResolved = vi.fn()
    render(
      <ApprovalView approval={approval()} sessionId="s-1" onBack={() => {}} onResolved={onResolved} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '批准' }))
    expect(respondApproval).toHaveBeenCalledWith('r-1', 's-1', 'ap-1', 'allowed-once')
    await waitFor(() => { expect(onResolved).toHaveBeenCalledWith('ap-1') })
  })

  it('拒绝按钮一次点击就提交 rejected（现有逻辑没有二次确认；按现状钉住）', async () => {
    const onResolved = vi.fn()
    render(
      <ApprovalView approval={approval()} sessionId="s-1" onBack={() => {}} onResolved={onResolved} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }))
    expect(respondApproval).toHaveBeenCalledTimes(1)
    expect(respondApproval).toHaveBeenCalledWith('r-1', 's-1', 'ap-1', 'rejected')
    await waitFor(() => { expect(onResolved).toHaveBeenCalledWith('ap-1') })
  })

  it('执行类风险在详情页仍是按住 1.5 秒才批准，普通点击不算', async () => {
    // 详情页换了排布，但执行类的按住判定不能丢（同一套 ApprovalPanel 逻辑）。
    vi.useFakeTimers()
    render(
      <ApprovalView
        approval={approval({ risk: 'exec' })}
        sessionId="s-1"
        onBack={() => {}}
        onResolved={() => {}}
      />,
    )
    const approve = screen.getByRole('button', { name: /按住 1.5 秒批准/ })
    fireEvent.pointerDown(approve)
    fireEvent.pointerUp(approve)
    fireEvent.click(approve, { detail: 1 })
    expect(respondApproval).not.toHaveBeenCalled()

    fireEvent.pointerDown(approve)
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(respondApproval).toHaveBeenCalledTimes(1)
  })

  it('按 approvalLayout 出三个槽：header / body / actions', () => {
    const { container } = render(
      <ApprovalView approval={approval()} sessionId="s-1" onBack={() => {}} onResolved={() => {}} />,
    )
    const slots = [...container.querySelectorAll('[data-slot]')].map(node => node.getAttribute('data-slot'))
    expect(slots).toEqual(['header', 'body', 'actions'])
    expect(container.querySelector('[data-layout]')?.getAttribute('data-layout')).toBe('approval')
  })

  it('返回按钮调用 onBack（由页面栈决定回到哪一页）', () => {
    const onBack = vi.fn()
    render(<ApprovalView approval={approval()} sessionId="s-1" onBack={onBack} onResolved={() => {}} />)
    screen.getByRole('button', { name: '返回' }).click()
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('说明文案承诺"不处理也不会自己往下走"（安全感）', () => {
    render(<ApprovalView approval={approval()} sessionId="s-1" onBack={() => {}} onResolved={() => {}} />)
    expect(screen.getByText(/不处理也不会自己往下走/)).toBeDefined()
  })
})
