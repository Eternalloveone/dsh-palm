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

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRowMetrics } from '../lib/row-metrics.ts'

/** 一次补齐挂多少行（首帧只挂一屏，之后每 120ms 多一屏，直到整份在 DOM 里）。 */
export const WINDOW_RENDER_ROWS = 18
/** 少于这么多行就不窗口化：短会话本来不贵，也让既有行为保持不变。 */
export const WINDOW_MIN_ROWS = 32

/**
 * A/B 开关：`?win=0` 直接关掉窗口化（全部行都在 DOM 里）。
 *
 * 2026-11-18「空白屏」根治（R1）的对照臂：`.chat-msg` 已经加了 `content-visibility: auto`
 * （屏外行不布局不绘制，但仍在 DOM 里）。这里只负责把"第二套布局引擎"摘掉，好让真机
 * 同一提示词下 A/B 同一会话的滚动帧。跑完就删 —— 它只服务这一次判定。
 */
export function windowingOff(): boolean {
  if (typeof window === 'undefined') return false
  const value = new URLSearchParams(window.location.search).get('win')
  return value === '0' || value === 'off'
}

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
  /** `?win=0`：对照臂，整份渲染（见 {@link windowingOff}）。 */
  const off = windowingOff()

  /** 从尾部往上数，这一帧挂多少行（首帧只挂一屏，其余在空闲里补齐）。 */
  const [mountedState, setMounted] = useState(WINDOW_MIN_ROWS)
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
    if (off) return
    if (sessionRef.current === sessionKey) return
    sessionRef.current = sessionKey
    metrics.reset()
    setMounted(WINDOW_MIN_ROWS)
    setGeometryVersion(version => version + 1)
  }, [sessionKey, metrics])

  // 账本按这次渲染的行序刷新（行数/首尾身份没变时是空转）。
  metrics.setRows(total, keyOfRef.current)

  /*
   * **根治点：下方永远是真实内容。**
   *
   * 旧设计让窗口停在历史中段，后面那些行只由"估值占位"顶着高度 —— 于是滚动条总高
   * 是算出来的，读者能滚进一段没有任何行元素的虚空（真机整屏空白，2026-11-18），
   * 而"是否贴底"又靠这份估值，一错就再也出不来。
   *
   * 现在反过来：`end` 恒等于 `total`、下方**永不**留占位，只把还没挂载的历史放在
   * 上方；挂载按"一屏一次"补齐，首帧只画尾部一屏（进会话不慢）。
   */
  const mounted = Math.min(Math.max(mountedState, WINDOW_MIN_ROWS), total)
  let start = total - mounted
  const end = total
  // 焦点行（搜索定位）不在挂载范围里就整份挂上 —— 定位靠真实 DOM 找元素。
  if (focusIndex >= 0 && focusIndex < start) start = 0
  const topSpacer = start === 0 ? 0 : metrics.offset(start)
  // 视口以上的行不再接受新测量值 —— 改了它，上方占位会抖。
  metrics.setAnchor(start)
  const bottomSpacer = 0

  /*
   * 补齐：一次只多挂一屏，然后让出主线程 —— 一次挂满会把进会话按住（真机就是卡）。
   * 这是后台行为：用户在看尾部，补上来的都是他看不见的历史。
   */
  useEffect(() => {
    if (off || scroller === null || start === 0) return
    const timer = setTimeout(
      () => setMounted(current => Math.min(total, current + WINDOW_RENDER_ROWS)),
      120,
    )
    return () => clearTimeout(timer)
  }, [off, scroller, start, total])

  /*
   * 读者往上滑到已挂载区间的上沿：**当场**再挂一屏，别等他滑进还没挂的那段。
   * 只读 `scrollTop/clientHeight`（滚动事件里本来就有），不做额外布局查询。
   */
  useEffect(() => {
    if (off || scroller === null) return
    const onScroll = (): void => {
      if (scroller.scrollTop > scroller.clientHeight * 1.5) return
      setMounted(current => (current >= total ? current : Math.min(total, current + WINDOW_RENDER_ROWS)))
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [off, scroller, total])

  /*
   * 上方突然多出内容 → 把**浏览器刚算完的真实高差**交给滚动所有者补回去：读者眼中的
   * 画面不动，贴底时也仍在底部。差值不经过账本，也就不会带上估值误差。
   * （写点是 `use-stick-to-bottom` 一处 —— 这里只报数，不直接改滚动位置。）
   */
  const heightRef = useRef(0)
  useLayoutEffect(() => {
    if (scroller === null) return
    const height = scroller.scrollHeight
    const previous = heightRef.current
    heightRef.current = height
    if (previous === 0 || height <= previous) return
    shiftRef.current?.(height - previous)
  }, [scroller, start, end, total])

  /*
   * 实测高度：ResizeObserver 盯住**当前渲染出来的行**（只有它们在 DOM 里）。
   *
   * 一次布局会连发很多条回调（进会话时几十行逐行上屏、图片解码、卡片展开），
   * 所以整批合成一次重算，而不是每条都 setState。
   * 依赖里带 `start/end`：新进窗口的行要补挂观察器。
   */
  useEffect(() => {
    if (off || scroller === null || typeof ResizeObserver === 'undefined') return
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

  if (off || total < WINDOW_MIN_ROWS) return { start: 0, end: total, topSpacer: 0, bottomSpacer: 0 }
  return { start, end, topSpacer, bottomSpacer }
}
