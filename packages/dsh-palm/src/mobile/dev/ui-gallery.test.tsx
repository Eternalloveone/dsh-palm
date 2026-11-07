// @vitest-environment jsdom
/** 画廊本身别坏：能渲染、能开浮层、能关。 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { UiGallery } from './ui-gallery.tsx'

afterEach(() => { cleanup() })

describe('UiGallery', () => {
  it('渲染出各个分区', () => {
    render(<UiGallery />)
    expect(screen.getByText('原语画廊')).toBeTruthy()
    for (const title of ['按钮', '图标按钮', '输入项', '浮层', '菜单 / 浮出层']) {
      expect(screen.getByText(title)).toBeTruthy()
    }
  })

  it('能从画廊打开并关闭确认框', () => {
    render(<UiGallery />)
    fireEvent.click(screen.getByRole('button', { name: '打开确认框' }))
    expect(screen.getByRole('alertdialog', { name: '删除会话？' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('菜单打开后键盘可用', () => {
    render(<UiGallery />)
    fireEvent.click(screen.getByRole('button', { name: '切换菜单' }))
    const items = screen.getAllByRole('menuitem')
    expect(items.length).toBeGreaterThan(1)
    fireEvent.keyDown(items[0] as HTMLElement, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
  })
})
