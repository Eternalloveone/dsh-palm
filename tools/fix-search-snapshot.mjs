import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const CONST = join(PKG, 'src', 'mobile', 'api', 'constants.ts')
const API = join(PKG, 'src', 'mobile-api.ts')
const SNAP = join(PKG, 'src', 'mobile', 'api', 'search-snapshot.ts')

// 1) 常量搬到 constants.ts
let constText = readFileSync(CONST, 'utf8')
if (!constText.includes('SESSION_SNAPSHOT_STALE_MS')) {
  constText += '\n/** 会话快照的陈旧期：超过 TTL 但还在这个窗口内，先给旧值再后台刷新。 */\nexport const SESSION_SNAPSHOT_STALE_MS = 5 * 60_000\n'
  writeFileSync(CONST, constText)
  console.log('constants.ts 已加 SESSION_SNAPSHOT_STALE_MS')
}

// 2) mobile-api 删本地常量 + 补 import
const raw = readFileSync(API, 'utf8')
const eol = raw.includes('\r\n') ? '\r' : ''
const lines = raw.split('\n')
const at = lines.findIndex(line => line.replace(/\r$/, '').startsWith('const SESSION_SNAPSHOT_STALE_MS'))
if (at >= 0) lines.splice(at, 1)
const ci = lines.findIndex(line => line.includes("from './mobile/api/constants.ts'"))
if (ci >= 0) {
  const m = /^import \{([^}]+)\} from '\.\/mobile\/api\/constants\.ts'/.exec(lines[ci].replace(/\r$/, ''))
  if (m) {
    const names = m[1].split(',').map(s => s.trim()).filter(Boolean)
    if (!names.includes('SESSION_SNAPSHOT_STALE_MS')) {
      names.push('SESSION_SNAPSHOT_STALE_MS')
      names.sort()
      lines[ci] = `import { ${names.join(', ')} } from './mobile/api/constants.ts'${eol}`
    }
  }
}
writeFileSync(API, lines.join('\n'))

// 3) search-snapshot 的请求字面量加 as never
let snap = readFileSync(SNAP, 'utf8')
snap = snap.replace("payload: {} })", "payload: {} } as never)")
writeFileSync(SNAP, snap)
console.log('cast 已加')
