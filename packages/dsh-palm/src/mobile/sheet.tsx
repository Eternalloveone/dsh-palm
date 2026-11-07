/**
 * 共享底部浮层外壳：遮罩 + 上滑面板 + 拖拽把手（下拉 ~80px 关闭、上拉 ~40px 全屏）。
 * 由聊天的选择器、设置页的选择器、工作区长按菜单共用。
 *
 * W1-4 起，遮罩/焦点/Esc/aria 全部交给 `ui/overlay.tsx`，这里只剩**拖拽**这一件
 * 它独有的东西。以前每个浮层各挂一个 Esc 监听，两层同时打开时一次 Esc 会关掉两层。
 */

import { useRef, useState, type ReactNode } from 'react'
import { Overlay } from './ui/overlay.tsx'

/** Shared bottom-sheet props. */
export interface SheetProps {
  title: string
  onClose(): void
  children: ReactNode
}

/** Pull-down distance past which release dismisses the sheet. */
const DISMISS_THRESHOLD_PX = 80
/** Pull-up distance past which release expands the sheet to full height. */
const EXPAND_THRESHOLD_PX = 40

/** Render one bottom sheet with backdrop, drag handle, and centered title. */
export function Sheet({ title, onClose, children }: SheetProps) {
  const [dragY, setDragY] = useState(0)
  const [full, setFull] = useState(false)
  const dragging = useRef(false)
  const startY = useRef(0)
  // Total drag distance, tracked synchronously: a fast flick ends (touchend)
  // in the same frame as its last move, before the move's setState flushes,
  // so the end handler reads the distance from a ref, never from state.
  const dragDy = useRef(0)

  /*
   * 这里**故意**不锁 body 滚动（原来有 `body.style.overflow = 'hidden'`，2026-11-07 删）。
   *
   * 用户真机反馈：点输入区「+」「/」时，会话区会**上翻一下再回来**。根因就是这个动态锁：
   *   ① 本 App 的 document 根本不会滚（`#root` 是 `height: 100dvh` + `overflow: hidden`，
   *      实测 scrollHeight-clientHeight = 0），锁它等于什么都没锁；
   *   ② 但改 `body.style.overflow` 会让手机浏览器**重新评估可视视口/地址栏**，
   *      `100dvh` 随之变化 → `.chat-scroll` 高度变了 → 消息区整体位移，关掉浮层再回来，
   *      正好就是"上翻一下又回来"；
   *   ③ 防滚动穿透这件事已经由静态 CSS 兜住：`html, body { overscroll-behavior-y: contain }`
   *      以及 `.chat-scroll { overscroll-behavior: contain }`。
   * 所以锁是"没用且有害"，删除即可。别再加回来。
   */

  return (
    <Overlay
      title={title}
      onClose={onClose}
      scrimClassName="sheet-backdrop"
      panelClassName={'sheet' + (full ? ' sheet-full' : '')}
      panelStyle={dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
    >
      {/*
        * Grab header: drag gestures live here (touch-action: none), so the
        * scrollable body below gets every vertical gesture for itself.
        * Down past DISMISS_THRESHOLD closes; up past EXPAND_THRESHOLD
        * expands the panel to full height (a long task list needs both).
        */}
      <div
        className="sheet-grab"
        onTouchStart={(event) => {
          dragging.current = true
          dragDy.current = 0
          startY.current = event.touches[0]?.clientY ?? 0
        }}
        onTouchMove={(event) => {
          if (!dragging.current) return
          const dy = (event.touches[0]?.clientY ?? 0) - startY.current
          dragDy.current = dy
          // Upward drag is only recorded (the panel transform applies below
          // zero only), so the expand check sees the real distance; in the
          // expanded state the panel cannot rise above full height.
          setDragY(full ? Math.max(0, dy) : dy)
        }}
        onTouchEnd={() => {
          if (!dragging.current) return
          dragging.current = false
          const dy = dragDy.current
          dragDy.current = 0
          if (dy > DISMISS_THRESHOLD_PX) {
            onClose()
          } else if (!full && dy < -EXPAND_THRESHOLD_PX) {
            setFull(true)
          }
          setDragY(0)
        }}
      >
        <div className="sheet-handle" aria-hidden onClick={() => { onClose() }} />
        <div className="sheet-title">{title}</div>
      </div>
      <div className="sheet-body">{children}</div>
    </Overlay>
  )
}
