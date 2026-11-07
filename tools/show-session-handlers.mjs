import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const lines = readFileSync(API, 'utf8').split('\n')

// 列出所有 session.* 处理器的位置与行数
const rows = []
for (let i = 0; i < lines.length; i += 1) {
  const m = /^\s*\['(session\.[A-Za-z]+)', async \(ctx\) => \{/.exec(lines[i])
  if (!m) continue
  let end = i
  for (let j = i; j < lines.length; j += 1) {
    if (lines[j].trim() === '}],') { end = j; break }
  }
  rows.push({ method: m[1], start: i + 1, end: end + 1, size: end - i + 1 })
  i = end
}
for (const row of rows) console.log(`${row.method.padEnd(22)} L${row.start}-${row.end}  ${row.size} 行`)
console.log(`合计 ${rows.length} 个，${rows.reduce((n, r) => n + r.size, 0)} 行`)

const target = process.argv[2]
if (target) {
  const row = rows.find(r => r.method === target)
  if (row) console.log(lines.slice(row.start - 1, row.end).join('\n'))
}
