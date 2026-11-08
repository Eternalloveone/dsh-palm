import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
let text = readFileSync(API, 'utf8')
const lines = text.split('\n')
const idx = lines.findIndex(line => line.includes("from './mobile/api/constants.ts'"))
if (idx < 0) { console.log('constants import not found'); process.exit(1) }
const m = /^import \{([^}]+)\} from '\.\/mobile\/api\/constants\.ts'/.exec(lines[idx].replace(/\r$/, ''))
if (!m) { console.log('unexpected import shape'); process.exit(1) }
const names = m[1].split(',').map(s => s.trim()).filter(Boolean)
if (!names.includes('MAX_ATTACHMENT_BASE64_CHARS')) {
  names.push('MAX_ATTACHMENT_BASE64_CHARS')
  names.sort()
  const eol = text.includes('\r\n') ? '\r' : ''
  lines[idx] = `import { ${names.join(', ')} } from './mobile/api/constants.ts'${eol}`
  writeFileSync(API, lines.join('\n'))
  console.log('import added:', names.length, 'names')
} else {
  console.log('already present')
}
