/**
 * **消息区的触摸手势**（S3-A：从 `ChatView.tsx` 渲染体里搬出的第一块）。
 *
 * 手机上这块区域同时要处理四种手势，而它们互相抢夺，顺序写错就会互相打断：
 *
 * | 手势 | 意图 | 关键点 |
 * |---|---|---|
 * | 两指 | 代码块缩放 | 只认 `.code-block`，指距为 0 时放弃（否则会除以 0） |
 * | 单指长按 | 出消息菜单 | 只认 `.chat-msg` 内部；**代码块与图片让路**给系统选区/图片菜单 |
 * | 右键 / 长按 | 同上 | 打开成功要阻止默认菜单并撤掉定时器 |
 * | 其余触摸 | 一律取消长按 | 手指一动就不该再出菜单 |
 *
 * 真机上最容易错的两处：
 * 1. 单指长按如果不在 `.code-block pre, img` 上让路，用户会**选不了文字、存不了图**。
 * 2. 移动/结束/取消三个事件都必须撤长按——漏一个就会出现"手指已经滑走，菜单才冒出来"。
 *
 * @module dsh-palm/mobile/views/chat/use-chat-scroll-gestures
 */
import { useMemo, type MutableRefObject } from 'react'

/** 代码块缩放状态（两指开始时记下起点）。 */
export interface PinchState {
  block: HTMLElement
  dist0: number
  scale0: number
}

/** 依赖。 */
export interface ScrollGestureDeps {
  pinchRef: MutableRefObject<PinchState | undefined>
  /** 两指之间的初始距离。 */
  /** 两指之间的初始距离（React 的 TouchList，与事件参数一致）。 */
  pinchDistance: (touches: React.TouchList) => number
  /** 把缩放应用到当前代码块。 */
  applyPinch: (scale: number) => void
  /** 开始长按（到点出菜单）。 */
  startLongPress: (target: Element, x: number, y: number) => void
  /** 撤销长按。 */
  cancelLongPress: () => void
  /** 从事件目标打开自定义菜单；返回是否命中。 */
  openCtxFromTarget: (target: EventTarget | null, x: number, y: number) => boolean
}

/** 触摸 / 右键手势的 props（直接展开到 `.chat-scroll` 上）。 */
export interface ScrollGestureProps {
  onContextMenu: (event: React.MouseEvent) => void
  onTouchStart: (event: React.TouchEvent) => void
  onTouchMove: (event: React.TouchEvent) => void
  onTouchEnd: (event: React.TouchEvent) => void
  onTouchCancel: (event: React.TouchEvent) => void
}

/** @returns 手势 props（同一次渲染内稳定）。 */
export function useScrollGestures(deps: ScrollGestureDeps): ScrollGestureProps {
  const { pinchRef, pinchDistance, applyPinch, startLongPress, cancelLongPress, openCtxFromTarget } = deps
  return useMemo<ScrollGestureProps>(() => ({
    onContextMenu: (event) => {
      if (openCtxFromTarget(event.target, event.clientX, event.clientY)) {
        event.preventDefault()
        cancelLongPress()
      }
    },
    onTouchStart: (event) => {
      // Two fingers on a code block = pinch zoom; single finger keeps the
      // long-press menu gesture.
      if (event.touches.length >= 2) {
        cancelLongPress()
        const target = event.target instanceof Element ? event.target : null
        const block = target?.closest<HTMLElement>('.code-block') ?? null
        if (block !== null) {
          const dist0 = pinchDistance(event.touches)
          if (dist0 > 0) {
            const current = block.querySelector('pre')?.style.transform ?? ''
            const scale0 = current === '' ? 1 : Number(/scale\(([\d.]+)\)/.exec(current)?.[1] ?? 1)
            pinchRef.current = { block, dist0, scale0 }
            return
          }
        }
        pinchRef.current = undefined
        return
      }
      pinchRef.current = undefined
      const touch = event.touches[0]
      if (touch === undefined) return
      const target = event.target instanceof Element ? event.target : null
      if (target === null || target.closest('.chat-msg') === null) return
      // 代码块/图片可选中或可长按：交给系统（文字选择 / 图片菜单），
      // 自定义菜单（编辑/复制/引用）接管消息正文长按。
      if (target.closest('.code-block pre, img') !== null) return
      const { clientX, clientY } = touch
      startLongPress(target, clientX, clientY)
    },
    onTouchMove: (event) => {
      if (pinchRef.current !== undefined && event.touches.length >= 2) {
        const dist = pinchDistance(event.touches)
        if (dist > 0) applyPinch(pinchRef.current.scale0 * dist / pinchRef.current.dist0)
        return
      }
      cancelLongPress()
    },
    onTouchEnd: (event) => {
      if (pinchRef.current !== undefined && event.touches.length < 2) pinchRef.current = undefined
      cancelLongPress()
    },
    onTouchCancel: (event) => {
      if (pinchRef.current !== undefined && event.touches.length < 2) pinchRef.current = undefined
      cancelLongPress()
    },
  }), [pinchRef, pinchDistance, applyPinch, startLongPress, cancelLongPress, openCtxFromTarget])
}
