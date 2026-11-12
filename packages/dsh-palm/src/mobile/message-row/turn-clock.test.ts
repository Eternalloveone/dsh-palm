// @vitest-environment node
/**
 * 秒表显示层（2026-11-11 用户：「计时有时候会跳变」）。
 *
 * 三条规则：①锚点变早时按倍速追、不一步跳 ②时钟往回拽时不回跳 ③收工定格不往回缩。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { forgetElapsed, resetElapsedSamples, settleElapsed, shownElapsed } from './turn-clock.ts'

beforeEach(() => { resetElapsedSamples() })

describe('秒表显示：只进不退', () => {
  it('第一次直接对齐数据层的读数', () => {
    expect(shownElapsed('s:1', 12_000, 1_000_000)).toBe(12_000)
  })

  it('目标超前时按最多 2 倍速追，不一步跳过去', () => {
    expect(shownElapsed('s:1', 12_000, 1_000_000)).toBe(12_000)
    // 一秒后数据层说真起点早了 8 秒 ⇒ 目标 21 秒。自然速度是 13 秒，这一帧最多再追 2 秒 = 15 秒。
    expect(shownElapsed('s:1', 21_000, 1_001_000)).toBe(15_000)
    expect(shownElapsed('s:1', 21_000, 1_002_000)).toBe(18_000)
    expect(shownElapsed('s:1', 21_000, 1_005_000)).toBe(21_000)
  })

  it('目标落后时按最多 2 倍速回落，不一步掉下去（也不把旧值焊死）', () => {
    expect(shownElapsed('s:1', 30_000, 2_000_000)).toBe(30_000)
    // 时钟校准把目标拽回 27 秒：这一帧最多回落 2 秒（31 → 29），下一秒到底。
    expect(shownElapsed('s:1', 27_000, 2_001_000)).toBe(29_000)
    expect(shownElapsed('s:1', 27_000, 2_002_000)).toBe(28_000)
    expect(shownElapsed('s:1', 27_000, 2_003_000)).toBe(27_000)
  })

  it('同一毫秒内重复渲染最多前进 250ms（不会卡死也不会乱跳）', () => {
    expect(shownElapsed('s:1', 1_000, 3_000_000)).toBe(1_000)
    expect(shownElapsed('s:1', 9_000, 3_000_000)).toBe(1_250)
    expect(shownElapsed('s:1', 9_000, 3_000_000)).toBe(1_500)
  })

  it('不同回合互不影响', () => {
    shownElapsed('s:1', 10_000, 1_000_000)
    expect(shownElapsed('s:2', 500, 1_000_000)).toBe(500)
    forgetElapsed('s:1')
    expect(shownElapsed('s:1', 3_000, 1_010_000)).toBe(3_000)
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