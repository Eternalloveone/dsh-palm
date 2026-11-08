/**
 * 审核：真正的「生产无引用」模块清单（按 import 图求入度，而不是猜文件名）。
 * 只读。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const SRC = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src')
const files = []
;(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) walk(path)
    else if (/\.(ts|tsx)$/.test(name)) files.push(path)
  }
})(SRC)

const isTest = path => /\.test\.tsx?$/.test(path) || /\.spec\.ts$/.test(path)
const prod = files.filter(file => !isTest(file))
const prodSet = new Set(prod)

/** 入口：没有任何人 import 它们是正常的。 */
const ENTRIES = new Set([
  join(SRC, 'index.ts'),
  join(SRC, 'mobile-api.ts'),
  join(SRC, 'mobile', 'mobile-styles.ts'),
  join(SRC, 'mobile', 'styles', 'index.ts'),
])

const incoming = new Map(prod.map(file => [file, new Set()]))
const testIncoming = new Map(prod.map(file => [file, new Set()]))

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const source = isTest(file) ? testIncoming : incoming
  // 静态 import 与动态 import() 都算引用：视图是 lazy 进来的，只看 from 会误判成孤儿
  for (const match of text.matchAll(/(?:from|import\()\s*['"](\.[^'"]+)['"]/g)) {
    const target = resolve(dirname(file), match[1])
    if (existsSync(target) && prodSet.has(target)) source.get(target)?.add(relative(SRC, file))
  }
}

const orphans = prod
  .filter(file => !ENTRIES.has(file))
  .filter(file => incoming.get(file).size === 0)

console.log(`生产文件 ${prod.length} 个，生产入度 0 的：${orphans.length}\n`)
for (const file of orphans) {
  const tests = [...(testIncoming.get(file) ?? [])]
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).length
  console.log(
    `${relative(SRC, file).padEnd(48)} ${String(lines).padStart(4)} 行  `
    + (tests.length === 0 ? '★ 连测试都没有' : `仅测试引用（${tests.length}）`),
  )
}
