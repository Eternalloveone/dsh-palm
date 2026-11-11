// @vitest-environment node
/**
 * 皮肤对比度（2026-11-10）。
 *
 * `design/tokens.test.ts` 只管注入的两套主题（light / dark），**三套皮肤
 * （graphite / paper / nocturne）的调色板没人管** —— 它们写在 `styles/000-tokens.css` 里，
 * 换肤后 `--palm-fg-3`（三级辅助文字）这类值可能掉到 AA 以下，而"低对比辅助文字"正是
 * 需求里点名要避免的。这里把三块皮肤的选择器解析出来，按 WCAG AA 量一遍。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(join(process.cwd(), 'src/mobile/styles/000-tokens.css'), 'utf8')

/** 取某个皮肤块里的 `--palm-xxx` 值表。 */
function skinPalette(skin: string): Record<string, string> {
  const start = CSS.indexOf(`html[data-skin='${skin}'] {`)
  if (start < 0) throw new Error(`找不到皮肤 ${skin}`)
  const open = CSS.indexOf('{', start)
  const body = CSS.slice(open + 1, CSS.indexOf('}', open))
  const palette: Record<string, string> = {}
  for (const line of body.split('\n')) {
    const match = /^\s*(--palm-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?|rgba?\([^)]*\))\s*;/.exec(line)
    if (match?.[1] !== undefined && match[2] !== undefined) palette[match[1]] = match[2]
  }
  return palette
}

/** 把 `rgba(r, g, b, a)` 叠到底色上，得到实际渲染色（语义底色都是半透明）。 */
function over(tint: string, bg: string): string {
  const match = /^rgba?\(([^)]*)\)$/.exec(tint)
  if (match === null) return tint
  const parts = match[1]!.split(',').map(part => Number.parseFloat(part.trim()))
  const [r = 0, g = 0, b = 0, a = 1] = parts
  const base = channels(bg)
  const mix = (top: number, bottom: number): number => Math.round(top * a + bottom * (1 - a))
  return `#${[mix(r, base[0]), mix(g, base[1]), mix(b, base[2])]
    .map(c => c.toString(16).padStart(2, '0'))
    .join('')}`
}

