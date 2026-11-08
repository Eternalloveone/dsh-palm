import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const MOBILE = join(ROOT, 'packages', 'dsh-palm', 'src', 'mobile')
const STYLES = join(MOBILE, 'styles')

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) walk(abs, out)
    else out.push(abs)
  }
  return out
}

const ALL = walk(MOBILE)
const PROD = ALL.filter(f => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('mobile-styles.ts'))
const TESTS = ALL.filter(f => /\.test\.tsx?$/.test(f))
const PROD_TEXT = PROD.map(f => readFileSync(f, 'utf8')).join('\n')
const TEST_TEXT = TESTS.map(f => readFileSync(f, 'utf8')).join('\n')

const dynamic = cls => {
  const parts = cls.split('-')
  for (let cut = parts.length - 1; cut >= 1; cut -= 1) {
    const prefix = parts.slice(0, cut).join('-')
    if (PROD_TEXT.includes(prefix + '-${') || PROD_TEXT.includes(prefix + ' ${')) return true
  }
  return false
}

const classes = new Map()
for (const name of readdirSync(STYLES).filter(n => n.endsWith('.css'))) {
  const text = readFileSync(join(STYLES, name), 'utf8')
  for (const match of text.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)) {
    const set = classes.get(match[1]) ?? new Set()
    set.add(name)
    classes.set(match[1], set)
  }
}

const safe = []
const risky = []
for (const [cls, files] of classes) {
  if (cls.length < 3) continue
  if (PROD_TEXT.includes(cls) || dynamic(cls)) continue
  if (TEST_TEXT.includes(cls)) { risky.push(cls); continue }
  safe.push({ cls, files: [...files].sort() })
}

console.log(`可安全删除 ${safe.length} 个；测试里仍引用（先别删）${risky.length} 个\n`)
for (const entry of safe) console.log(`  .${entry.cls}  (${entry.files.join(', ')})`)
console.log('\n测试仍引用：', risky.join(', '))
