/**
 * 长按手势：按住 delayMs 后触发一次，任何移动/抬起/取消都作废。
 *
 * 从 ChatView 里抽出来（W2-5）：那 50 行计时器 + 坐标判定混在 5,000 行的视图里，
 * 既没法单独测，也没法给别的长按场景（工作区卡片、会话行）复用。
 *
 * 语义与原来逐条一致：
 * - 按下的同时把「目标元素 + 坐标」交回去，触发时原样带回（手指可能已经移开）；
 * - **任何** touchmove 都取消（不做位移阈值 —— 真机上滚动列表本来就该取消）；
 * - 重复 start 会先清掉上一个计时器（原来会漏掉，属于顺手修掉的小泄漏）。
 *
 * @module dsh-palm/mobile/ui/hooks/use-long-press
 */
import { useCallback, useEffect, useRef } from 'react'

export interface LongPressOptions {
  /** 按住多少毫秒算长按。 */
  delayMs?: number
  /** 触发回调：目标元素与按下时的坐标。 */
  onLongPress: (target: Element, x: number, y: number) => void
}

export interface LongPressControls {
  /** 开始计时（按下时调用）。 */
  start: (target: Element, x: number, y: number) => void
  /** 作废当前计时（移动、抬起、取消、弹出系统菜单时调用）。 */
  cancel: () => void
}

const DEFAULT_DELAY_MS = 500

export function useLongPress({ delayMs = DEFAULT_DELAY_MS, onLongPress }: LongPressOptions): LongPressControls {
  /** 回调放进 ref：调用方每次渲染换一个新函数也不会重启计时。 */
  const callbackRef = useRef(onLongPress)
  callbackRef.current = onLongPress

  const timerRef = useRef<number | undefined>(undefined)
  const pendingRef = useRef<{ target: Element; x: number; y: number } | undefined>(undefined)

  const cancel = useCallback(() => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
    pendingRef.current = undefined
  }, [])

  const start = useCallback((target: Element, x: number, y: number) => {
    // 重复按下：清掉上一轮，避免两个计时器同时排队。
    if (timerRef.current !== undefined) clearTimeout(timerRef.current)
    pendingRef.current = { target, x, y }
    timerRef.current = window.setTimeout(() => {
      const pending = pendingRef.current
      timerRef.current = undefined
      pendingRef.current = undefined
      if (pending === undefined) return
      callbackRef.current(pending.target, pending.x, pending.y)
    }, delayMs)
  }, [delayMs])

  // 卸载时清干净：视图被路由换掉时计时器不该再触发。
  useEffect(() => () => { cancel() }, [cancel])

  return { start, cancel }
}
