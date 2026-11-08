import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const raw = readFileSync(API, 'utf8')
const eol = raw.includes('\r\n') ? '\r' : ''
const lines = raw.split('\n')

if (!lines.some(line => line.startsWith('export { MOBILE_ALLOWLIST'))) {
  const idx = lines.findIndex(line => line.includes("from './mobile/api/allowlist.ts'"))
  if (idx < 0) { console.log('allowlist import not found'); process.exit(1) }
  lines.splice(idx + 1, 0, `export { MOBILE_ALLOWLIST }${eol}`)
  writeFileSync(API, lines.join('\n'))
  console.log('re-export added')
} else {
  console.log('already exported')
}
