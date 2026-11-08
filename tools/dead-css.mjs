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

const SOURCES = walk(MOBILE).filter(
  file => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.endsWith('mobile-styles.ts'),
)
const SOURCE_TEXT = SOURCES.map(file => readFileSync(file, 'utf8')).join('\n')

/** 动态拼接判定：类名去掉最后一段后，前缀在源码里以 `${` 或 `-` 形式出现。 */
function dynamicallyComposed(cls) {
  const parts = cls.split('-')
  for (let cut = parts.length - 1; cut >= 1; cut -= 1) {
    const prefix = parts.slice(0, cut).join('-')
    if (SOURCE_TEXT.includes(prefix + '-${') || SOURCE_TEXT.includes(prefix + ' ${')) return true
  }
  return false
}

const classes = new Map()
for (const name of readdirSync(STYLES).filter(n => n.endsWith('.css')).sort()) {
  const text = readFileSync(join(STYLES, name), 'utf8')
  for (const match of text.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)) {
    const where = classes.get(match[1]) ?? new Set()
    where.add(name)
    classes.set(match[1], where)
  }
}

const dead = []
const dynamic = []
for (const [cls, where] of classes) {
  if (cls.length < 3) continue
  if (SOURCE_TEXT.includes(cls)) continue
  if (dynamicallyComposed(cls)) {
    dynamic.push(cls)
    continue
  }
  dead.push({ cls, files: [...where].sort() })
}

console.log(`类名 ${classes.size} 个；确认无人引用 ${dead.length} 个；动态拼接（不误删）${dynamic.length} 个\n`)
for (const entry of dead) console.log(`  .${entry.cls}  (${entry.files.join(', ')})`)
console.log('\n动态拼接样本：', dynamic.slice(0, 8).join(', '))
