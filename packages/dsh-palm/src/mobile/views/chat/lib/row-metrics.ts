/**
 * 行高账本：虚拟窗口的**几何真源**。
 *
 * 2026-11-17 之前的做法是「每帧用 `estimate(index)` 把 N 行加一遍前缀和」：
 *
 * - 内容总高 = Σ 估值。真机上同一会话里既有 16px 的系统行，也有 600px 的工具卡，
 *   估值偏差累加后滚动条长度是假的，`scrollTop → 第几行` 的换算也跟着假 —— 表现为
 *   「翻到中段一片空白」「滚动条拖到底却还没到最后一条」。
 * - 每次渲染重建一个 N+1 的数组（N 到 400+），流式期间每 16ms 一次。
 *
 * 这里改成：**测到就用测到的，没测到才估**，并按行的**身份**（`turn.step` 这类位置键）
 * 记住高度 —— 换页 / 补页 / 缓存页换网络页时行会整体位移，按身份记才能在位移后仍然对得上。
 *
 * 一条安全规则（防"测量把自己顶跳"）：**视口顶部以上的行测到新高度时，必须把差值
 * 交给滚动层补回去** —— 那些行一变高/变矮，屏幕上可见的内容就会整体位移。`record()`
 * 把这份"该补多少"作为 `shift` 返回，调用方把它一次性交给滚动所有者（K4 的唯一写点）。
 *
 * @module dsh-palm/mobile/views/chat/lib/row-metrics
 */

/** 实测值与当前值的差小于它就不重算（亚像素抖动不算变化）。 */
export const HEIGHT_EPSILON_PX = 0.5

/** 一次记账的结果。 */
export interface RecordResult {
  /** 高度是否真的变了（调用方据此决定要不要重渲染）。 */
  changed: boolean
  /**
   * 这一行在视口顶部**以上**时的位移补偿（px，正数=内容长高了，需要把 scrollTop 加上它）。
   *
   * 在视口顶部以下（含正在看的那些行）恒为 0：它们变高只影响下面的占位，不动画面。
   */
  shift: number
}

export interface RowMetrics {
  /** 声明这一次渲染有多少行、每行是谁（身份键）。 */
  setRows(total: number, keyOf: (index: number) => string | undefined): void
  /** 视口顶部落在第几行：它的上方不再接受新测量值。 */
  setAnchor(index: number): void
  /**
   * 记一行的实测高度。
   *
   * @returns 是否真的改变了，以及（只在视口顶部以上的行）需要补偿给 `scrollTop` 的差值。
   */
  record(key: string, height: number): RecordResult
  /** 第 index 行的顶部相对内容顶的偏移。 */
  offset(index: number): number
  /** 第 index 行的高度（实测优先）。 */
  height(index: number): number
  /** 内容总高。 */
  totalHeight(): number
  /** `y` 落在第几行（返回最后一个 `offset <= y` 的行号）。 */
  indexAt(y: number): number
  /** 已经测到真实高度的行数（诊断用）。 */
  measuredCount(): number
  /** 换会话：清空全部实测值。 */
  reset(): void
}

/**
 * 建一个行高账本。
 *
 * @param estimateOf - 返回**当前**估值函数的取值器（调用点每帧都传新箭头函数，
 *   这里按引用取最新的那个，避免把它写进依赖）。
 */
export function createRowMetrics(estimateOf: () => (index: number) => number): RowMetrics {
  let total = 0
  let anchor = 0
  /** 按下标存：有实测就存数字，没有就是 undefined。 */
  let heights: Array<number | undefined> = []
  let prefix: number[] = [0]
  let dirty = true
  let firstKey: string | undefined
  let lastKey: string | undefined
  const byKey = new Map<string, number>()
  const indexOfKey = new Map<string, number>()

  const rebuild = (count: number, keyOf: (index: number) => string | undefined): void => {
    total = count
    heights = new Array<number | undefined>(count)
    indexOfKey.clear()
    for (let index = 0; index < count; index += 1) {
      const key = keyOf(index)
      if (key === undefined) continue
      indexOfKey.set(key, index)
      const measured = byKey.get(key)
      if (measured !== undefined) heights[index] = measured
    }
    firstKey = count === 0 ? undefined : keyOf(0)
    lastKey = count === 0 ? undefined : keyOf(count - 1)
    dirty = true
  }

  const ensure = (): void => {
    if (!dirty) return
    prefix = new Array<number>(total + 1)
    prefix[0] = 0
    const estimate = estimateOf()
    for (let index = 0; index < total; index += 1) {
      const measured = heights[index]
      prefix[index + 1] = prefix[index]! + (measured ?? estimate(index))
    }
    dirty = false
  }

  return {
    setRows(count, keyOf) {
      // 行数没变、首尾身份也没变：绝大多数渲染走这条，一次 map 都不用碰。
      if (count === total && count > 0 && keyOf(0) === firstKey && keyOf(count - 1) === lastKey) return
      rebuild(count, keyOf)
    },
    setAnchor(index) {
      anchor = index
    },
    record(key, height) {
      const index = indexOfKey.get(key)
      if (index === undefined) return { changed: false, shift: 0 }
      const estimate = estimateOf()
      const current = heights[index] ?? estimate(index)
      const delta = height - current
      if (Math.abs(delta) < HEIGHT_EPSILON_PX) return { changed: false, shift: 0 }
      heights[index] = height
      byKey.set(key, height)
      dirty = true
      // 视口顶部以上的行变高/变矮，下面所有内容都会跟着位移：把差值交回去补 scrollTop。
      return { changed: true, shift: index < anchor ? delta : 0 }
    },
    offset(index) {
      ensure()
      const clamped = Math.min(Math.max(0, index), total)
      return prefix[clamped]!
    },
    height(index) {
      if (index < 0 || index >= total) return 0
      const measured = heights[index]
      return measured ?? estimateOf()(index)
    },
    totalHeight() {
      ensure()
      return prefix[total]!
    },
    indexAt(y) {
      ensure()
      if (total === 0) return 0
      let lo = 0
      let hi = total - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (prefix[mid]! <= y) lo = mid
        else hi = mid - 1
      }
      return lo
    },
    measuredCount() {
      let count = 0
      for (const value of heights) if (value !== undefined) count += 1
      return count
    },
    reset() {
      byKey.clear()
      heights = []
      prefix = [0]
      total = 0
      anchor = 0
      firstKey = undefined
      lastKey = undefined
      dirty = true
    },
  }
}
