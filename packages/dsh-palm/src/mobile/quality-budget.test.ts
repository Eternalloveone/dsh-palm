/**
 * 质量预算的执行端（W1-6）。
 *
 * 口径（与 `quality-budget.ts` 的注释一一对应，改口径必须两边一起改）：
 * - 只扫 `src/mobile/` 下的生产文件（排除 `*.test.*` 与 `src/mobile/styles/*.css` 之外的单测）；
 * - `rawButtons` / `inlineStyles` 排除 `ui/`（内核自身必须有真 `<button>`）与测试；
 * - CSS 指标只看 `src/mobile/styles/*.css`（token 已在 design/tokens.ts，不计入）；
 * - `viewDataImports` = `views/` 下 import 了 `api.ts` 或 `mux.ts` 的文件数。
 *
 * @module dsh-palm/mobile/quality-budget.test
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { QUALITY_BUDGET, type BudgetKey } from './quality-budget.ts'

const MOBILE_ROOT = import.meta.dirname
const STYLES_DIR = join(MOBILE_ROOT, 'styles')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const ALL_FILES = walk(MOBILE_ROOT)
const PRODUCTION = ALL_FILES.filter(file => /\.(ts|tsx)$/.test(file) && !/\.test\./.test(file))
const TSX = PRODUCTION.filter(file => file.endsWith('.tsx'))
const isKernelFile = (file: string): boolean => relative(MOBILE_ROOT, file).split(/[\\/]/)[0] === 'ui'
const TSX_WITHOUT_KERNEL = TSX.filter(file => !isKernelFile(file))

const CSS = readdirSync(STYLES_DIR)
  .filter(name => name.endsWith('.css'))
  .sort()
  .map(name => readFileSync(join(STYLES_DIR, name), 'utf8'))
  .join('\n')

const countMatches = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length
const readAll = (files: string[]): string => files.map(file => readFileSync(file, 'utf8')).join('\n')

/** 当前实测值。新增指标时这里和 QUALITY_BUDGET 必须同时加，否则下面的完整性断言会红。 */
function measure(): Record<BudgetKey, number> {
  const tsx = readAll(TSX_WITHOUT_KERNEL)
  const views = PRODUCTION.filter(file => relative(MOBILE_ROOT, file).split(/[\\/]/)[0] === 'views')
  return {
    rawButtons: countMatches(tsx, /<button\b/g),
    inlineStyles: countMatches(tsx, /style=\{\{/g),
    cssHex: countMatches(CSS, /#[0-9a-fA-F]{3,8}\b/g),
    cssPx: countMatches(CSS, /\b\d+(\.\d+)?px\b/g),
    cssClasses: new Set(
      [...CSS.matchAll(/^\s*\.[a-zA-Z][a-zA-Z0-9_-]*/gm)].map(match => match[0].trim()),
    ).size,
    cssImportant: countMatches(CSS, /!important/g),
    viewDataImports: views.filter(file => /from\s+['"][^'"]*(?:api|mux)\.ts['"]/.test(readFileSync(file, 'utf8'))).length,
  }
}

const MEASURED = measure()

describe('质量预算（只降不升）', () => {
  it('每个预算项都有实测值，每个实测值都有预算项', () => {
    expect(Object.keys(MEASURED).sort()).toEqual(Object.keys(QUALITY_BUDGET).sort())
  })

  for (const key of Object.keys(QUALITY_BUDGET) as BudgetKey[]) {
    it(`${key} ≤ ${QUALITY_BUDGET[key].value}`, () => {
      const budget = QUALITY_BUDGET[key]
      const current = MEASURED[key]
      expect(
        current,
        `${key} 超预算：当前 ${current} > 上限 ${budget.value}。\n`
        + `防的是：${budget.why}\n`
        + `若确属必要，请在同一 commit 说明理由并上调 quality-budget.ts 的 ${key}。`,
      ).toBeLessThanOrEqual(budget.value)
    })
  }

  /*
   * 棘轮要真的会「往回咬」：只判上界的话，改好之后预算可以一直虚高。
   * 允许 5% 的余量（吸收抖动与小幅波动），超过就说明该把它调下来了。
   */
  for (const key of Object.keys(QUALITY_BUDGET) as BudgetKey[]) {
    it(`${key} 预算不虚高（实测 + 5% ≥ 预算）`, () => {
      const budget = QUALITY_BUDGET[key]
      const current = MEASURED[key]
      const ceiling = Math.ceil(current * 1.05) + 1
      expect(
        budget.value,
        `${key} 的预算停在 ${budget.value}，但实测已降到 ${current}。\n`
        + `把它改成 ${current}（或更接近的数），否则下次回退到 ${budget.value} 也不会报警。`,
      ).toBeLessThanOrEqual(ceiling)
    })
  }

  it('预算值都是非负整数', () => {
    for (const [key, budget] of Object.entries(QUALITY_BUDGET)) {
      expect(Number.isInteger(budget.value), `${key} 必须是整数`).toBe(true)
      expect(budget.value, `${key} 不能为负`).toBeGreaterThanOrEqual(0)
    }
  })
})
