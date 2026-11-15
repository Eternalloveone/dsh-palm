// @vitest-environment node
/**
 * 秒表显示层（2026-11-13 重写：锚点定死 + 每帧重算）。
 *
 * 用户诉求：**计时不要跳**。所以这里钉死三件事：
 *   ① 数据层怎么修（目标突增/回退），屏幕上的数只按本地时间匀速走；
 *   ② 绝不回退；
 *   ③ 收工用宿主 durationMs 定格。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { forgetElapsed, resetElapsedSamples, settleElapsed, shownElapsed } from './turn-clock.ts'

beforeEach(() => { resetElapsedSamples() })

describe('秒表显示：匀速、不跳、不退', () => {
  it('首帧直接对齐数据层的读数', () => {
    expect(shownElapsed('s:1', 12_000, 1_000_000)).toBe(12_000)
  })

  it('目标突增 30 秒（锚点被修正变早）：只按本地时间 +1 秒，不追涨', () => {
    expect(shownElapsed('s:1', 12_000, 1_000_000)).toBe(12_000)
    // 2 秒后（已过首帧窗口）数据层说真起点早了 30 秒（目标 44 秒）。
    // 旧实现会按 2 倍速追；新实现只加本地那 2 秒 —— 屏幕上不许"快速跳动"。
    expect(shownElapsed('s:1', 44_000, 1_002_000)).toBe(14_000)
    expect(shownElapsed('s:1', 44_000, 1_003_000)).toBe(15_000)
    expect(shownElapsed('s:1', 44_000, 1_005_000)).toBe(17_000)
  })

  it('目标回退 30 秒（时钟收敛往回拽）：绝不回退', () => {
    expect(shownElapsed('s:1', 30_000, 2_000_000)).toBe(30_000)
    expect(shownElapsed('s:1', 1_000, 2_002_000)).toBe(32_000)
  })

  it('同一毫秒内重复渲染：读数不变（重算而非累加）', () => {
    expect(shownElapsed('s:1', 1_000, 3_000_000)).toBe(1_000)
    expect(shownElapsed('s:1', 9_000, 3_000_000)).toBe(1_000)
  })

  it('刚上屏 1.5 秒内差得离谱：允许重定锚一次（首帧正确性优先）', () => {
    expect(shownElapsed('s:1', 500, 1_000_000)).toBe(500)
    // 80ms 后真锚点到齐，差 40 秒 ⇒ 重定锚，直接显示真值。
    expect(shownElapsed('s:1', 40_500, 1_000_080)).toBe(40_500)
    // 重定锚只发生一次：之后回到匀速。
    expect(shownElapsed('s:1', 40_500, 1_001_080)).toBe(41_500)
  })

  it('超过首帧窗口后即使差得离谱也不跳（稳态后一切都按本地时间）', () => {
    expect(shownElapsed('s:1', 1_000, 1_000_000)).toBe(1_000)
    // 5 秒后才来真锚点：过了窗口，不许跳。
    expect(shownElapsed('s:1', 90_000, 1_005_000)).toBe(6_000)
  })

  it('不同回合互不影响', () => {
    shownElapsed('s:1', 10_000, 1_000_000)
    expect(shownElapsed('s:2', 500, 1_000_000)).toBe(500)
    forgetElapsed('s:1')
    expect(shownElapsed('s:1', 3_000, 1_010_000)).toBe(3_000)
  })

  /*
   * 真机 2026-11-14（用户第四次报「计时明显不是真正的时间」）：新轮首帧的锚点是**上一轮**的
   * 起点，屏幕显示 43 分 34 秒，实际只跑了 8 分钟。修好数据层之后，显示层还挡着 ——
   * 锚点定死意味着"纠正到不了屏幕"。所以：起点本身被纠正（差 > 10s）时必须重定锚。
   */
  it('数据层把起点纠正得晚很多（上一轮错值 → 本轮真起点）：数字跟着改，不锁死', () => {
    // 首帧：错锚点给出 43 分 34 秒。
    expect(shownElapsed('s:7', 2_614_000, 5_000_000, true, 2_385_400)).toBe(2_614_000)
    // 60 秒后发现起点其实是 13:21（锚点后移了 35 分钟）：显示改为真实的 60 秒。
    expect(shownElapsed('s:7', 60_000, 5_060_000, true, 5_000_000)).toBe(60_000)
    // 之后照常匀速，并且不再回头。
    expect(shownElapsed('s:7', 61_000, 5_061_000, true, 5_000_000)).toBe(61_000)
  })

  it('起点只校准几秒：不重定锚，屏幕继续匀速（不因校准而抖动）', () => {
    expect(shownElapsed('s:8', 12_000, 1_000_000, true, 988_000)).toBe(12_000)
    // 起点只早了 3 秒（在校准范围内）：读数继续按本地时间走。
    expect(shownElapsed('s:8', 15_000, 1_002_000, true, 985_000)).toBe(14_000)
  })
})

describe('收工定格', () => {
  it('差 5 秒以内取较大的那个（收工那一瞬不往回缩）', () => {
    shownElapsed('s:1', 20_000, 1_000_000)
    expect(settleElapsed('s:1', 18_000)).toBe(20_000)
    expect(settleElapsed('s:1', 21_000)).toBe(21_000)
  })

  it('差得多以宿主的 durationMs 为准（那是真值）', () => {
    shownElapsed('s:1', 5_000, 1_000_000)
    expect(settleElapsed('s:1', 342_000)).toBe(342_000)
  })

  it('没有显示记录时直接用 durationMs', () => {
    expect(settleElapsed('nobody', 42_000)).toBe(42_000)
  })
})
