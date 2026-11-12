/**
 * 落点判定的测试。
 *
 * 两个极端都在这里钉住：
 * - 判据太宽 → 偏半屏也算过（真机「高亮了但不在视口里」）
 * - 判据太死 → 内容没铺满时永远达不成（白烧补偿次数然后弹「定位未成功」）
 */
import { describe, expect, it } from 'vitest'
import { judgeLanding, landingDelta, needsSettle, type LandingMetrics } from './locate-landing.ts'

const base = (patch: Partial<LandingMetrics> = {}): LandingMetrics => ({
  anchorTop: 100,
  anchorHeight: 200,
  containerTop: 0,
  containerHeight: 800,
  scrollTop: 0,
  scrollHeight: 5000,
  topGap: 12,
  tolerancePx: 8,
  ...patch,
})

describe('judgeLanding：算不算到位', () => {
  it('容器没有可视高度 → unstable（布局未稳，别再重试）', () => {
    expect(judgeLanding(base({ containerHeight: 0 }))).toBe('unstable')
  })

  it('锚点贴着容器顶（在留白容差内）→ landed', () => {
    expect(judgeLanding(base({ anchorTop: 10 }))).toBe('landed')
  })

  it('锚点偏下一整屏 → 必须 adjust', () => {
    // 老判据「锚点在屏内就行」在这个位置会给过：锚点在视口里，但离顶部太远，
    // 用户看到的是上一段内容 —— 这就是「定位不准」的真机形态。
    expect(judgeLanding(base({ anchorTop: 700 }))).toBe('adjust')
  })

  it('锚点跑到视口上方（滚过头）→ adjust', () => {
    expect(judgeLanding(base({ anchorTop: -300 }))).toBe('adjust')
  })

  it('刚好在上沿容差边界内 → landed', () => {
    expect(judgeLanding(base({ anchorTop: -8 }))).toBe('landed')
  })

  it('滚到头了、锚点整块在视口里 → landed（贴顶达不成时放宽）', () => {
    const metrics = base({ anchorTop: 300, containerHeight: 800, scrollTop: 4200, scrollHeight: 5000 })
    expect(judgeLanding(metrics)).toBe('landed')
  })

  it('滚到头了、但锚点下半截还在视口外 → adjust', () => {
    const metrics = base({ anchorTop: 700, anchorHeight: 400, containerHeight: 800, scrollTop: 4200, scrollHeight: 5000 })
    expect(judgeLanding(metrics)).toBe('adjust')
  })

  it('slack 随视口高度伸缩，但夹在 16~48 之间', () => {
    // 小视口：slack = max(16, 0.25*h)
    expect(judgeLanding(base({ containerHeight: 100, anchorTop: 20 }))).toBe('landed')   // 16 内
    expect(judgeLanding(base({ containerHeight: 100, anchorTop: 60 }))).toBe('adjust')
    // 大视口：slack 封顶 48
    expect(judgeLanding(base({ containerHeight: 2000, anchorTop: 47 }))).toBe('landed')
    expect(judgeLanding(base({ containerHeight: 2000, anchorTop: 60 }))).toBe('adjust')
  })
})

describe('landingDelta：只补差额', () => {
  it('锚点在下方 → 正的差额', () => {
    expect(landingDelta(base({ anchorTop: 300, containerTop: 0, topGap: 12 }))).toBe(288)
  })

  it('锚点在上方 → 负的差额', () => {
    expect(landingDelta(base({ anchorTop: -100, containerTop: 0, topGap: 12 }))).toBe(-112)
  })

  it('已经在位 → 差额≈0', () => {
    expect(landingDelta(base({ anchorTop: 112, topGap: 12 }))).toBe(100)
  })
})

describe('needsSettle：收尾校准要不要动手', () => {
  it('偏得比半个留白多才补', () => {
    expect(needsSettle(10, 12)).toBe(false)
    expect(needsSettle(40, 12)).toBe(true)   // > max(24, 36)
    expect(needsSettle(-40, 12)).toBe(true)
  })

  it('留白很大时阈值跟着抬（topGap*3 超过 24 时）', () => {
    expect(needsSettle(30, 20)).toBe(false)  // 30 < 60
    expect(needsSettle(70, 20)).toBe(true)   // > 60
  })
})
