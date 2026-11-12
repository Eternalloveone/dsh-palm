/**
 * 占位符词池：每条都要短到一行，量高度时按最长那条量。
 */
import { describe, expect, it } from 'vitest'
import {
  IDLE_PLACEHOLDERS,
  PLACEHOLDER_MAX_CHARS,
  longestIdlePlaceholder,
  pickIdlePlaceholder,
} from './composer-placeholder.ts'

describe('输入框占位符词池', () => {
  it('每条都短到一行（超过它就会在窄框里换行，把输入框撑高）', () => {
    for (const candidate of IDLE_PLACEHOLDERS) {
      expect(candidate.length).toBeLessThanOrEqual(PLACEHOLDER_MAX_CHARS)
    }
  })

  it('第一条是保守的基准句', () => {
    expect(IDLE_PLACEHOLDERS[0]).toBe('说点什么...')
  })

  it('没有重复条目（重复等于池子变小）', () => {
    expect(new Set(IDLE_PLACEHOLDERS).size).toBe(IDLE_PLACEHOLDERS.length)
  })

  it('按随机数取词：0 取第一条，接近 1 取最后一条', () => {
    expect(pickIdlePlaceholder(() => 0)).toBe(IDLE_PLACEHOLDERS[0])
    expect(pickIdlePlaceholder(() => 0.9999)).toBe(IDLE_PLACEHOLDERS[IDLE_PLACEHOLDERS.length - 1])
  })

  it('随机数越界 / NaN 也不会取到 undefined', () => {
    expect(IDLE_PLACEHOLDERS).toContain(pickIdlePlaceholder(() => 1))
    expect(IDLE_PLACEHOLDERS).toContain(pickIdlePlaceholder(() => -3))
    expect(IDLE_PLACEHOLDERS).toContain(pickIdlePlaceholder(() => Number.NaN))
  })

  it('最长那条就是池里字面最长的，且量高度用它', () => {
    const longest = longestIdlePlaceholder()
    expect(IDLE_PLACEHOLDERS.every(candidate => candidate.length <= longest.length)).toBe(true)
    expect(IDLE_PLACEHOLDERS).toContain(longest)
  })
})
