/**
 * 消息列表的虚拟窗口：DOM 里只保留视口附近十来行，其余用上下两块占位撑着。
 *
 * ## 为什么（2026-11-15，真机数据）
 *
 * 真机会话是工具调用密集型：29 条用户消息 → 1314 个事件（tool/call 170、
 * step/start 170、step/end 170、tool/result 169）→ **97 个直接子元素 / 5.5 万像素**。
 * 同机 20× 降频实测行数与滚动的关系：
 *
 * | 渲染行数 | p95 | max |
 * |---|---|---|
 * | 3 | 55ms | 194ms |
 * | 15 | 76ms | 206ms |
 * | 38 | 124ms | 653ms |
 * | 97 | 229~392ms | 2679~3333ms |
 *
 * 行数是唯一强相关变量。用户真机上报的 max 3311ms 与 97 行这一档完全吻合。
 *
 * ## 为什么不是"往上翻就多画点"（上一版失败的原因）
 *
 * 上一版用 IntersectionObserver 在滚到占位时 `extra += N`，只增不减。每次
 * 「加载更早」插入新行都会再次触发，`extra` 一路累加，窗口最终撑回全量 ——
 * 窗口化把自己取消了，还额外背了占位重排的代价（p95 反而 285ms）。
 *
 * 这一版改成**由滚动位置反推窗口**：
 * - 行高用 `estimate` 累加成前缀和，内容总高恒等于前缀和的最后一项；
 * - 视口顶部落在第几行，窗口就开到那附近，**start 有上界**，永远不会被撑回全量；
 * - 上下各留一块占位（高度也来自前缀和），所以总高不变、`scrollTop` 语义不变。
 *
 * 估算误差只会让"占位与真实内容的比例"略有出入，不会让滚动位置跳 ——
 * 位置由前缀和决定，而不是由"已经画了哪些行"决定。
 *
 * @module dsh-palm/mobile/views/chat/hooks/use-row-window
 */

import { useEffect, useRef, useState } from 'react'

/** 视口附近至少保留多少行（实测 15~20 行时 p95 已落到 76~90ms）。 */
export const WINDOW_RENDER_ROWS = 18
/** 视口上下各多留几行做缓冲，滚动时不会看到空白。 */
export const WINDOW_BUFFER_ROWS = 6
/** 少于这么多行就不窗口化：短会话本来不贵，也让既有行为保持不变。 */
export const WINDOW_MIN_ROWS = 32
/** 手停下来多久才重算窗口（滚动中改 DOM 会重排）。 */
export const WINDOW_SETTLE_MS = 80

export interface RowWindowInput {
  /** 当前总行数。 */
  total: number
  /** 焦点行下标（-1 = 没有焦点）。搜索定位要求它在窗口里。 */
  focusIndex: number
  /** 换会话时重置窗口。 */
  sessionKey: string
  /** 第 index 行的估算高度。必须是**纯函数**：它是前缀和的输入，随渲染变化会让总高抖动。 */
  estimate: (index: number) => number
  /** 滚动容器（用它监听 scroll 并读 scrollTop）。 */
  scroller: HTMLElement | null
}

export interface RowWindow {
  /** 从第几行开始渲染。 */
  start: number
  /** 渲染到第几行（不含）。 */
  end: number
  /** 上方占位高度。 */
  topSpacer: number
  /** 下方占位高度。 */
  bottomSpacer: number
}

/** 在前缀和里找 `target` 落在第几行（返回最后一个 offsets[i] <= target 的 i）。 */
function rowAt(offsets: readonly number[], target: number): number {
  let lo = 0
  let hi = offsets.length - 2
  if (hi < 0) return 0
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid] <= target) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * 计算虚拟窗口。
 *
 * @param input - 见 {@link RowWindowInput}
 * @returns 渲染区间与上下占位高度
 */
export function useRowWindow(input: RowWindowInput): RowWindow {
  const { total, focusIndex, sessionKey, estimate, scroller } = input

  /** 视口顶部所在行的下标；`null` = 用户还没滚动过，一直贴尾部。 */
  const [anchorState, setAnchor] = useState<number | null>(null)
  /** 换会话：回到"贴尾部"状态。 */
  const keyRef = useRef(sessionKey)
  useEffect(() => {
    if (keyRef.current === sessionKey) return
    keyRef.current = sessionKey
    setAnchor(null)
  }, [sessionKey])

  /*
   * 贴尾基线：行数会从 0 长到 N（流式、拿历史）。用 `useState` 的惰性初值会把它钉在
   * 首帧那个 0 上 —— 窗口永远停在第一行，用户看到的全是历史头部（实测测试里
   * 找不到最后一条消息）。所以基线每次渲染都算，只有用户真的滚动过才用固定值。
   */
  const tailAnchor = Math.max(0, total - WINDOW_RENDER_ROWS - WINDOW_BUFFER_ROWS)
  const anchor = anchorState === null ? tailAnchor : Math.min(anchorState, tailAnchor)

  /** 行高前缀和：内容总高由它决定，与"画了哪些行"无关。 */
  const offsets = new Array<number>(total + 1)
  offsets[0] = 0
  for (let index = 0; index < total; index += 1) offsets[index + 1] = offsets[index] + estimate(index)

  /** 手停下来之后，按 scrollTop 反推视口顶部落在第几行。 */
  useEffect(() => {
    if (scroller === null || total < WINDOW_MIN_ROWS) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const sync = (): void => {
      timer = undefined
      const top = scroller.scrollTop
      // 前缀和在这一刻重新算一次：它只依赖 estimate，不依赖 scrollTop。
      const sums = new Array<number>(total + 1)
      sums[0] = 0
      for (let index = 0; index < total; index += 1) sums[index + 1] = sums[index] + estimate(index)
      const next = rowAt(sums, top + 1)
      setAnchor((current) => (current === next ? current : next))
    }
    const onScroll = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(sync, WINDOW_SETTLE_MS)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [scroller, total, estimate])

  if (total < WINDOW_MIN_ROWS) {
    return { start: 0, end: total, topSpacer: 0, bottomSpacer: 0 }
  }

  /*
   * 窗口 = [anchor - BUFFER, anchor + RENDER + BUFFER]，并保证最少 RENDER 行。
   * 焦点行（搜索定位）不在窗口里时把窗口挪过去 —— 定位靠真实 DOM 找元素。
   */
  let start = Math.max(0, anchor - WINDOW_BUFFER_ROWS)
  let end = Math.min(total, start + WINDOW_RENDER_ROWS + WINDOW_BUFFER_ROWS * 2)
  if (focusIndex >= 0 && (focusIndex < start || focusIndex >= end)) {
    start = Math.max(0, Math.min(focusIndex - WINDOW_BUFFER_ROWS, total - WINDOW_RENDER_ROWS))
    end = Math.min(total, start + WINDOW_RENDER_ROWS + WINDOW_BUFFER_ROWS * 2)
  }
  return {
    start,
    end,
    topSpacer: offsets[start],
    bottomSpacer: offsets[total] - offsets[end],
  }
}
