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
 * - 行高来自 `lib/row-metrics.ts`（**实测优先、没测到才估**）；
 * - 视口顶部落在第几行，窗口就开到那附近，**start 有上界**，永远不会被撑回全量；
 * - 上下各留一块占位（高度也来自同一份账本），所以总高与"画了哪些行"无关。
 *
 * @module dsh-palm/mobile/views/chat/hooks/use-row-window
 */

import { useEffect, useRef, useState } from 'react'
import { createRowMetrics } from '../lib/row-metrics.ts'

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
  /** 第 index 行的估算高度。必须是**纯函数**：账本里没测到那些行的输入。 */
  estimate: (index: number) => number
  /** 滚动容器（用它监听 scroll 并读 scrollTop）。 */
  scroller: HTMLElement | null
  /**
   * 第 index 行的**身份键**（与 React key 同源）。
   *
   * 给了它，才会把量到的高度按身份记住（换页/补页位移后仍对得上）；
   * 不给就是纯估值窗口（组件单测、其它列表仍按老路径）。
   */
  keyOf?: (index: number) => string | undefined
  /**
   * 视口顶部以上的行测到新高度时，把"该补多少"交回给滚动层（K4 的唯一写点）。
   *
   * 不接这条回调，那些行的实测值就只能记不用 —— 用了会把屏幕上看到的内容顶走。
   */
  onGeometryShift?: (delta: number) => void
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

/** 没给 `keyOf` 时的兜底：不启用实测。 */
const NO_KEY = (): undefined => undefined

/**
 * 计算虚拟窗口。
 *
 * @param input - 见 {@link RowWindowInput}
 * @returns 渲染区间与上下占位高度
 */
