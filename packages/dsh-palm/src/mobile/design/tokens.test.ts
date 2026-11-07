/**
 * 设计 token 的自检（W1-2）。
 *
 * 三件事必须机器可验：
 * 1. 浅色/深色两张表的**键集完全一致**——少一个键，对应元素在某一主题下就没有颜色；
 * 2. 生成的 CSS 里，钉死深色与跟随系统深色**逐字相同**——之前这里漂移过
 *    （--diff-add-bg 0.12 vs 0.08），是「同一个界面两种深色」的来源；
 * 3. 正文对比度达到 WCAG AA（4.5:1）。已知偏低的组合进 KNOWN_LOW 并记下当前比值，
 *    只许不变差、不许变好也不删——那是 W2 视觉重构的待办清单，谁修好了谁就把它从这里拿走。
 *
 * @module dsh-palm/mobile/design/tokens.test
 */
import { describe, expect, it } from 'vitest'
import { DARK_PALETTE, LIGHT_PALETTE, designTokensCss } from './tokens.ts'

/* ── WCAG 对比度 ─────────────────────────────────────────────────────── */

function channels(value: string): [number, number, number] | undefined {
  const match = /^#([0-9a-fA-F]{6})$/.exec(value)
  if (match === null) return undefined
  const n = Number.parseInt(match[1] ?? '', 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function luminance(value: string): number | undefined {
  const rgb = channels(value)
  if (rgb === undefined) return undefined
  const linear = rgb.map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

/** 两色对比度；只有 6 位 hex 能算，rgba/渐变返回 undefined。 */
function contrast(fg: string, bg: string): number | undefined {
  const a = luminance(fg)
  const b = luminance(bg)
  if (a === undefined || b === undefined) return undefined
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

/* ── 生成结果的结构 ──────────────────────────────────────────────────── */

const CSS = designTokensCss()

function bodyAfter(selector: string, close: string): string {
  const start = CSS.indexOf(selector)
  if (start === -1) throw new Error(`tokens: 生成结果里找不到 ${selector}`)
  const open = CSS.indexOf('{', start)
  const end = CSS.indexOf(close, open)
  return CSS.slice(open + 1, end)
}

const ROOT_BODY = bodyAfter(':root {', '\n}')
const DARK_BODY = bodyAfter(":root[data-theme='dark'] {", '\n}')
const MEDIA_BODY = bodyAfter("  :root:not([data-theme='light']) {", '\n  }')

/** 一段 CSS 里某个自定义属性的声明次数（重复声明 = 后写的悄悄失效）。 */
function declarationsOf(body: string, name: string): number {
  return body.split(`${name}:`).length - 1
}

/* ── 断言 ────────────────────────────────────────────────────────────── */

describe('design tokens', () => {
  it('两套主题的键集完全一致', () => {
    expect(Object.keys(LIGHT_PALETTE).sort()).toEqual(Object.keys(DARK_PALETTE).sort())
  })

  it('浅色进 :root，深色同时进「钉死」与「跟随系统」两处', () => {
    for (const [name, value] of Object.entries(LIGHT_PALETTE)) {
      expect(ROOT_BODY, `${name} 没进 :root`).toContain(`${name}: ${value};`)
      expect(declarationsOf(ROOT_BODY, name), `${name} 在 :root 里声明了多次`).toBe(1)
    }
    for (const [name, value] of Object.entries(DARK_PALETTE)) {
      expect(DARK_BODY, `${name} 没进钉死深色`).toContain(`${name}: ${value};`)
      expect(MEDIA_BODY, `${name} 没进系统深色`).toContain(`${name}: ${value};`)
      expect(declarationsOf(DARK_BODY, name), `${name} 在钉死深色里声明了多次`).toBe(1)
    }
  })

  it('钉死深色与跟随系统深色逐字相同', () => {
    const dedented = MEDIA_BODY
      .split('\n')
      .map(line => line.startsWith('  ') ? line.slice(2) : line)
      .join('\n')
    expect(dedented).toBe(DARK_BODY)
  })
})

/* ── 对比度 ──────────────────────────────────────────────────────────── */

interface Pair {
  theme: 'light' | 'dark'
  fg: `--${string}`
  bg: `--${string}`
  /** 当前实现的下限；只许变好。 */
  floor: number
}

/** 正文/代码这类「必须 AA」的组合。 */
const MUST_PASS: Array<Omit<Pair, 'floor'>> = [
  { theme: 'light', fg: '--text-primary', bg: '--bg-page' },
  { theme: 'light', fg: '--text-secondary', bg: '--bg-page' },
  { theme: 'light', fg: '--text-tertiary', bg: '--bg-page' },
  { theme: 'light', fg: '--text-primary', bg: '--card-bg' },
  { theme: 'light', fg: '--text-secondary', bg: '--card-bg' },
  { theme: 'light', fg: '--text-tertiary', bg: '--card-bg' },
  { theme: 'light', fg: '--code-text', bg: '--code-bg' },
  { theme: 'dark', fg: '--text-primary', bg: '--bg-page' },
  { theme: 'dark', fg: '--text-secondary', bg: '--bg-page' },
  { theme: 'dark', fg: '--text-primary', bg: '--card-bg' },
  { theme: 'dark', fg: '--text-secondary', bg: '--card-bg' },
  { theme: 'dark', fg: '--code-text', bg: '--code-bg' },
]

/**
 * 已知低于 AA 的组合（W2 视觉重构待办）。数值是当前实测下限：只许上升。
 * 深色的 tone-*-ink 背景是 rgba，需要与卡片底色合成才能算，暂不在此表。
 */
const KNOWN_LOW: Pair[] = [
  { theme: 'light', fg: '--text-quaternary', bg: '--bg-page', floor: 2.55 },
  { theme: 'light', fg: '--text-muted', bg: '--bg-page', floor: 1.96 },
  { theme: 'light', fg: '--accent-contrast', bg: '--accent', floor: 4.47 },
  { theme: 'light', fg: '--tone-positive-ink', bg: '--tone-positive-soft', floor: 3.12 },
  { theme: 'light', fg: '--tone-warning-ink', bg: '--tone-warning-soft', floor: 2.41 },
  { theme: 'light', fg: '--tone-info-ink', bg: '--tone-info-soft', floor: 4.06 },
  { theme: 'light', fg: '--tone-neutral-ink', bg: '--tone-neutral-soft', floor: 2.39 },
  { theme: 'dark', fg: '--text-tertiary', bg: '--bg-page', floor: 3.72 },
  { theme: 'dark', fg: '--text-tertiary', bg: '--card-bg', floor: 3.48 },
  { theme: 'dark', fg: '--text-quaternary', bg: '--bg-page', floor: 2.27 },
  { theme: 'dark', fg: '--text-muted', bg: '--bg-page', floor: 1.77 },
  { theme: 'dark', fg: '--accent-contrast', bg: '--accent', floor: 4.47 },
]

function ratio(theme: 'light' | 'dark', fg: `--${string}`, bg: `--${string}`): number {
  const palette = theme === 'light' ? LIGHT_PALETTE : DARK_PALETTE
  const value = contrast(palette[fg] ?? '', palette[bg] ?? '')
  if (value === undefined) throw new Error(`${theme}: ${fg} / ${bg} 不是可计算的 6 位 hex`)
  return value
}

describe('token 对比度', () => {
  it('正文与代码达到 WCAG AA（4.5:1）', () => {
    for (const { theme, fg, bg } of MUST_PASS) {
      expect(
        ratio(theme, fg, bg),
        `${theme}: ${fg} on ${bg} 低于 AA`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('已知偏低的组合不再变差', () => {
    for (const { theme, fg, bg, floor } of KNOWN_LOW) {
      const value = ratio(theme, fg, bg)
      expect(value, `${theme}: ${fg} on ${bg} 退化了（${value.toFixed(2)} < ${floor}）`)
        .toBeGreaterThanOrEqual(floor - 0.005)
    }
  })

  it('同一组合不会同时被要求「必须通过」和「已知偏低」', () => {
    const key = (p: { theme: string; fg: string; bg: string }): string => `${p.theme}|${p.fg}|${p.bg}`
    const must = new Set(MUST_PASS.map(key))
    const overlap = KNOWN_LOW.filter(p => must.has(key(p)))
    expect(overlap).toEqual([])
  })
})
