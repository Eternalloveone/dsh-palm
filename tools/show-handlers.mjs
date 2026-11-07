import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const lines = readFileSync(API, 'utf8').split('\n')
for (const method of ['subagent.list', 'agentPreset.list']) {
  const needle = `['${method}'`
  const start = lines.findIndex(line => line.includes(needle))
  if (start < 0) { console.log(`=== ${method} NOT FOUND`); continue }
  let end = start
  for (let i = start; i < lines.length; i += 1) {
    if (lines[i].trim() === '}],') { end = i; break }
  }
  console.log(`=== ${method}  L${start + 1}-${end + 1} (${end - start + 1} 行)`)
  console.log(lines.slice(start, end + 1).join('\n'))
}
