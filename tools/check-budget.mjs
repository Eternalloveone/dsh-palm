// 预算检查（命令行版）：node tools/check-budget.mjs [--write]
// 判定逻辑与 src/mobile/platform/budget.test.ts 一致；--write 把上限下调到当前实测值。
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dirname, '..')
const PKG = join(REPO, 'packages', 'dsh-palm')
const FILE = join(import.meta.dirname, 'budget.json')
const WRITE = process.argv.includes('--write')

/** 生成物不计：`mobile-styles.ts` 由 `scripts/gen-mobile-css.mjs` 从 `src/mobile/styles/*.css`
 *  拼出（那份 CSS 本身已计入），再计一遍等于同一份样式付两次预算。新鲜度由
 *  `mobile-styles.freshness.test.ts` 保证，不靠预算。 */
const GENERATED = new Set(['mobile-styles.ts'])
const isSource = name => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts') && !GENERATED.has(name)
const lines = file => {
  const t = readFileSync(file, 'utf8')
  return t.length === 0 ? 0 : t.split('\n').length
}
const dirLines = dir => {
  let total = 0
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) total += dirLines(abs)
    else if (isSource(name)) total += lines(abs)
  }
  return total
}

const budget = JSON.parse(readFileSync(FILE, 'utf8'))
const over = []

const stale = []
for (const [rel, cap] of Object.entries(budget.files)) {
  const abs = join(PKG, rel)
  if (!existsSync(abs)) continue
  const actual = lines(abs)
  if (actual > cap) over.push(`${rel}: ${actual} > ${cap}`)
  if (cap > Math.ceil(actual * 1.05) + 1) stale.push(`${rel}: 上限 ${cap} > 实测 ${actual}`)
  if (WRITE && actual < cap) budget.files[rel] = actual
}
for (const [rel, cap] of Object.entries(budget.dirs)) {
  const abs = join(PKG, rel)
  if (!existsSync(abs)) continue
  const actual = dirLines(abs)
  if (actual > cap) over.push(`${rel}: ${actual} > ${cap}`)
  if (cap > Math.ceil(actual * 1.05) + 1) stale.push(`${rel}: 上限 ${cap} > 实测 ${actual}`)
  if (WRITE && actual < cap) budget.dirs[rel] = actual
}

if (WRITE) {
  writeFileSync(FILE, `${JSON.stringify(budget, null, 2)}\n`)
  console.log('budget.json 已按当前实测下调')
}

if (over.length > 0) {
  console.error('预算超限：')
  for (const line of over) console.error('  ' + line)
  process.exit(1)
}
// 反向棘轮：上限远高于实测 = 预算虚高，退化了也不会报警。
if (!WRITE && stale.length > 0) {
  console.error('预算虚高：')
  for (const line of stale) console.error('  ' + line)
  console.error('  先跑 node tools/check-budget.mjs --write 把上限收到实测。')
  process.exit(1)
}
console.log(`预算通过：files=${Object.keys(budget.files).length} dirs=${Object.keys(budget.dirs).length}`)
