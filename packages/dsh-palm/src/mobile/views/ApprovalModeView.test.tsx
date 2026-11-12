// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApprovalModeView } from './ApprovalModeView.tsx'

const options = [
  { value: 'ask', name: '每次询问', description: '每个工具都先问一遍' },
  { value: 'auto', name: '自动执行', description: '工具直接跑，不再确认' },
]

afterEach(() => { cleanup() })

describe('批准方式页（P6 ⑥ 屏）', () => {
  it('列出全部可选档位，当前档标「当前」', () => {
    render(<ApprovalModeView currentValue="ask" options={options} onBack={() => {}} />)
    expect(screen.getByText('每次询问')).toBeDefined()
    expect(screen.getByText('自动执行')).toBeDefined()
    const current = document.querySelector('[aria-pressed="true"]')
    expect(current?.textContent).toContain('每次询问')
    expect(current?.textContent).toContain('当前')
  })

  it('点某一档把值交出去（由调用方发宿主命令）', () => {
    const onApply = vi.fn()
    render(<ApprovalModeView currentValue="ask" options={options} onApply={onApply} onBack={() => {}} />)
    screen.getByText('自动执行').closest('button')!.click()
    expect(onApply).toHaveBeenCalledWith('auto')
  })

  it('没有回调时按钮不可点（不会假装改了）', () => {
    render(<ApprovalModeView currentValue="ask" options={options} onBack={() => {}} />)
    expect(screen.getByText('自动执行').closest('button')?.hasAttribute('disabled')).toBe(true)
  })

  it('宿主没给选项时说明原因', () => {
    render(<ApprovalModeView currentValue="ask" options={[]} onBack={() => {}} />)
    expect(screen.getByText(/还没提供可选的批准方式/)).toBeDefined()
  })

  it('放宽前有明确提醒', () => {
    render(<ApprovalModeView currentValue="ask" options={options} onBack={() => {}} />)
    expect(screen.getByText(/会减少确认弹窗/)).toBeDefined()
  })

  it('应用失败时显示错误（命令未注册等）', () => {
    render(<ApprovalModeView currentValue="ask" options={options} error="权限命令未在宿主注册，无法切换" onBack={() => {}} />)
    expect(screen.getByText(/未在宿主注册/)).toBeDefined()
  })

  it('最放开那一档不在第一次点击就生效（与对话页内联选择器的确认一致）', () => {
    // 2026-11-10 审查：对话页里点 danger-full-access 会先弹 PermissionConfirmSheet，
    // 而这一页点一下就发 /permission；同一个动作两条路径、两种安全等级。
    const onApply = vi.fn()
    const risky = [
      { value: 'ask', name: '每次询问' },
      { value: 'danger-full-access', name: '完全放开', description: '不再逐条问你' },
    ]
    render(<ApprovalModeView currentValue="ask" options={risky} onApply={onApply} onBack={() => {}} />)

    fireEvent.click(screen.getByText('完全放开').closest('button')!)
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.getByText(/确认放开/)).toBeDefined()

    // 取消：什么都不发，确认条收起来。
    fireEvent.click(screen.getByText('取消'))
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.queryByText(/确认放开/)).toBeNull()

    // 再点一次并确认，才真的把值交出去。
    fireEvent.click(screen.getByText('完全放开').closest('button')!)
    fireEvent.click(screen.getByText(/确认放开/))
    expect(onApply).toHaveBeenCalledWith('danger-full-access')
  })

  it('已经是这一档、或者普通档位，仍然点一下就切', () => {
    const onApply = vi.fn()
    const risky = [
      { value: 'ask', name: '每次询问' },
      { value: 'danger-full-access', name: '完全放开' },
    ]
    render(<ApprovalModeView currentValue="danger-full-access" options={risky} onApply={onApply} onBack={() => {}} />)
    // 当前档：点了也走 onApply（调用方自己会忽略同值），不需要再确认。
    screen.getByText('完全放开').closest('button')!.click()
    expect(onApply).toHaveBeenCalledWith('danger-full-access')
    expect(screen.queryByText(/确认放开/)).toBeNull()
  })
})
