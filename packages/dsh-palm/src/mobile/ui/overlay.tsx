/**
 * 浮层内核（W1-4）：**所有**浮层的共同行为只在这里实现一次。
 *
 * 之前每个浮层各写一遍，于是同一类问题反复修：
 * - Esc：sheet/dialog/lightbox 各挂一个 window 监听 → 两层同时打开时**一次 Esc 关掉两层**；
 * - 焦点：sheet/dialog 有 `useFocusTrap`，lightbox/voice 没有 → 读屏用户焦点落在背后的列表上；
 * - 遮罩：有的点遮罩关、有的不关；有的面板 `stopPropagation`、有的忘了；
 * - aria：`role` 有的写 `dialog` 有的写 `alertdialog`，`aria-label` 时有时无。
 *
 * 现在统一从这里出：**Esc 栈（只关最上层）+ 焦点陷阱（含 `preventScroll`）+ 遮罩语义 + aria**。
 * 视觉类名仍由调用方传入（`sheet-backdrop` / `dialog` …），等 W2 换视觉时再一次性统一，
 * 这样这一步不动任何像素。
 *
 * 明确不做：**不锁 body 滚动**。document 本来就不滚（`#root` 是 100dvh + overflow:hidden），
 * 而动态改 `body.style.overflow` 会让手机浏览器重算 dvh、把背后页面顶一下。防穿透交给静态
 * CSS 的 `overscroll-behavior`。详见 `sheet.tsx` 顶部那段真机复盘。
 *
 * @module dsh-palm/mobile/ui/overlay
 */

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { useFocusTrap } from './focus-trap.ts'

/* ── Esc 栈：只关最上面那层 ─────────────────────────────────────────── */

const escapeStack: Array<() => void> = []
let escapeBound = false

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  const top = escapeStack[escapeStack.length - 1]
  if (top === undefined) return
  // 消费掉：不让同一次按键再落到下面的浮层或全局快捷键上。
  event.stopPropagation()
  event.preventDefault()
  top()
}

function trackEscape(close: () => void): () => void {
  if (!escapeBound) {
    escapeBound = true
    window.addEventListener('keydown', onWindowKeydown, true)
  }
  escapeStack.push(close)
  return () => {
    const index = escapeStack.lastIndexOf(close)
    if (index !== -1) escapeStack.splice(index, 1)
  }
}

/** 把 `onClose` 挂到 Esc 栈上；卸载即摘除（不依赖调用方的闭包身份）。 */
export function useEscapeToClose(onClose: () => void): void {
  const ref = useRef(onClose)
  ref.current = onClose
  useEffect(() => {
    const close = (): void => { ref.current() }
    return trackEscape(close)
  }, [])
}

/* ── 组件 ───────────────────────────────────────────────────────────── */

/** 浮层的语义角色：确认类用 alertdialog，其余用 dialog。 */
export type OverlayRole = 'dialog' | 'alertdialog'

export interface OverlayProps {
  /** 无障碍名称（同时是读屏播报的标题）。 */
  title: string
  onClose(): void
  children: ReactNode
  /** 遮罩类名，沿用各浮层现有视觉（W2 再统一）。 */
  scrimClassName: string
  /** 面板类名；`bare` 模式下不需要。 */
  panelClassName?: string
  role?: OverlayRole
  /** 点遮罩是否关闭（默认 true）。 */
  closeOnScrim?: boolean
  /** 面板内联样式（拖拽位移等）。 */
  panelStyle?: CSSProperties
  /**
   * 整块就是内容、没有内层面板（图片灯箱）：aria 与遮罩点击挂在最外层，
   * 不再多包一层 div（多一层会改变现有 CSS 的布局前提）。
   */
  bare?: boolean
}

/**
 * 一处浮层：遮罩 + 面板 + 焦点陷阱 + Esc。
 *
 * 调用方只负责内容与类名；行为上的差异只能通过 props 表达，不要再各挂监听。
 */
export function Overlay({
  title,
  onClose,
  children,
  scrimClassName,
  panelClassName,
  role = 'dialog',
  closeOnScrim = true,
  panelStyle,
  bare = false,
}: OverlayProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  useFocusTrap(panelRef)
  useEscapeToClose(onClose)

  const closeFromScrim = closeOnScrim ? onClose : undefined

  if (bare) {
    return (
      <div
        ref={panelRef}
        className={scrimClassName}
        role={role}
        aria-modal="true"
        aria-label={title}
        onClick={closeFromScrim}
      >
        {children}
      </div>
    )
  }

  return (
    <div className={scrimClassName} onClick={closeFromScrim}>
      <div
        ref={panelRef}
        className={panelClassName}
        role={role}
        aria-modal="true"
        aria-label={title}
        style={panelStyle}
        onClick={(event) => { event.stopPropagation() }}
      >
        {children}
      </div>
    </div>
  )
}
