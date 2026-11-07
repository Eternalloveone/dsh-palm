import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FILE = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const line = "import { processState } from './mobile/api/process-state.ts'"

const lines = readFileSync(FILE, 'utf8').split('\n')
let kept = false
const next = lines.filter(text => {
  if (text !== line) return true
  if (kept) return false
  kept = true
  return true
})

writeFileSync(FILE, next.join('\n'))
console.log(`kept ${kept ? 1 : 0} import, removed ${lines.length - next.length}`)