function channels(value: string): [number, number, number] {
  const n = Number.parseInt(value.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function luminance(value: string): number {
  const linear = channels(value).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
}

/** WCAG 对比度。 */
function contrast(fg: string, bg: string): number {
  const a = luminance(fg)
  const b = luminance(bg)
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

/** 皮肤里"正文级"的自定义属性：这些值在任何皮肤上都必须读得清。 */
const TEXT_TOKENS = ['--palm-fg', '--palm-fg-2', '--palm-fg-3'] as const

describe.each(['graphite', 'paper', 'nocturne', 'newsprint', 'endfield', 'claude'])('皮肤 %s 的对比度', (skin) => {
  const palette = skinPalette(skin)
  const bg = palette['--palm-bg']!

  it(`三级文字对底色都达到 WCAG AA 4.5:1`, () => {
    for (const token of TEXT_TOKENS) {
      const value = palette[token]
      expect(value, `${skin} 缺少 ${token}`).toBeDefined()
      const ratio = contrast(value!, bg)
      // 记下实测值，回退时一眼能看出改的是哪一档。
      expect(ratio, `${skin} ${token} ${value} on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('强调色上的文字也读得清（胶囊/按钮）', () => {
    const on = palette['--palm-on-accent']!
    expect(contrast(on, palette['--palm-accent']!), `${skin} on-accent/accent`).toBeGreaterThanOrEqual(4.5)
  })

  it('语义色写在自己的淡底上仍然达到 AA（警示条、错误卡、成功条）', () => {
    // 这三档是「警告/错误/完成」正文的实际配色：文字用 --palm-warn|danger|ok，
    // 底色是同一颜色的 10~12% 半透明叠在页面底色上。之前只量过纯色对底色，
    // 淡底一叠，实际对比度会再掉一截。
    const pairs = [
      { ink: '--palm-warn', tint: '--palm-tint-warn' },
      { ink: '--palm-danger', tint: '--palm-tint-danger' },
      { ink: '--palm-ok', tint: '--palm-tint-ok' },
    ] as const
    for (const { ink, tint } of pairs) {
      const surface = over(palette[tint]!, bg)
      const ratio = contrast(palette[ink]!, surface)
      expect(ratio, `${skin} ${ink} on ${tint}(${surface}) = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

/** 取皮肤块的原文（渐变这类值 skinPalette 解析不了）。 */
function skinBody(skin: string): string {
  const start = CSS.indexOf(`html[data-skin='${skin}'] {`)
  if (start < 0) throw new Error(`找不到皮肤 ${skin}`)
  const open = CSS.indexOf('{', start)
  return CSS.slice(open + 1, CSS.indexOf('}', open))
}

describe('纸色皮肤的过程条轨道（2026-11-10，900px 实拍）', () => {
  it('刻度轨令牌随平铺改版下线（不再需要为深色轨单独覆盖霓虹绿/靛）', () => {
    // 2026-11-10 第三版：状态条改成平铺一行，填充与刻度轨一起删除。
    // 这条用例改钉「它们真的没了」，免得以后有人把荧光绿又加回来。
    expect(CSS, '刻度轨令牌应当已删除').not.toContain('--palm-strip-rail-')
    expect(CSS, '深色渐变令牌应当已删除').not.toContain('--palm-strip-grad-')
  })
})

/*
 * 旧名 `--accent-soft`（design/tokens.ts 的淡靛底）要桥接到皮肤自己的强调淡底，
 * 否则换肤后"棕色文字 + 淡蓝底"这种半新半旧的组合会出现在同一枚徽章里。
 * 桥接的前提是这个淡底上的强调色文字仍然读得清 —— 先量，再桥。
 */
describe.each(['graphite', 'paper', 'nocturne', 'newsprint', 'endfield', 'claude'])('皮肤 %s 的强调淡底', (skin) => {
  it('强调色写在淡底上仍达到 AA 4.5:1', () => {
    const palette = skinPalette(skin)
    const bg = palette['--palm-bg']!
    const surface = over(palette['--palm-tint-accent']!, bg)
    const ratio = contrast(palette['--palm-accent']!, surface)
    expect(ratio, `${skin} accent on tint-accent(${surface}) = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
  })
})

describe('断线状态带上的文字（2026-11-10）', () => {
  // 把带子加深到 24% 之后，琥珀字写在琥珀带上的对比度掉到 4.04（纸色皮肤，低于 AA）。
  // 结论：带子负责"这是警告"，文字回到正文色（≥10:1）。这条用例守着这个结论。
  it.each(['graphite', 'paper', 'nocturne', 'newsprint', 'endfield', 'claude'])('%s：正文色写在断线带上仍 ≥ 7:1', (skin) => {
    const palette = skinPalette(skin)
    const bg = palette['--palm-bg']!
    const band = over(palette['--palm-warn-band']!, bg)
    const ratio = contrast(palette['--palm-fg']!, band)
    expect(ratio, `${skin} fg on warn-band = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(7)
  })
})
describe('裸字语义色（无淡底）也要够读（2026-11-10 通知页送达日志）', () => {
  // 送达日志的失败/已过滤行是**无底色**的红/琥珀字，直接压在卡片表面上。
  // 之前的用例只量过"语义色写在同色淡底上"，没量过裸字。
  it.each(['graphite', 'paper', 'nocturne', 'newsprint', 'endfield', 'claude'])('%s：danger / warn 裸字压在卡片表面 ≥ 4.5', (skin) => {
    const palette = skinPalette(skin)
    for (const ink of ['--palm-danger', '--palm-warn'] as const) {
      const ratio = contrast(palette[ink]!, palette['--palm-sur-1']!)
      expect(ratio, `${skin} ${ink} on surf-1 = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
describe('语义色 × 表面层：整张矩阵，而不是一条条补（2026-11-10）', () => {
  // 之前每条用例都是"某个色压某个底"，加一层表面就得再补一条。
  // 这里一次铺满：4 个语义色 × 3 个表面 × 3 套皮肤 = 36 个组合，全都要 ≥ 4.5。
  // 意义：以后新增表面层（或调任一语义色）会自动落进这张网。
  const SURFACES = ['--palm-bg', '--palm-sur-1', '--palm-sur-2'] as const
  const INKS = ['--palm-accent', '--palm-ok', '--palm-warn', '--palm-danger'] as const

  // 夜航的表面层写成 8 位十六进制（带 alpha），必须先叠到页面底色上再算对比度；
  // 否则拿 "#16203010" 去解析会直接抛错 —— 这正是这条矩阵用例第一次跑出来的问题。
  const solid = (value: string, bg: string): string => {
    const eight = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(value)
    if (eight?.[1] !== undefined && eight[2] !== undefined) {
      const n = parseInt(eight[1], 16)
      const alpha = parseInt(eight[2], 16) / 255
      return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha.toFixed(3)})`
    }
    return value
  }
  const surface = (skin: string, key: string): string => {
    const palette = skinPalette(skin)
    const bg = palette['--palm-bg']!
    return over(solid(palette[key]!, bg), bg)
  }

  for (const skin of ['graphite', 'paper', 'nocturne', 'newsprint', 'endfield', 'claude'] as const) {
    it(`${skin}：4 语义色 × 3 表面都 ≥ 4.5`, () => {
      const palette = skinPalette(skin)
      const failures: string[] = []
      for (const ink of INKS) {
        for (const surf of SURFACES) {
          const ratio = contrast(palette[ink]!, surface(skin, surf))
          if (ratio < 4.5) failures.push(`${ink} on ${surf} = ${ratio.toFixed(2)}`)
        }
      }
      expect(failures).toEqual([])
    })

    it(`${skin}：三级文字在三个表面上仍 ≥ 4.5，四级（辅助）≥ 3`, () => {
      const palette = skinPalette(skin)
      for (const surf of SURFACES) {
        const base = surface(skin, surf)
        expect(contrast(palette['--palm-fg']!, base), `fg on ${surf}`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(palette['--palm-fg-2']!, base), `fg-2 on ${surf}`).toBeGreaterThanOrEqual(4.5)
        // fg-3 是"辅助信息"，按 AA 大字/非文本的 3:1 兜底；fg-4 与它同色。
        expect(contrast(palette['--palm-fg-3']!, base), `fg-3 on ${surf}`).toBeGreaterThanOrEqual(3)
      }
    })
  }
})

describe('表面分层要看得出层（2026-11-10 卡片套卡片）', () => {
  // 夜航的 --palm-sur-2 原本是 6% 半透明：叠在 --palm-sur-1 上时两层只差 1.006:1，
  // 肉眼看是同一块。卡片里的卡片、浮层压在卡片上，全都"糊成一片"。
  // 这里给"层间距"定个下限：任何皮肤的第二层都要与第一层至少差 1.07:1。
  const solidOf = (value: string, bg: string): string => {
    const eight = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(value)
    if (eight?.[1] !== undefined && eight[2] !== undefined) {
      const n = parseInt(eight[1], 16)
      return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${(parseInt(eight[2], 16) / 255).toFixed(3)})`
    }
    return value
  }

  it.each(['graphite', 'paper', 'nocturne', 'newsprint', 'endfield', 'claude'])('%s：第二层表面与第一层差 ≥ 1.07:1', (skin) => {
    const palette = skinPalette(skin)
    const bg = palette['--palm-bg']!
    const layer1 = over(solidOf(palette['--palm-sur-1']!, bg), bg)
    const layer2 = over(solidOf(palette['--palm-sur-2']!, layer1), layer1)
    const step = contrast(layer1, layer2)
    expect(step, `${skin} sur-1 → sur-2 = ${step.toFixed(3)}`).toBeGreaterThanOrEqual(1.07)
  })
})
