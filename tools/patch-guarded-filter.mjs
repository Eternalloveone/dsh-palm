import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, 'move-workspace-guarded.mjs')
let text = readFileSync(P, 'utf8')
const from = "e.method !== null && e.method.startsWith('workspace.')"
const to = "e.method === 'workspace'"
if (text.includes(from)) {
  text = text.replace(from, to)
  writeFileSync(P, text)
  console.log('filter fixed')
} else {
  console.log(text.includes(to) ? 'already fixed' : 'pattern not found')
}
