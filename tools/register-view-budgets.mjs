import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const PKG = join(ROOT, 'packages', 'dsh-palm')
const ARCH = join(PKG, 'src', 'mobile', 'architecture.test.ts')
const VIEWS = join(PKG, 'src', 'mobile', 'views')

const isSource = name => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')
const lines = file => readFileSync(file, 'utf8').split('\n').length

/** 只把"顶层视图"（views/*.tsx）纳入预算：子组件与 hooks 由目录预算兜住。 */
const files = []
const walk = dir => {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) walk(abs)
    else if (isSource(name)) files.push(abs)
  }
}
walk(VIEWS)

let text = readFileSync(ARCH, 'utf8')
const registered = new Set([...text.matchAll(/'views\/([^']+)': [\d_]+,/g)].map(m => m[1]))
const missing = files
  .map(file => 'views/' + relative(VIEWS, file).split(sep).join('/'))
  .filter(rel => rel.split('/').length === 2 && !registered.has(rel.slice('views/'.length)))

if (missing.length === 0) {
  console.log('所有顶层视图都已登记预算。')
  process.exit(0)
}

const entries = missing
  .map(rel => `      '${rel}': ${lines(join(VIEWS, rel.slice('views/'.length))) + 5},`)
  .join('\r\n')

const closeAt = text.indexOf("\n    }\n    for (const [file, budget] of Object.entries(budgets))")
if (closeAt === -1) {
  console.log('找不到 budgets 表的结束位置')
  process.exit(1)
}
text = text.slice(0, closeAt + 1) + entries + '\n' + text.slice(closeAt + 1)
writeFileSync(ARCH, text)
console.log('已登记新视图预算：')
for (const rel of missing) console.log('  ' + rel)
