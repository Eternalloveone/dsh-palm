import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const lines = readFileSync(API, 'utf8').split('\n')
const NAMES = [
  'visibleSessionRows', 'parseSessionListCursor', 'afterCursor', 'trimSessionListRow', 'sessionListCursor',
]
for (const name of NAMES) {
  const start = lines.findIndex(line => new RegExp(`^(export )?(function|const) ${name}\\b`).test(line.replace(/\r$/, '')))
  if (start < 0) { console.log(`=== ${name} NOT FOUND`); continue }
  let end = start
  for (let i = start; i < lines.length; i += 1) {
    const t = lines[i].replace(/\r$/, '')
    if (i > start && (t === '}' || t === '})' || t === '} as const' || t.endsWith(')') && t.startsWith('}'))) { end = i; break }
  }
  console.log(`=== ${name}  L${start + 1}-${end + 1} (${end - start + 1} 行)`)
  console.log(lines.slice(start, end + 1).join('\n'))
}
