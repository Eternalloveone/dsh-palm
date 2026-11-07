import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const WS = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'api', 'workspace.ts')
let lines = readFileSync(WS, 'utf8').split('\n')

const need = [
  "import type { ProxyHandlerContext } from './types.ts'",
  "import { ROSTER_TTL_MS, invalidateRosterCaches } from '../../mobile-api.ts'",
]
const missing = need.filter(line => !lines.includes(line))
if (missing.length > 0) {
  const lastImport = lines.reduce((acc, line, index) => (line.startsWith('import ') ? index : acc), -1)
  lines.splice(lastImport + 1, 0, ...missing)
  writeFileSync(WS, lines.join('\n'))
}
console.log('inserted', missing.length)
