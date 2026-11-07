import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const lines = readFileSync(API, 'utf8').split('\n')

// 方法常量映射
const constToMethod = new Map()
for (const line of lines) {
  const m = /^const ([A-Z][A-Z0-9_]*) = '([a-z][\w]*\.[\w]+)'/.exec(line.replace(/\r$/, ''))
  if (m) constToMethod.set(m[1], m[2])
}

const rows = []
for (let i = 0; i < lines.length; i += 1) {
  const inline = /^\s*\['(mobile\.[A-Za-z]+)', async \(ctx\) => \{/.exec(lines[i])
  const viaConst = /^\s*\[([A-Z][A-Z0-9_]*), async \(ctx\) => \{/.exec(lines[i])
  const method = inline ? inline[1] : (viaConst && constToMethod.get(viaConst[1])?.startsWith('mobile.') ? constToMethod.get(viaConst[1]) : undefined)
  if (!method) continue
  let end = i
  for (let j = i; j < lines.length; j += 1) {
    if (lines[j].trim() === '}],') { end = j; break }
  }
  rows.push({ method, start: i + 1, end: end + 1, size: end - i + 1 })
  i = end
}
rows.sort((a, b) => a.size - b.size)
for (const row of rows) console.log(`${row.method.padEnd(26)} L${row.start}-${row.end}  ${row.size} 行`)
console.log(`合计 ${rows.length} 个，${rows.reduce((n, r) => n + r.size, 0)} 行`)
