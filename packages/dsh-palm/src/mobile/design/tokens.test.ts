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
import { DARK_PALETTE, LIGHT_PALETTE, SYNTAX_DARK, SYNTAX_LIGHT, designTokensCss } from './tokens.ts'

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

/** 运行时允许由主题切换的令牌：只有语法高亮。 */
const SYNTAX_ONLY = /^--tok-/

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

  it(
    // 2026-11-10 起，这里只验**语法高亮**两套色板：界面颜色全部由 000-tokens.css
    // 的皮肤令牌定义，生成器不再铺第二份（见下一条用例）。
    '语法高亮：浅色进 :root，深色同时进「钉死」与「跟随系统」两处',
    () => {
      for (const [name, value] of Object.entries(SYNTAX_LIGHT)) {
        expect(ROOT_BODY, `${name} 没进 :root`).toContain(`${name}: ${value};`)
        expect(declarationsOf(ROOT_BODY, name), `${name} 在 :root 里声明了多次`).toBe(1)
      }
      for (const [name, value] of Object.entries(SYNTAX_DARK)) {
        expect(DARK_BODY, `${name} 没进钉死深色`).toContain(`${name}: ${value};`)
        expect(MEDIA_BODY, `${name} 没进系统深色`).toContain(`${name}: ${value};`)
        expect(declarationsOf(DARK_BODY, name), `${name} 在钉死深色里声明了多次`).toBe(1)
      }
    },
  )

  it(
    // 这条是「主题与皮肤冲突」的根本解法：生成器**不许**再输出任何界面颜色。
    // 一旦有人把 --accent / --bg-page 之类重新铺进 :root，运行时就又有两套色板
    // 抢同一个属性，纸色 / 夜航皮肤会重新出现"半套旧色"。
    '生成器只输出语法色板，界面颜色一律交给皮肤令牌',
    () => {
      const leaked = Object.keys(LIGHT_PALETTE)
        .filter((name) => !SYNTAX_ONLY.test(name))
        .filter((name) => CSS.includes(`${name}:`))
      expect(leaked, '这些界面颜色不该出现在生成的 CSS 里').toEqual([])
    },
  )

  it('钉死深色与跟随系统深色逐字相同', () => {
    const dedented = MEDIA_BODY
      .split('\n')
      .map(line => line.startsWith('  ') ? line.slice(2) : line)
      .join('\n')
    expect(dedented).toBe(DARK_BODY)
  })
})

/* ── 对比度 ──────────────────────────────────────────────────────────── */

/**
 * 对比度：**全部**必须达到 WCAG AA（4.5:1）。
 *
 * W2-1 之前这里还有一张 `KNOWN_LOW` 表（quaternary 2.55、muted 1.96、tone inks 2.4–4.1…），
 * 意思是"已知偏低，只许变好"。那一批现在全部修掉了：
 * - 文字收敛成三级，quaternary/muted 成为 tertiary 的兼容别名（层级交给字号与字重）；
 * - accent 压深到 #5b5cf0（白字 4.96，它自己当文字用也是 4.96）；
 * - 四个 tone ink 重新取值，最低 4.55。
 *
 * 深色的 tone-*-ink 背景是 rgba，需与卡片底色合成才能算，仍不在此表（W2 屏级重写时补）。
 */
const MUST_PASS: Array<{ theme: 'light' | 'dark'; fg: `--${string}`; bg: `--${string}` }> = [
  { theme: 'light', fg: '--text-primary', bg: '--bg-page' },
  { theme: 'light', fg: '--text-secondary', bg: '--bg-page' },
  { theme: 'light', fg: '--text-tertiary', bg: '--bg-page' },
  { theme: 'light', fg: '--text-quaternary', bg: '--bg-page' },
  { theme: 'light', fg: '--text-muted', bg: '--bg-page' },
  { theme: 'light', fg: '--text-primary', bg: '--card-bg' },
  { theme: 'light', fg: '--text-secondary', bg: '--card-bg' },
  { theme: 'light', fg: '--text-tertiary', bg: '--card-bg' },
  { theme: 'light', fg: '--code-text', bg: '--code-bg' },
  { theme: 'light', fg: '--accent-contrast', bg: '--accent' },
  { theme: 'light', fg: '--accent', bg: '--card-bg' },
  { theme: 'light', fg: '--tone-positive-ink', bg: '--tone-positive-soft' },
  { theme: 'light', fg: '--tone-warning-ink', bg: '--tone-warning-soft' },
  { theme: 'light', fg: '--tone-info-ink', bg: '--tone-info-soft' },
  { theme: 'light', fg: '--tone-neutral-ink', bg: '--tone-neutral-soft' },
  { theme: 'dark', fg: '--text-primary', bg: '--bg-page' },
  { theme: 'dark', fg: '--text-secondary', bg: '--bg-page' },
  { theme: 'dark', fg: '--text-tertiary', bg: '--bg-page' },
  { theme: 'dark', fg: '--text-quaternary', bg: '--bg-page' },
  { theme: 'dark', fg: '--text-muted', bg: '--bg-page' },
  { theme: 'dark', fg: '--text-primary', bg: '--card-bg' },
  { theme: 'dark', fg: '--text-secondary', bg: '--card-bg' },
  { theme: 'dark', fg: '--text-tertiary', bg: '--card-bg' },
  { theme: 'dark', fg: '--code-text', bg: '--code-bg' },
  { theme: 'dark', fg: '--accent-contrast', bg: '--accent' },
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

  it('文字层级收敛成三级：quaternary / muted 是 tertiary 的别名', () => {
    // 不是"顺手抄一个同色值"：三者必须完全相等，否则又会有人拿更浅的灰去做元信息，
    // 把 4.5 的底线重新破掉。层级交给字号与字重，不再交给亮度。
    for (const theme of ['light', 'dark'] as const) {
      const palette = theme === 'light' ? LIGHT_PALETTE : DARK_PALETTE
      expect(palette['--text-quaternary']).toBe(palette['--text-tertiary'])
      expect(palette['--text-muted']).toBe(palette['--text-tertiary'])
    }
  })

  it('accent 上放白字达标，accent 当文字用在白底上也达标', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(ratio(theme, '--accent-contrast', '--accent')).toBeGreaterThanOrEqual(4.5)
    }
    expect(ratio('light', '--accent', '--card-bg')).toBeGreaterThanOrEqual(4.5)
  })

  it('深色主题的 accent 当文字用仍不足（已知缺口，W2 屏级重写时补 --accent-text）', () => {
    // 钉成"已知问题"而不是默默忽略：现在暗底上 #5b5cf0 只有 3.98。
    expect(ratio('dark', '--accent', '--bg-page')).toBeLessThan(4.5)
  })
})
