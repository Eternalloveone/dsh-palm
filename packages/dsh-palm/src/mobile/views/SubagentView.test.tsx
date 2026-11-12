// @vitest-environment jsdom
/**
 * 子代理详情页的契约。
 *
 * 这一页回答的问题只有一个：「它到底在干什么、结论是什么」。所以断言也围绕这个：
 * 折叠态也得露出最近一步、展开才给全部步骤、结论为空时按钮不能假装能复制。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubagentDigest } from '../session/subagent-detail.ts'
import { SubagentView } from './SubagentView.tsx'

const loadSubagentDetail = vi.hoisted(() => vi.fn())
const copyText = vi.hoisted(() => vi.fn())

vi.mock('../session/subagent-detail.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../session/subagent-detail.ts')>()
  return { ...actual, loadSubagentDetail }
})
vi.mock('../render/code-actions.ts', () => ({ copyText }))

const node = {
  id: 'sub-1',
  label: '调研搜索定位的业界方案',
  activity: 'running' as const,
  turnStartAt: Date.now() - 62_000,
  lastEventAt: Date.now() - 8_000,
}

const digest = (patch: Partial<SubagentDigest> = {}): SubagentDigest => ({
  steps: [
    { kind: 'tool', name: 'web_search', detail: 'find in page ux' },
    { kind: 'tool', name: 'web_fetch', detail: 'https://x.dev/a' },
    { kind: 'tool', name: 'bash', detail: 'pnpm test' },
  ],
  output: '结论：都靠计数和上下跳。',
  lastStep: { kind: 'tool', name: 'bash', detail: 'pnpm test' },
  toolCount: 3,
  ...patch,
})

beforeEach(() => {
  loadSubagentDetail.mockReset()
  copyText.mockReset()
  loadSubagentDetail.mockResolvedValue(digest())
})

afterEach(() => { cleanup() })

describe('子代理详情页', () => {
  it('标题、运行状态、工具数都从这一行带过来', async () => {
    render(<SubagentView node={node} onBack={() => {}} />)
    expect(screen.getByText('调研搜索定位的业界方案')).toBeDefined()
    expect(screen.getByText('运行中')).toBeDefined()
    await waitFor(() => { expect(screen.getByText(/3 个工具/)).toBeDefined() })
  })

  it('折叠态也给你「最近一步」：不点开也知道它在干什么', async () => {
    render(<SubagentView node={node} onBack={() => {}} />)
    await waitFor(() => { expect(screen.getByText('最近一步')).toBeDefined() })
    // 最近一步的摘要出现两次（最近一步 + 步骤表最后一条），所以按 ≥1 断言。
    expect(screen.getAllByText('pnpm test').length).toBeGreaterThan(0)
  })

  it('步骤多了先折叠，点一下才全部展开', async () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      kind: 'tool' as const,
      name: 'bash',
      detail: `step-${index}`,
    }))
    loadSubagentDetail.mockResolvedValue(digest({ steps: many, lastStep: many[8], toolCount: 9 }))
    render(<SubagentView node={node} onBack={() => {}} />)

    await waitFor(() => { expect(screen.getByText(/前面还有 5 步/)).toBeDefined() })
    expect(screen.queryByText('step-0')).toBeNull()
    fireEvent.click(screen.getByText(/前面还有 5 步/))
    expect(screen.getByText('step-0')).toBeDefined()
    expect(screen.getByText('收起过程')).toBeDefined()
  })

  it('结论为空时「复制结论」不可点（不假装复制了空串）', async () => {
    loadSubagentDetail.mockResolvedValue(digest({ output: '', lastStep: undefined, steps: [] }))
    render(<SubagentView node={node} onBack={() => {}} />)
    await waitFor(() => { expect(screen.getByText(/还没写出结论/)).toBeDefined() })
    const copy = screen.getByText('复制结论').closest('button')
    expect(copy?.hasAttribute('disabled')).toBe(true)
  })

  it('点「复制结论」把正文交出去', async () => {
    copyText.mockResolvedValue(true)
    render(<SubagentView node={node} onBack={() => {}} />)
    await waitFor(() => { expect(screen.getByText('复制结论').closest('button')?.hasAttribute('disabled')).toBe(false) })
    fireEvent.click(screen.getByText('复制结论'))
    expect(copyText).toHaveBeenCalledWith('结论：都靠计数和上下跳。', '已复制结论')
  })

  it('读失败就如实说，不假装空列表', async () => {
    loadSubagentDetail.mockRejectedValue(new Error('隧道断了'))
    render(<SubagentView node={node} onBack={() => {}} />)
    await waitFor(() => { expect(screen.getByText(/读取子代理失败/)).toBeDefined() })
  })

  it('返回按钮交给调用方（由页面栈弹回去）', () => {
    const onBack = vi.fn()
    render(<SubagentView node={node} onBack={onBack} />)
    fireEvent.click(screen.getByLabelText('返回'))
    expect(onBack).toHaveBeenCalled()
  })

  it('动作条钉在滚动区外面（正文划到哪都看得见按钮）', async () => {
    render(<SubagentView node={node} onBack={() => {}} />)
    await waitFor(() => { expect(screen.getByText('复制结论')).toBeDefined() })
    const actions = document.querySelector('.subagent-actions')
    expect(actions).not.toBeNull()
    // 关键：它不属于滚动容器 —— 否则长过程里按钮会被滚走。
    expect(actions?.closest('.subagent-page-body')).toBeNull()
    expect(actions?.parentElement?.className).toBe('subagent-page-shell')
  })
})
