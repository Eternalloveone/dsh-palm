// 行数预算（双曲线）：单文件 + 目录总量，只降不升。
// 这是"拆了文件但总量不减"的唯一拦路者。
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', '..', '..')
const REPO = join(PKG, '..', '..')
const BUDGET_FILE = join(REPO, 'tools', 'budget.json')

interface Budget {
  files: Record<string, number>
  dirs: Record<string, number>
  filesRaised?: Record<string, { reason: string; expires: string }>
  dirsRaised?: Record<string, { reason: string; expires: string }>
}

/** 生成物不计：`mobile-styles.ts` 由 `scripts/gen-mobile-css.mjs` 从 `src/mobile/styles/*.css`
 *  拼出（那份 CSS 本身已计入），再计一遍等于同一份样式付两次预算。新鲜度由
 *  `mobile-styles.freshness.test.ts` 保证，不靠预算。 */
const GENERATED = new Set(['mobile-styles.ts'])
const isSource = (name: string) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts') && !GENERATED.has(name)

function countLines(file: string): number {
  const text = readFileSync(file, 'utf8')
  return text.length === 0 ? 0 : text.split('\n').length
}

function dirLines(dir: string): number {
  let total = 0
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) total += dirLines(abs)
    else if (isSource(name)) total += countLines(abs)
  }
  return total
}

const budget: Budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'))

describe('行数预算（只降不升）', () => {
  it('单文件不超上限', () => {
    const over: string[] = []
    for (const [rel, cap] of Object.entries(budget.files)) {
      const abs = join(PKG, rel)
      let actual = 0
      try {
        actual = countLines(abs)
      } catch {
        continue // 文件已被删除 = 预算自然归零
      }
      if (actual > cap) over.push(`${rel}: ${actual} > ${cap}`)
    }
    expect(over).toEqual([])
  })

  it('目录总量不超上限', () => {
    const over: string[] = []
    for (const [rel, cap] of Object.entries(budget.dirs)) {
      const abs = join(PKG, rel)
      let actual = 0
      try {
        actual = dirLines(abs)
      } catch {
        continue
      }
      if (actual > cap) over.push(`${rel}: ${actual} > ${cap}`)
    }
    expect(over).toEqual([])
  })

  it('预算没有虚高（上限不得超过实测的 105% + 1）', () => {
    const stale: string[] = []
    for (const [rel, cap] of Object.entries(budget.files)) {
      let actual = 0
      try {
        actual = countLines(join(PKG, rel))
      } catch {
        continue
      }
      if (cap > Math.ceil(actual * 1.05) + 1) stale.push(`file ${rel}: cap ${cap} > 实测 ${actual}`)
    }
    for (const [rel, cap] of Object.entries(budget.dirs)) {
      let actual = 0
      try {
        actual = dirLines(join(PKG, rel))
      } catch {
        continue
      }
      if (cap > Math.ceil(actual * 1.05) + 1) stale.push(`dir ${rel}: cap ${cap} > 实测 ${actual}`)
    }
    expect(stale, `预算虚高，先跑 node tools/check-budget.mjs --write 收回：\n${stale.join('\n')}`).toEqual([])
  })

  it('没有已过期的"上调豁免"', () => {
    const today = new Date().toISOString().slice(0, 10)
    const expired: string[] = []
    const check = (raised: Budget['filesRaised'], scope: string) => {
      for (const [key, entry] of Object.entries(raised ?? {})) {
        if (!entry.expires || entry.expires < today) expired.push(`${scope}:${key}`)
      }
    }
    check(budget.filesRaised, 'file')
    check(budget.dirsRaised, 'dir')
    expect(expired).toEqual([])
  })
})
