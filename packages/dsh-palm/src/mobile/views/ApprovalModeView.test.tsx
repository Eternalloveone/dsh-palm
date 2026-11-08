// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
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
})
