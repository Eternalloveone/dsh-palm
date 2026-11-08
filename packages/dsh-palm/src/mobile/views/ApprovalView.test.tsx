// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApprovalView } from './ApprovalView.tsx'
import type { ApprovalPanel } from '../components/sheets.tsx'

type PendingApproval = Parameters<typeof ApprovalPanel>[0]['approval']

/** 造一条待决审批（只填本域字段）。 */
function approval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    approvalId: 'ap-1',
    callId: 'c-1',
    tool: 'write_file',
    risk: 'write',
    ...overrides,
  } as PendingApproval
}

afterEach(() => { cleanup() })

describe('审批详情页（P6 ④ 屏）', () => {
  it('渲染成独立页面：有返回按钮、标题与风险说明', () => {
    render(
      <ApprovalView
        sessionId="s-1"
        sessionTitle="重构会话"
        approval={approval()}
        onBack={() => {}}
        onResolved={() => {}}
      />,
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('要你决定')
    expect(screen.getByRole('button', { name: '返回' })).toBeDefined()
    expect(screen.getByText(/重构会话 · 会改文件/)).toBeDefined()
  })

  it('执行类风险的说明用警示色（数据属性驱动，不改结构）', () => {
    render(
      <ApprovalView approval={approval({ risk: 'exec' })} sessionId="s-1" onBack={() => {}} onResolved={() => {}} />,
    )
    const sub = document.querySelector('.approval-page-sub')
    expect(sub?.getAttribute('data-risk')).toBe('exec')
    expect(sub?.textContent).toContain('会执行命令')
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
