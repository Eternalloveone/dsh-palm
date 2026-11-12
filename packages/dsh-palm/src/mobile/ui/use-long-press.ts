/**
 * 长按 → 触发一次回调。
 *
 * ## 为什么单独一个 hook
 *
 * 抽屉里每条会话要支持「长按置顶」，但长按有三件容易做错的事，混在渲染里就测不到：
 *
 * 1. **触发后不能又当点击**：长按松手会接着冒泡一个 `click`，抽屉行拿它当"打开会话"
 *    —— 用户想置顶，结果切走了会话。
 * 2. **滑动要取消**：手指在行上挪动时是滚动，不该算长按。
 * 3. **离开/取消要清定时器**：不清会在别的行上凭空触发。
 *
 * @module dsh-palm/mobile/ui/use-long-press
 */
import { useCallback, useEffect, useRef } from 'react'

/** 长按判定时长：比系统双击间隔长、又短到能等（微信/相册都是 500ms 上下）。 */
export const LONG_PRESS_MS = 500
/** 手指移动超过这个距离就当滚动，取消长按。 */
export const LONG_PRESS_SLOP_PX = 10

export interface LongPressHandlers {
  onPointerDown: (event: React.PointerEvent) => void
  onPointerMove: (event: React.PointerEvent) => void
  onPointerUp: (event: React.PointerEvent) => void
  onPointerLeave: () => void
  onPointerCancel: () => void
  onClickCapture: (event: React.MouseEvent) => void
}

/**
 * @param onLongPress - 触发时长按的动作
 * @param enabled - 关掉时整组 handler 不做事（例如没有回调、或行不可交互）
 */
export function useLongPress(onLongPress: (() => void) | undefined, enabled = true): LongPressHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const originRef = useRef<{ x: number; y: number } | undefined>(undefined)
  const firedRef = useRef(false)
  const callbackRef = useRef(onLongPress)
  callbackRef.current = onLongPress

  const cancel = useCallback(() => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
    originRef.current = undefined
  }, [])

  // 卸载时清掉：不清会在组件已经不在之后回调。
  useEffect(() => cancel, [cancel])

  const active = enabled && onLongPress !== undefined

  return {
    onPointerDown: (event) => {
      if (!active) return
      firedRef.current = false
      // 先清上一次（会连 origin 一起清），再记这一次的起点 —— 顺序反了就会把
      // 刚到手的坐标清掉，于是 onPointerMove 一直读到 undefined、滑动永远取消失败。
      cancel()
      originRef.current = { x: event.clientX, y: event.clientY }
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined
        firedRef.current = true
        callbackRef.current?.()
      }, LONG_PRESS_MS)
    },
    onPointerMove: (event) => {
      const origin = originRef.current
      if (origin === undefined) return
      const moved = Math.hypot(event.clientX - origin.x, event.clientY - origin.y)
      if (moved > LONG_PRESS_SLOP_PX) cancel()
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    // 长按已经触发过：吞掉紧随其后的 click，别让抽屉把会话打开。
    onClickCapture: (event) => {
      if (!firedRef.current) return
      firedRef.current = false
      event.preventDefault()
      event.stopPropagation()
    },
  }
}
