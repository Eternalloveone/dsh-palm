/**
 * 审核：找出「没人 import 的源文件」与「重复代码块」。
 * 只读。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const SRC = join(PKG, 'src')

const files = []
;(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) walk(path)
    else if (/\.(ts|tsx)$/.test(name)) files.push(path)
  }
})(SRC)

const production = files.filter(file => !/\.test\.tsx?$/.test(file))
const allText = new Map(production.map(file => [file, readFileSync(file, 'utf8')]))

/* ── 1) 没人 import 的文件 ──────────────────────────────────────────── */
// 入口：包入口、生成物、脚本、平台探测等按约定可能无人 import。
const ENTRY_HINTS = [
  'index.ts',
  'mobile-api.ts',
  'mobile/mobile-entry.ts',
  'mobile/mobile-styles.ts',
  'mobile/architecture',
]

const imported = new Set()
for (const [, text] of allText) {
  for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const spec = match[1]
    if (!spec.startsWith('.')) continue
    imported.add(basename(spec).replace(/\.tsx?$/, ''))
  }
}

const orphans = production
  .map(file => relative(SRC, file))
  .filter(rel => !ENTRY_HINTS.some(hint => rel.includes(hint)))
  .filter(rel => {
    const name = basename(rel).replace(/\.tsx?$/, '')
    return !imported.has(name)
  })

console.log(`源文件 ${production.length} 个，疑似无人 import：${orphans.length}`)
for (const rel of orphans.slice(0, 25)) console.log(`  ${rel}`)

/* ── 2) 重复代码块（连续 8 行完全相同，跨文件） ─────────────────────── */
const WINDOW = 8
const seen = new Map()
for (const [file, text] of allText) {
  const lines = text.split(/\r?\n/).map(line => line.trim())
  for (let i = 0; i + WINDOW <= lines.length; i += 1) {
    const block = lines.slice(i, i + WINDOW)
    // 跳过「几乎都是空行/括号」的块，那种重复不算债
    const meaningful = block.filter(line => line.length > 3 && !/^[)({}\[\];,]+$/.test(line))
    if (meaningful.length < WINDOW - 1) continue
    const key = block.join('\u0000')
    if (!seen.has(key)) seen.set(key, [])
    seen.get(key).push(`${relative(SRC, file)}:${i + 1}`)
  }
}

const duplicated = [...seen.entries()]
  .filter(([, places]) => new Set(places.map(place => place.split(':')[0])).size > 1)
  .sort((a, b) => b[1].length - a[1].length)

console.log(`\n跨文件重复块（≥${WINDOW} 行）：${duplicated.length}`)
for (const [, places] of duplicated.slice(0, 6)) {
  console.log(`  ×${places.length}  ${places.slice(0, 4).join(' | ')}`)
}
