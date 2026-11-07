import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FILE = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const lines = readFileSync(FILE, 'utf8').split('\n')

function extract(name) {
  const start = lines.findIndex(line => new RegExp(`^(?:export )?(?:async )?function ${name}\\b`).test(line))
  if (start < 0) return null
  let end = start
  let depth = 0
  let started = false
  for (let i = start; i < lines.length; i += 1) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth += 1; started = true }
      else if (ch === '}') depth -= 1
    }
    if (started && depth <= 0) { end = i; break }
  }
  return { start, end, text: lines.slice(start, end + 1).join('\n') }
}

for (const name of process.argv.slice(2)) {
  const hit = extract(name)
  if (hit === null) { console.log(`=== ${name} 未找到`); continue }
  console.log(`=== ${name}  L${hit.start + 1}-L${hit.end + 1}  (${hit.end - hit.start + 1} 行)`)
  console.log(hit.text)
  console.log('')
}
