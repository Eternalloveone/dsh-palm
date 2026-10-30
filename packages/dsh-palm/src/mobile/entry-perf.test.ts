// @vitest-environment jsdom
/**
 * 首屏自适应窗口：按实测耗时在 2 MB / 512 KB 之间选。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ENTRY_SLOW_MS,
  TAIL_WINDOW_NARROW_BYTES,
  TAIL_WINDOW_WIDE_BYTES,
  preferredTailWindowBytes,
  rememberEntryLatency,
  resetEntryPerfForTest,
} from './entry-perf.ts'

beforeEach(() => {
  resetEntryPerfForTest()
})

describe('首屏窗口自适应', () => {
  it('没有历史数据时用宽松窗口（第一次尽量一次拿全）', () => {
    expect(preferredTailWindowBytes()).toBe(TAIL_WINDOW_WIDE_BYTES)
  })

  it('快过一次 → 仍然宽松', () => {
    rememberEntryLatency(400)
    expect(preferredTailWindowBytes()).toBe(TAIL_WINDOW_WIDE_BYTES)
  })

  it('慢过一次 → 退回保守窗口（先保证出内容快）', () => {
    rememberEntryLatency(ENTRY_SLOW_MS + 800)
    expect(preferredTailWindowBytes()).toBe(TAIL_WINDOW_NARROW_BYTES)
  })

  it('只取最近 3 次：快 → 快 → 快 会把之前的慢盖掉', () => {
    rememberEntryLatency(3000)
    expect(preferredTailWindowBytes()).toBe(TAIL_WINDOW_NARROW_BYTES)
    rememberEntryLatency(300)
    rememberEntryLatency(300)
    rememberEntryLatency(300)
    expect(preferredTailWindowBytes()).toBe(TAIL_WINDOW_WIDE_BYTES)
  })

  it('非法耗时被忽略（0 / NaN 不污染判断）', () => {
    rememberEntryLatency(0)
    rememberEntryLatency(Number.NaN)
    expect(preferredTailWindowBytes()).toBe(TAIL_WINDOW_WIDE_BYTES)
  })
})
