/**
 * 菜单与浮出层（W1-5 收尾）。
 *
 * 之前 11 处 `role="menu"` 各写各的键盘逻辑：有的只有 Esc，有的连 Esc 都没有，
 * 方向键一律不支持。真机上是手指操作，但 iPad 外接键盘与读屏用户必须能用方向键。
 *
 * 这里只做**行为**：roving focus（方向键/Home/End）、Enter 激活、Esc 关闭、
 * `aria-disabled` 跳过、Tab 收起。定位与视觉交给调用方（`className` / 父容器定位），
 * 所以接入不改变现有布局。
 *
 * @module dsh-palm/mobile/ui/menu
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { useEscapeToClose } from './overlay.tsx'

export interface MenuEntry {
  id: string
  label: string
  /** 危险项（如删除）：视觉由调用方决定，这里只透出 `data-danger`。 */
  danger?: boolean
  disabled?: boolean
  onSelect(): void
}

const ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"])'

export interface MenuProps {
  /** 无障碍名称（如「消息操作」）。 */
  label: string
  entries: MenuEntry[]
  onClose(): void
  className?: string
}

/** 一个菜单：方向键移动、Enter 激活、Esc 关闭、Tab 收起。 */
export function Menu({ label, entries, onClose, className }: MenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEscapeToClose(onClose)

  // 打开即聚焦第一项：否则键盘用户还得先 Tab 进来。
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus()
  }, [])

  const move = (delta: number): void => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])
    if (items.length === 0) return
    const index = items.indexOf(document.activeElement as HTMLElement)
    const next = index === -1 ? 0 : (index + delta + items.length) % items.length
    items[next]?.focus()
  }

  const focusEdge = (edge: 'first' | 'last'): void => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])
    items[edge === 'first' ? 0 : items.length - 1]?.focus()
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className={className}
      onKeyDown={(event) => {
        switch (event.key) {
          case 'ArrowDown': event.preventDefault(); move(1); break
          case 'ArrowUp': event.preventDefault(); move(-1); break
          case 'Home': event.preventDefault(); focusEdge('first'); break
          case 'End': event.preventDefault(); focusEdge('last'); break
          // Tab 收起菜单：焦点继续走去下一个控件，而不是困在菜单里。
          case 'Tab': onClose(); break
          default: break
        }
      }}
    >
      {entries.map(entry => (
        <button
          key={entry.id}
          type="button"
          role="menuitem"
          data-danger={entry.danger || undefined}
          aria-disabled={entry.disabled || undefined}
          onClick={() => {
            if (entry.disabled === true) return
            entry.onSelect()
            onClose()
          }}
        >
          {entry.label}
        </button>
      ))}
    </div>
  )
}

export interface PopoverProps {
  open: boolean
  /** 无障碍名称。 */
  label: string
  onClose(): void
  children: ReactNode
  className?: string
}

/**
 * 浮出层：点外部或按 Esc 关闭。定位由调用方的容器负责（W2 会加锚定定位），
 * 这里只保证「关得掉、Esc 有效、点里面不关」。
 */
export function Popover({ open, label, onClose, children, className }: PopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEscapeToClose(onClose)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      const node = event.target
      if (node instanceof Node && ref.current?.contains(node) === true) return
      onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => { document.removeEventListener('mousedown', onPointerDown) }
  }, [open, onClose])

  if (!open) return null
  return (
    <div ref={ref} role="dialog" aria-label={label} className={className}>
      {children}
    </div>
  )
}
