// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorNote } from './error-note.tsx'

afterEach(() => { cleanup() })

describe('失败态（P6 ⑰）', () => {
  it('错误文案留住且对读屏是 alert', () => {
    render(<ErrorNote message="读取模型列表失败" />)
    expect(screen.getByText('读取模型列表失败')).toBeDefined()
    expect(document.querySelector('.error-note')?.getAttribute('role')).toBe('alert')
  })

  it('没有重试函数就不给按钮（不放假入口）', () => {
    render(<ErrorNote message="出错了" />)
    expect(document.querySelector('.error-note-retry')).toBeNull()
    expect(document.querySelector('.error-note-actions')).toBeNull()
  })

  it('给得起重试时按钮可点，回调被调用', () => {
    const onRetry = vi.fn()
    render(<ErrorNote message="出错了" onRetry={onRetry} />)
    screen.getByText('重试').closest('button')!.click()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('重试按钮文案可定制（不同动作说人话）', () => {
    render(<ErrorNote message="出错了" onRetry={() => {}} retryLabel="重新加载" />)
    expect(screen.getByText('重新加载')).toBeDefined()
  })

  it('可以收起：给了回调才有「知道了」', () => {
    const onDismiss = vi.fn()
    render(<ErrorNote message="出错了" onDismiss={onDismiss} />)
    screen.getByText('知道了').closest('button')!.click()
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
