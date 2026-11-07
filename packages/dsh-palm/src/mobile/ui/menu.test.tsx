// @vitest-environment jsdom
/** Menu / Popover：方向键、Enter、Esc、Tab、点外部的行为契约。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Menu, Popover, type MenuEntry } from './menu.tsx'

afterEach(() => { cleanup() })

function makeEntries(): MenuEntry[] {
  return [
    { id: 'copy', label: '复制', onSelect: vi.fn() },
    { id: 'quote', label: '引用', onSelect: vi.fn() },
    { id: 'delete', label: '删除', danger: true, onSelect: vi.fn() },
  ]
}

describe('Menu', () => {
  it('打开即聚焦第一项，方向键在项间移动并环绕', () => {
    render(<Menu label="消息操作" entries={makeEntries()} onClose={() => {}} />)
    const items = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])

    fireEvent.keyDown(items[0] as HTMLElement, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1] as HTMLElement, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[2])
    // 最后一项再往下回到第一项
    fireEvent.keyDown(items[2] as HTMLElement, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(items[0] as HTMLElement, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[2])
  })

  it('Home/End 跳到首尾', () => {
    render(<Menu label="消息操作" entries={makeEntries()} onClose={() => {}} />)
    const items = screen.getAllByRole('menuitem')
    fireEvent.keyDown(items[0] as HTMLElement, { key: 'End' })
    expect(document.activeElement).toBe(items[2])
    fireEvent.keyDown(items[2] as HTMLElement, { key: 'Home' })
    expect(document.activeElement).toBe(items[0])
  })

  it('点一项：执行并收起', () => {
    const entries = makeEntries()
    const onClose = vi.fn()
    render(<Menu label="消息操作" entries={entries} onClose={onClose} />)
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }))
    expect(entries[2]?.onSelect).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('禁用项不触发', () => {
    const onSelect = vi.fn()
    render(
      <Menu label="菜单" entries={[{ id: 'x', label: '不可用', disabled: true, onSelect }]} onClose={() => {}} />,
    )
    fireEvent.click(screen.getByRole('menuitem', { name: '不可用' }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('Esc 与 Tab 都收起', () => {
    const onClose = vi.fn()
    render(<Menu label="菜单" entries={makeEntries()} onClose={onClose} />)
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0] as HTMLElement, { key: 'Tab' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('Popover', () => {
  it('点外部关闭，点内部不关', () => {
    const onClose = vi.fn()
    render(
      <div>
        <button type="button">外部</button>
        <Popover open label="浮出" onClose={onClose}>
          <button type="button">里面</button>
        </Popover>
      </div>,
    )
    fireEvent.mouseDown(screen.getByRole('button', { name: '里面' }))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(screen.getByRole('button', { name: '外部' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('关闭时不渲染', () => {
    render(<Popover open={false} label="浮出" onClose={() => {}}><span>内容</span></Popover>)
    expect(screen.queryByText('内容')).toBeNull()
  })
})
