/**
 * 软键盘遮挡高度（W2-5）。
 *
 * 手机上「键盘弹起来」不是一个 CSS 事件：布局视口（layout viewport）通常不动，
 * 动的是 visualViewport 的高度与偏移。于是同一件事在每个文件里各写一遍公式：
 * `innerHeight - vv.height - vv.offsetTop`。这里收成一处：
 *
 * - `keyboardInsetPx()` 纯函数，任何地方都能直接算（不依赖 React）；
 * - `useKeyboardInset(cb)` 订阅 visualViewport 的 resize/scroll 与 window resize，
 *   变化时把当前遮挡高度交回去 —— **走回调而不是 state**，因为跟随键盘重排的
 *   是滚动位置和 CSS 变量，没必要让整棵 React 树按帧重渲染。
 *
 * @module dsh-palm/mobile/ui/hooks/use-keyboard-inset
 */
import { useEffect, useRef } from 'react'

/**
 * 当前软键盘遮挡的高度（CSS px）；键盘收起、或浏览器已经缩小布局视口时为 0。
 */
export function keyboardInsetPx(): number {
  const viewport = typeof window === 'undefined' ? undefined : window.visualViewport
  if (viewport === undefined || viewport === null) return 0
  return Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
}

/**
 * 订阅键盘高度变化。
 *
 * **只订阅、不在挂载时回调**：两个调用方各自已有首帧初始化（一个先算一次 lift，
 * 一个自己会贴底），多给一次反而会多滚一下。
 *
 * @param onChange - 键盘开合、视口位移、窗口尺寸变化时回调当前遮挡高度。
 */
export function useKeyboardInset(onChange: (inset: number) => void): void {
  /** 回调放 ref：调用方换函数不重订阅。 */
  const callbackRef = useRef(onChange)
  callbackRef.current = onChange

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const emit = (): void => { callbackRef.current(keyboardInsetPx()) }
    const viewport = window.visualViewport
    // resize 管键盘开合；scroll 管 iOS 键盘动画期间 visualViewport 的位移；
    // window.resize 管旋转/地址栏收起这类不含 visualViewport 事件的场景。
    viewport?.addEventListener('resize', emit)
    viewport?.addEventListener('scroll', emit)
    window.addEventListener('resize', emit)
    return () => {
      viewport?.removeEventListener('resize', emit)
      viewport?.removeEventListener('scroll', emit)
      window.removeEventListener('resize', emit)
    }
  }, [])
}
