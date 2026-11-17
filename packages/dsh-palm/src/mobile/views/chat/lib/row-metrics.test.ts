import { describe, expect, it } from 'vitest'
import { createRowMetrics, HEIGHT_EPSILON_PX } from './row-metrics.ts'

const keys = (list: readonly string[]) => (index: number) => list[index]
const flat = (height: number) => (_index: number) => height

describe('行高账本', () => {
  it('没测到就按估值累加', () => {
    const metrics = createRowMetrics(() => flat(100))
    metrics.setRows(3, keys(['a', 'b', 'c']))
    expect(metrics.totalHeight()).toBe(300)
    expect(metrics.offset(2)).toBe(200)
    expect(metrics.indexAt(150)).toBe(1)
  })

  it('测到就用实测值（滚动条长度不再是假的）', () => {
    const metrics = createRowMetrics(() => flat(100))
    metrics.setRows(3, keys(['a', 'b', 'c']))
    metrics.setAnchor(0)
    expect(metrics.record('b', 600)).toEqual({ changed: true, shift: 0 })
    expect(metrics.totalHeight()).toBe(800)
    expect(metrics.offset(2)).toBe(700)
    expect(metrics.measuredCount()).toBe(1)
  })

  it('视口顶部以上的行变高：记账并交出需要补偿的位移', () => {
    const metrics = createRowMetrics(() => flat(100))
    metrics.setRows(3, keys(['a', 'b', 'c']))
    metrics.setAnchor(2)
    // a 在第一屏上方：它长高 500，下面所有内容都要下移 500
    expect(metrics.record('a', 600)).toEqual({ changed: true, shift: 500 })
    expect(metrics.totalHeight()).toBe(800)
  })

  it('视口顶部以下的行变高：只影响下方占位，不动画面', () => {
    const metrics = createRowMetrics(() => flat(100))
    metrics.setRows(3, keys(['a', 'b', 'c']))
    metrics.setAnchor(0)
    expect(metrics.record('c', 600)).toEqual({ changed: true, shift: 0 })
  })

  it('亚像素抖动不算变化', () => {
    const metrics = createRowMetrics(() => flat(100))
    metrics.setRows(2, keys(['a', 'b']))
    metrics.setAnchor(0)
    expect(metrics.record('a', 100 + HEIGHT_EPSILON_PX / 2)).toEqual({ changed: false, shift: 0 })
    expect(metrics.record('a', 120).changed).toBe(true)
  })

  it('行整体位移后按身份仍然对得上（补页/换生产者）', () => {
    const metrics = createRowMetrics(() => flat(100))
    metrics.setRows(3, keys(['a', 'b', 'c']))
    metrics.setAnchor(0)
    metrics.record('b', 500)
    // 前面插进来两行：a/b/c 整体后移两位
    metrics.setRows(5, keys(['x', 'y', 'a', 'b', 'c']))
    expect(metrics.offset(3)).toBe(300) // x、y、a 三行估值
    expect(metrics.height(3)).toBe(500) // b 还是实测的 500
    expect(metrics.totalHeight()).toBe(900)
  })

  it('换会话后实测值清空', () => {
    const metrics = createRowMetrics(() => flat(100))
    metrics.setRows(2, keys(['a', 'b']))
    metrics.setAnchor(0)
    metrics.record('a', 400)
    expect(metrics.totalHeight()).toBe(500)
    metrics.reset()
    metrics.setRows(2, keys(['a', 'b']))
    expect(metrics.totalHeight()).toBe(200)
  })

  it('行数没变、首尾身份也没变：不重建（流式每帧的常见路径）', () => {
    const metrics = createRowMetrics(() => flat(100))
    const list = ['a', 'b', 'c']
    metrics.setRows(3, keys(list))
    metrics.setAnchor(0)
    metrics.record('a', 300)
    // 同一批行再声明一次：实测值必须留着，不能被重建冲掉
    metrics.setRows(3, keys(list))
    expect(metrics.height(0)).toBe(300)
    expect(metrics.totalHeight()).toBe(500)
  })
})
