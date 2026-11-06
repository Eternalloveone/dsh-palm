/**
 * 层级表自检：这是「同屏叠加态」审查的结构化那一半。
 *
 * 真机事故（2026-11-06 截图）：toast 写死 `bottom: 104px`，队列条一出现就盖住
 * 「撤回」。根因不是某一条规则写错，而是**没有任何地方声明谁在谁上面** —— 18 个
 * 浮层各写各的数字，没人能一眼看出顺序，也没人能拦住下一个人再写一个 60。
 *
 * 所以这里断言一个"层级表"存在且被遵守：
 * 1. 所有 z-index 只能引用 `--z-*` 变量（页面转场 1/2、局部 1 除外）；
 * 2. 变量值非递减，头 < 输入栏 < sheet < ctx/离线 < toast < 灯箱；
 * 3. toast 用测量出来的 `--toast-lift`，并且在 sheet/dialog 打开时移到顶部。
 *
 * 新增浮层时：先在 `:root` 的层级表里加一行，再引用变量。忘了会在这里红。
 *
 * @module dsh-palm/mobile/mobile-layers.test
 */
import { describe, expect, it } from 'vitest'
import { mobileCss } from './mobile-styles.ts'

/** Local stacking contexts that are allowed raw numbers (not app-wide layers). */
const LOCAL_STACKING = new Set(['1', '2'])

function rawZIndexes(): Array<{ value: string; line: number }> {
  const result: Array<{ value: string; line: number }> = []
  const pattern = /z-index:\s*([^;]+);/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(mobileCss)) !== null) {
    const before = mobileCss.slice(0, match.index)
    result.push({ value: (match[1] ?? '').trim(), line: before.split('\n').length })
  }
  return result
}

function tokenValue(name: string): number {
  const match = new RegExp(`${name}:\\s*(\\d+);`).exec(mobileCss)
  return match === null ? Number.NaN : Number(match[1])
}

describe('z-index ladder', () => {
  it('never writes a magic app-level z-index (tokens only)', () => {
    const offenders = rawZIndexes().filter(({ value }) => {
      if (LOCAL_STACKING.has(value)) return false
      return !value.startsWith('var(--z-') && !value.startsWith('calc(var(--z-')
    })
    expect(offenders).toEqual([])
  })

  it('declares the ladder once, in the documented ascending order', () => {
    const order = [
      '--z-header',
      '--z-scrim',
      '--z-popover',
      '--z-composer',
      '--z-voice',
      '--z-sheet',
      '--z-ctx',
      '--z-offline',
      '--z-toast',
      '--z-lightbox',
    ]
    const values = order.map(tokenValue)
    expect(values.every(Number.isFinite)).toBe(true)
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]!).toBeGreaterThanOrEqual(values[index - 1]!)
    }
    expect(values[0]).toBe(10)
    expect(values.at(-1)).toBe(200)
  })

  it('keeps toast above sheets but below the lightbox', () => {
    expect(tokenValue('--z-toast')).toBeGreaterThan(tokenValue('--z-sheet'))
    expect(tokenValue('--z-lightbox')).toBeGreaterThan(tokenValue('--z-toast'))
  })

  it('toast host follows the measured lift and steps aside for sheets/dialogs', () => {
    expect(mobileCss).toContain('bottom: calc(var(--toast-lift)')
    expect(mobileCss).toContain('--toast-lift: 104px')
    expect(mobileCss).toMatch(/body:has\(\.sheet-backdrop\) \.toast-host/)
    expect(mobileCss).toMatch(/body:has\(\.dialog-backdrop\) \.toast-host/)
  })

  it('hides toasts under the lightbox (nothing may float over a full-screen image)', () => {
    expect(mobileCss).toMatch(/body:has\(\.lightbox-backdrop\) \.toast-host/)
  })
})
