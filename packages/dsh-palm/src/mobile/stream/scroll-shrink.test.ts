import { describe, expect, it } from 'vitest'
import { shouldRepinAfterShrink } from './scroll-shrink.ts'

describe('shouldRepinAfterShrink', () => {
  it('detects a meaningful shrink (收尾折叠 / settled parse 更短)', () => {
    expect(shouldRepinAfterShrink({ before: 5000, after: 2000 })).toBe(true)
  })

  it('ignores small layout noise', () => {
    expect(shouldRepinAfterShrink({ before: 1000, after: 990 })).toBe(false)
  })

  it('does not fire when the content grew', () => {
    expect(shouldRepinAfterShrink({ before: 1000, after: 1200 })).toBe(false)
  })

  it('honours a custom minimum', () => {
    expect(shouldRepinAfterShrink({ before: 1000, after: 980, minimumShrink: 10 })).toBe(true)
    expect(shouldRepinAfterShrink({ before: 1000, after: 950, minimumShrink: 100 })).toBe(false)
  })

  it('is safe on non-finite input', () => {
    expect(shouldRepinAfterShrink({ before: Number.NaN, after: 10 })).toBe(false)
  })
})
