/**
 * 审核用静态扫描：把「会累积的技术债」量化出来，避免凭印象下结论。
 * 只读，不改任何文件。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src')
const files = []
;(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) walk(path)
    else if (/\.(ts|tsx)$/.test(name)) files.push(path)
  }
})(ROOT)

const isTest = path => /\.test\.tsx?$/.test(path) || /\.spec\.ts$/.test(path)
const src = files.filter(path => !isTest(path))

const counters = {
  'any 类型': /:\s*any\b|<any>|as any\b/g,
  '@ts-ignore/@ts-expect-error': /@ts-(ignore|expect-error)/g,
  'console.log': /console\.(log|debug)\(/g,
  'TODO/FIXME/HACK': /\b(TODO|FIXME|HACK|XXX)\b/g,
  'eslint-disable': /eslint-disable/g,
  '行内 style={{': /\bstyle=\{\{/g,
  '裸 <button': /<button\b/g,
  'div/span 上 onClick': /<(div|span|li|p)[^>]*onClick=/g,
  '空的 catch': /catch\s*(\([^)]*\))?\s*\{\s*\}/g,
  '非空断言 !.': /\w!\./g,
}

const totals = Object.fromEntries(Object.keys(counters).map(key => [key, 0]))
const perFile = new Map()

for (const path of src) {
  const text = readFileSync(path, 'utf8')
  let local = 0
  for (const [key, pattern] of Object.entries(counters)) {
    const hits = (text.match(pattern) ?? []).length
    totals[key] += hits
    local += hits
  }
  if (local > 0) perFile.set(relative(ROOT, path), local)
}

console.log(`源码文件（不含测试）：${src.length}`)
console.log(`测试文件：${files.length - src.length}`)
console.log('')
for (const [key, value] of Object.entries(totals)) console.log(`${key.padEnd(24)} ${value}`)

console.log('\n命中最多的文件：')
for (const [path, count] of [...perFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${String(count).padStart(3)}  ${path}`)
}
