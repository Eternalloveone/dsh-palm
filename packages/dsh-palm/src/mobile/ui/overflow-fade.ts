/**
 * 横滚容器的"右侧还有内容"判定。
 *
 * 2026-11-10（审批详情页 320px 实拍）：命令块按切片 7 的取舍在块内横滚 —— 好处是
 * 再长的命令也不会把「批准/拒绝」顶出屏幕，代价是**正文被容器圆角切掉一截**，看起来
 * 像渲染坏了，用户也不会知道后面还有一半命令没读。审批前"读全"是硬要求，所以这里
 * 给横滚容器一个可测的溢出判定，样式层据此在右缘画一道渐隐。
 *
 * 只在真溢出时标记；已经滚到最右也撤掉 —— 渐隐不能变成新的困惑。
 *
 * @module dsh-palm/mobile/ui/overflow-fade
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/** 当前该不该给右缘提示。 */
export type OverflowFade = 'none' | 'end'

/**
 * 绑定一个横滚容器，返回它的 ref 与溢出状态。
 *
 * @returns `ref` 挂到滚动元素上；`fade` 为 `end` 时样式层画右缘渐隐
 */
export function useOverflowFade<T extends HTMLElement>(): {
  ref: (node: T | null) => void
  fade: OverflowFade
} {
  const nodeRef = useRef<T | null>(null)
  const [fade, setFade] = useState<OverflowFade>('none')

  const measure = useCallback((): void => {
    const node = nodeRef.current
    if (node === null) return
    // +1：某些浏览器在整数缩放下会给出 0.5px 的差，别让"差一点点"闪一下渐隐。
    const more = node.scrollWidth - node.clientWidth > 1
    const atEnd = node.scrollLeft + node.clientWidth >= node.scrollWidth - 1
    setFade(more && !atEnd ? 'end' : 'none')
  }, [])

  const ref = useCallback((node: T | null): void => {
    nodeRef.current = node
    measure()
  }, [measure])

  useEffect(() => {
    const node = nodeRef.current
    if (node === null) return
    measure()
    node.addEventListener('scroll', measure, { passive: true })
    // jsdom 没有 ResizeObserver：没有就不量，别让测试环境炸。
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => { measure() })
    observer?.observe(node)
    return () => {
      node.removeEventListener('scroll', measure)
      observer?.disconnect()
    }
  }, [measure])

  return { ref, fade }
}
