/**
 * Modal focus management for sheets and dialogs.
 *
 * A phone sheet is a `role="dialog" aria-modal="true"` panel, but without focus
 * handling the browser leaves focus on the page behind: a screen reader keeps
 * reading the list, and a hardware-keyboard tab lands inside the hidden page.
 * Closing also drops focus to `<body>`, so the next Tab starts from the top.
 *
 * This hook does the three things the audit asked for: focus something inside
 * on open, keep Tab inside while open, and return focus to the trigger on close.
 *
 * @module dsh-palm/mobile/focus-trap
 */

import { useEffect, type RefObject } from 'react'

/** Elements that participate in the Tab order inside a modal panel. */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/** All tabbable elements inside `container`, in DOM order. */
export function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
}

/**
 * 聚焦但**不请求滚动**。
 *
 * 真机事故（2026-11-07，安卓 Chrome）：点输入区「+」「/」时，会话区会往上跳一下再回来。
 * 根因就在这里——底部浮层带入场动画（`@keyframes sheet-up`，从 `translateY(100%)` 滑上来），
 * 而 `useFocusTrap` 在挂载瞬间就 `focus()` 第一个选项。此刻那个选项还在屏幕下方之外，
 * 浏览器为了让"聚焦元素可见"会去滚/平移可视视口 → 整页看起来被往上推了一下，
 * 动画结束再回到原位。桌面 headless 里没有这个平移，所以一直复现不出来。
 *
 * `preventScroll: true` 就是干这个的：焦点照样给，别替我倒滚。老浏览器会忽略这个选项，
 * 行为退化成今天这样（可接受，不是错误）。
 */
export function focusWithoutScroll(target: HTMLElement): void {
  target.focus({ preventScroll: true })
}

/** 聚焦时会**弹出软键盘**的控件（手机上聚焦它们 = 键盘顶上来，面板被挤掉一半）。 */
const TEXTUAL_SELECTOR = [
  'input:not([type="checkbox"]):not([type="radio"])',
  'textarea',
  'select',
].join(', ')

/**
 * 打开面板时该聚焦谁。
 *
 * 为什么不是「第一个可聚焦元素」（原实现）：真机反馈 2026-11-11 —— 从抽屉点「切换工作区」，
 * 面板刚滑上来**搜索框就拿到焦点、键盘立刻弹出来**，把面板顶掉一半，用户以为"一打开就在搜索"。
 * 原来 `focusableWithin()[0]` 拿到的正是那个 `<input>`。
 *
 * 规则：优先第一个「不弹键盘」的控件（按钮/链接）；面板里确实只有输入框时才退回输入框
 * （纯输入对话框里键盘本来就是要弹的，行为不变）。
 *
 * @param container - 浮层面板
 * @returns 要聚焦的元素（没有可聚焦控件时返回 undefined）
 */
export function initialFocusWithin(container: HTMLElement): HTMLElement | undefined {
  const items = focusableWithin(container)
  return items.find(item => !item.matches(TEXTUAL_SELECTOR)) ?? items[0]
}

/**
 * Trap focus inside `containerRef` while it is mounted.
 *
 * The container must exist on mount (the sheet/dialog is conditionally
 * rendered), and closing unmounts it — which is what restores the previous
 * focus.
 *
 * @param containerRef - ref to the modal panel.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const first = initialFocusWithin(container)
    if (first !== undefined) {
      focusWithoutScroll(first)
    } else {
      container.setAttribute('tabindex', '-1')
      focusWithoutScroll(container)
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const items = focusableWithin(container)
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const index = items.indexOf(document.activeElement as HTMLElement)
      const shift = event.shiftKey
      const next = index === -1
        ? (shift ? items.length - 1 : 0)
        : (index + (shift ? -1 : 1) + items.length) % items.length
      event.preventDefault()
      items[next]?.focus()
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      // 归还焦点同样不要滚动：浮层关掉时把焦点还给触发按钮，若它此刻在视口外，
      // 浏览器又会替我们滚一次，效果和打开时一样糟。
      if (previous !== null && previous.isConnected) focusWithoutScroll(previous)
    }
  }, [containerRef])
}
