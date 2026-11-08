import { describe, expect, it } from 'vitest'
import { transitionAttr, transitionMs, transitionOf, TRANSITION_MS } from './transition.ts'

describe('转场判定（P7 内核）', () => {
  it('更深 = 往前', () => {
    expect(transitionOf(1, 2)).toBe('forward')
    expect(transitionOf(0, 1)).toBe('forward')
  })

  it('更浅 = 往后', () => {
    expect(transitionOf(3, 1)).toBe('back')
    expect(transitionOf(2, 0)).toBe('back')
  })

  it('同样深度 = 原地换（淡入淡出，不做方向）', () => {
    expect(transitionOf(2, 2)).toBe('replace')
    expect(transitionOf(0, 0)).toBe('replace')
  })

  it('首次渲染不做动画（冷启动不该看到滑动）', () => {
    expect(transitionOf(undefined, 2)).toBe('none')
  })

  it('非法深度一律不动作，不猜', () => {
    expect(transitionOf(Number.NaN, 1)).toBe('none')
    expect(transitionOf(1, Number.NaN)).toBe('none')
    expect(transitionOf(Number.POSITIVE_INFINITY, 1)).toBe('none')
  })

  it('三类转场都有正时长，none 为 0', () => {
    expect(TRANSITION_MS.forward).toBeGreaterThan(0)
    expect(TRANSITION_MS.back).toBeGreaterThan(0)
    expect(TRANSITION_MS.replace).toBeGreaterThan(0)
    expect(TRANSITION_MS.none).toBe(0)
  })

  it('减少动态效果时一律不动（含 replace）', () => {
    for (const kind of ['forward', 'back', 'replace', 'none'] as const) {
      expect(transitionMs(kind, true)).toBe(0)
    }
  })

  it('属性：减少动效或 none 时不写属性，避免 CSS 选到动画', () => {
    expect(transitionAttr('forward', false)).toBe('forward')
    expect(transitionAttr('none', false)).toBeUndefined()
    expect(transitionAttr('forward', true)).toBeUndefined()
  })

  it('同深度不判 back（App 既有的"同级也算往前"视觉不被改变）', () => {
    expect(transitionOf(2, 2)).not.toBe('back')
    expect(transitionOf(0, 0)).not.toBe('back')
  })
})
