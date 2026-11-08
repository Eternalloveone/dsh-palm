import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src')
const files = []
;(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) walk(path)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(path)
  }
})(ROOT)

const buckets = ['mobile', 'client', 'host', 'notify', 'shared', 'usage', '']
const patterns = {
  'inline style': /\bstyle=\{\{/g,
  'raw <button': /<button\b/g,
  'onClick on div/span': /<(div|span|li|p)[^>]*onClick=/g,
  'console.log': /console\.(log|debug)\(/g,
  'any': /:\s*any\b|as any\b/g,
}

const table = new Map()
for (const path of files) {
  const rel = relative(ROOT, path)
  const bucket = buckets.find(prefix => prefix !== '' && (rel === prefix || rel.startsWith(prefix + '\\'))) ?? '(root)'
  const text = readFileSync(path, 'utf8')
  for (const [label, pattern] of Object.entries(patterns)) {
    const hits = (text.match(pattern) ?? []).length
    if (hits === 0) continue
    const key = `${bucket}|${label}`
    table.set(key, (table.get(key) ?? 0) + hits)
  }
}

const byBucket = new Map()
for (const [key, value] of table) {
  const [bucket, label] = key.split('|')
  if (!byBucket.has(bucket)) byBucket.set(bucket, {})
  byBucket.get(bucket)[label] = value
}

for (const [bucket, values] of [...byBucket.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(bucket.padEnd(10), JSON.stringify(values))
}

// mobile 里具体是哪些文件（棘轮只覆盖 mobile，这里点名便于处理）
console.log('\nmobile 子目录里的命中文件：')
for (const path of files) {
  const rel = relative(ROOT, path)
  if (!rel.startsWith('mobile\\')) continue
  const text = readFileSync(path, 'utf8')
  const hits = []
  for (const [label, pattern] of Object.entries(patterns)) {
    const count = (text.match(pattern) ?? []).length
    if (count > 0) hits.push(`${label}×${count}`)
  }
  if (hits.length > 0) console.log(`  ${rel}: ${hits.join(', ')}`)
}
