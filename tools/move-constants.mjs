// 把 6 个 TTL/容量常量从 mobile-api.ts 搬到 api/constants.ts（单向依赖，无环）。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const NAMES = [
  'SESSION_LIST_TTL_MS',
  'ROSTER_TTL_MS',
  'LOCATE_TTL_MS',
  'SEARCH_MESSAGES_LIMIT',
  'SEARCH_SYNC_DEBOUNCE_MS',
  'SEARCH_ALL_SESSIONS',
]

const lines = readFileSync(API, 'utf8').split('\n')
const keep = []
const removed = []
for (const line of lines) {
  const m = /^const ([A-Z][A-Z0-9_]*) = .+\\r?$/.exec(line)
  if (m && NAMES.includes(m[1])) { removed.push(m[1]); continue }
  keep.push(line)
}

if (removed.length === 0) { console.log('没有可搬的常量（已搬过）'); process.exit(0) }

// 只导入实际被删掉的，避免未使用导入
const lastImport = keep.reduce((acc, line, index) => (line.startsWith('import ') ? index : acc), -1)
keep.splice(lastImport + 1, 0, `import { ${removed.sort().join(', ')} } from './mobile/api/constants.ts'`)

writeFileSync(API, keep.join('\n'))
console.log(`搬出 ${removed.length} 个常量：${removed.join(', ')}`)
console.log(`mobile-api.ts ${lines.length} → ${keep.length}`)
