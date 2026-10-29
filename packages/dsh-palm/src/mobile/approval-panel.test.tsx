// @vitest-environment jsdom
/** 审批卡片：允许之前必须看得见「将要执行什么」，且预览缺失时不瞎显示。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('./api.ts', () => ({
  respondApproval: vi.fn(async () => ({ ok: true })),
}))

import { ApprovalPanel } from './sheets.tsx'

const approval = {
  rpcId: 'rpc-1',
  approvalId: 'ap-1',
  toolName: 'bash',
  callId: 'c-1',
  reason: '需要执行构建',
}

describe('ApprovalPanel preview', () => {
  beforeEach(() => { cleanup() })
  afterEach(() => { cleanup() })

  it('shows the command the user is about to allow', () => {
    // 宿主帧只带工具名，用户在看不见命令的情况下点「允许一次」= 盲批。
    render(<ApprovalPanel approval={approval} sessionId="s-1" onResolved={() => {}} preview="pnpm verify" />)
    expect(screen.getByText('pnpm verify')).toBeTruthy()
  })

  it('renders nothing extra when no arguments were found', () => {
    const { container } = render(<ApprovalPanel approval={approval} sessionId="s-1" onResolved={() => {}} />)
    expect(container.querySelector('.chat-approval-preview')).toBeNull()
    // 卡片本身仍在：没有预览也不能把审批入口弄丢。
    expect(screen.getByRole('button', { name: '允许一次' })).toBeTruthy()
  })
})
