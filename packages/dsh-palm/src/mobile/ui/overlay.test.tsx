// @vitest-environment jsdom
/**
 * 浮层内核（W1-4）的行为契约。
 *
 * 这里钉的是「所有浮层共用一套行为」这件事本身：
 * 1. 点遮罩关、点面板不关；
 * 2. Esc 关闭；
 * 3. **两层叠加时一次 Esc 只关最上面那层**（以前每层各挂一个 window 监听，一次按键关两层）；
 * 4. 打开时焦点进入面板、关闭时归还给触发元素，且都 `preventScroll`；
 * 5. bare 模式（灯箱）aria 挂在最外层，不多包一层 div。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { Overlay } from './overlay.tsx'

afterEach(() => { cleanup() })

/** 一层浮层：面板里有一个按钮，便于观察焦点。 */
function Demo({ label, onClose }: { label: string; onClose(): void }) {
  return (
    <Overlay title={label} onClose={onClose} scrimClassName="demo-scrim" panelClassName="demo-panel">
      <button type="button">{label} 内容</button>
    </Overlay>
  )
}

describe('Overlay', () => {
  it('点遮罩关闭，点面板不关闭', () => {
    const onClose = vi.fn()
    const { container } = render(<Demo label="面板" onClose={onClose} />)
    fireEvent.click(screen.getByText('面板 内容'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(container.querySelector('.demo-scrim') as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('面板带 dialog 语义与无障碍名称', () => {
    render(<Demo label="运行状态" onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: '运行状态' })).toBeTruthy()
  })

  it('Esc 关闭', () => {
    const onClose = vi.fn()
    render(<Demo label="面板" onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('两层叠加时，一次 Esc 只关最上面那层', () => {
    function Stack() {
      const [bottom, setBottom] = useState(true)
      const [top, setTop] = useState(true)
      return (
        <>
          {bottom ? <Demo label="底层" onClose={() => { setBottom(false) }} /> : null}
          {top ? <Demo label="顶层" onClose={() => { setTop(false) }} /> : null}
        </>
      )
    }
    render(<Stack />)
    expect(screen.queryByRole('dialog', { name: '顶层' })).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })
    // 顶层关掉，底层还在——这正是以前做不到的。
    expect(screen.queryByRole('dialog', { name: '顶层' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: '底层' })).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '底层' })).toBeNull()
  })

  it('打开时焦点进入面板，关闭时归还给触发元素', () => {
    const trigger = document.createElement('button')
    trigger.textContent = '打开'
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const { unmount } = render(<Demo label="面板" onClose={() => {}} />)
    expect(document.activeElement).not.toBe(trigger)
    expect((document.activeElement as HTMLElement).closest('.demo-panel')).toBeTruthy()

    unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('bare 模式：aria 挂在最外层且点它关闭', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Overlay bare title="示例图" onClose={onClose} scrimClassName="lightbox-backdrop">
        <button type="button" aria-label="关闭">x</button>
      </Overlay>,
    )
    const scrim = container.querySelector('.lightbox-backdrop') as HTMLElement
    expect(scrim.getAttribute('role')).toBe('dialog')
    expect(scrim.getAttribute('aria-label')).toBe('示例图')
    fireEvent.click(scrim)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
