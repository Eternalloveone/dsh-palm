// @vitest-environment jsdom
/**
 * 审批详情页＝账本的投影（W3-2 第二步收口）。
 *
 * 病灶：页面原来吃的是导航时抄下来的 `Route.approval` 快照。它与对话里的审批
 * 面板**不是同一份事实**：另一台设备答完、或宿主已经收掉这条审批，详情页仍然
 * 摆着「批准」——点下去只会拿到 not-found。这里钉住新契约：路由只存 id，
 * 页面按 id 从会话账本读；账本里没了就退回对话。
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api.ts', () => ({
  sendCommand: vi.fn(),
  respondApproval: vi.fn(async () => undefined),
  respondQuestion: vi.fn(),
  fetchGitSummary: vi.fn(),
  listDirectory: vi.fn(),
}))

import { ApprovalRoute } from './approval-route.tsx'
import { resetSessionPendingStores, sessionPendingStore } from '../runtime/chat/pending-store.ts'
import type { PendingApproval } from '../api.ts'

const approval = (overrides: Partial<PendingApproval> = {}): PendingApproval => ({
  rpcId: 'rpc-ap-1',
  approvalId: 'ap-1',
  toolName: 'write_file',
  callId: 'c-1',
  risk: 'write',
  reason: '要写文件',
  ...overrides,
})

beforeEach(() => {
  resetSessionPendingStores()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('审批详情页读会话账本', () => {
  it('页面内容来自账本里的实时对象', () => {
    sessionPendingStore('s-1').setApprovals(() => [approval()])
    render(<ApprovalRoute sessionId="s-1" approvalId="ap-1" onBack={() => {}} />)
    expect(screen.getByText('write_file')).toBeTruthy()
  })

  it('别处答完（账本里没了）→ 页面收起并返回对话', async () => {
    const back = vi.fn()
    sessionPendingStore('s-1').setApprovals(() => [approval()])
    render(<ApprovalRoute sessionId="s-1" approvalId="ap-1" onBack={back} />)
    expect(screen.getByText('write_file')).toBeTruthy()

    act(() => { sessionPendingStore('s-1').setApprovals(() => []) })

    await waitFor(() => { expect(back).toHaveBeenCalled() })
    expect(screen.queryByText('write_file')).toBeNull()
  })

  it('账本里本来就没有这条 → 不渲染审批内容，直接返回', async () => {
    const back = vi.fn()
    render(<ApprovalRoute sessionId="s-1" approvalId="ap-missing" onBack={back} />)
    expect(screen.queryByText('write_file')).toBeNull()
    await waitFor(() => { expect(back).toHaveBeenCalled() })
  })

  it('别的会话的同名审批不会被借用（按会话读账本）', () => {
    sessionPendingStore('s-2').setApprovals(() => [approval()])
    render(<ApprovalRoute sessionId="s-1" approvalId="ap-1" onBack={() => {}} />)
    expect(screen.queryByText('write_file')).toBeNull()
  })
})