export function useRowWindow(input: RowWindowInput): RowWindow {
  const { total, focusIndex, sessionKey, estimate, scroller, keyOf, onGeometryShift } = input

  /** 视口顶部所在行的下标；`null` = 用户还没滚动过，一直贴尾部。 */
  const [anchorState, setAnchor] = useState<number | null>(null)
  /** 账本里高度变了就 +1：占位与总高要重算一次。 */
  const [, setGeometryVersion] = useState(0)

  /*
   * 定锚用的两个入参走 ref：它们**每个渲染都是新值**（`estimate` 是调用点的内联箭头）。
   * 放进依赖里会让 effect 每帧重建、而 cleanup 会顺手清掉计时器 —— 流式期间
   * 每 16ms 一次渲染，80ms 的定锚就永远等不到空闲，锚点冻在某一帧上，之后新增的行
   * 全部落到窗口外、DOM 里干脆没有它们（真机：正文不再出现，只能关掉 PWA 重进）。
   */
  const estimateRef = useRef(estimate)
  estimateRef.current = estimate
  const keyOfRef = useRef(keyOf ?? NO_KEY)
  keyOfRef.current = keyOf ?? NO_KEY
  const shiftRef = useRef(onGeometryShift)
  shiftRef.current = onGeometryShift
  const totalRef = useRef(total)
  totalRef.current = total

  const metricsRef = useRef<ReturnType<typeof createRowMetrics> | null>(null)
  if (metricsRef.current === null) metricsRef.current = createRowMetrics(() => estimateRef.current)
  const metrics = metricsRef.current

  /** 换会话：回到"贴尾部"状态，并把实测高度清空。 */
  const sessionRef = useRef(sessionKey)
  useEffect(() => {
    if (sessionRef.current === sessionKey) return
    sessionRef.current = sessionKey
    metrics.reset()
    setAnchor(null)
    setGeometryVersion(version => version + 1)
  }, [sessionKey, metrics])

  /*
   * 贴尾基线：行数会从 0 长到 N（流式、拿历史）。用 `useState` 的惰性初值会把它钉在
   * 首帧那个 0 上 —— 窗口永远停在第一行，用户看到的全是历史头部（实测测试里
   * 找不到最后一条消息）。所以基线每次渲染都算，只有用户真的滚动过才用固定值。
   */
  const tailAnchor = Math.max(0, total - WINDOW_RENDER_ROWS - WINDOW_BUFFER_ROWS)
  const anchor = anchorState === null ? tailAnchor : Math.min(anchorState, tailAnchor)

  // 账本按这次渲染的行序刷新（行数/首尾身份没变时是空转）。
  metrics.setRows(total, keyOfRef.current)
  // 视口顶部以上的行不再接受新测量值 —— 改了它，屏幕上的内容会整体位移。
  metrics.setAnchor(anchor)

  /** 这一帧要渲染的区间（短会话整份渲染）。 */
  let start = 0
  let end = total
  if (total >= WINDOW_MIN_ROWS) {
    start = Math.max(0, anchor - WINDOW_BUFFER_ROWS)
    end = Math.min(total, start + WINDOW_RENDER_ROWS + WINDOW_BUFFER_ROWS * 2)
    // 焦点行（搜索定位）不在窗口里时把窗口挪过去 —— 定位靠真实 DOM 找元素。
    if (focusIndex >= 0 && (focusIndex < start || focusIndex >= end)) {
      start = Math.max(0, Math.min(focusIndex - WINDOW_BUFFER_ROWS, total - WINDOW_RENDER_ROWS))
      end = Math.min(total, start + WINDOW_RENDER_ROWS + WINDOW_BUFFER_ROWS * 2)
    }
  }

  /** 手停下来之后，按 scrollTop 反推视口顶部落在第几行。 */
  useEffect(() => {
    if (scroller === null) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const sync = (): void => {
      timer = undefined
      const count = totalRef.current
      if (count < WINDOW_MIN_ROWS) {
        setAnchor(null)
        return
      }
      const next = metrics.indexAt(scroller.scrollTop + 1)
      // 贴着底就读作「跟随尾部」(`null`)：只有跟随态才会自动长出新行。锚死在一个
      // 数字上时，后面新增的行落在窗口外 —— 用户看到的是下面一大片空白。
      setAnchor(current => {
        const value = next >= count - WINDOW_RENDER_ROWS ? null : next
        return current === value ? current : value
      })
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
  }, [scroller, metrics])

  /*
   * 实测高度：ResizeObserver 盯住**当前渲染出来的行**（只有它们在 DOM 里）。
   *
   * 一次布局会连发很多条回调（进会话时几十行逐行上屏、图片解码、卡片展开），
   * 所以整批合成一次重算，而不是每条都 setState。
   * 依赖里带 `start/end`：新进窗口的行要补挂观察器。
   */
  useEffect(() => {
    if (scroller === null || typeof ResizeObserver === 'undefined') return
    let changed = false
    let shift = 0
    const flush = (): void => {
      // 先补位置、再重渲染：反过来的话，中间那一帧用户看到的是"已经跳过去"的画面。
      if (shift !== 0) shiftRef.current?.(shift)
      shift = 0
      if (!changed) return
      changed = false
      setGeometryVersion(version => version + 1)
    }
    const take = (node: Element): void => {
      const key = node.getAttribute('data-row-key')
      if (key === null || key === '') return
      // 读一次布局属性是这一层被允许的成本：账本要靠它把"估"换成"实测"。
      const height = (node as HTMLElement).offsetHeight
      if (height <= 0) return
      const result = metrics.record(key, height)
      if (result.changed) changed = true
      shift += result.shift
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) take(entry.target)
      flush()
    })
    for (const node of scroller.querySelectorAll('[data-row-key]')) {
      observer.observe(node)
      take(node)
    }
    flush()
    return () => { observer.disconnect() }
  }, [scroller, metrics, start, end])

  if (total < WINDOW_MIN_ROWS) return { start: 0, end: total, topSpacer: 0, bottomSpacer: 0 }
  return {
    start,
    end,
    topSpacer: metrics.offset(start),
    bottomSpacer: metrics.totalHeight() - metrics.offset(end),
  }
}
