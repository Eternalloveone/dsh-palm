// session.list 外移的机械部分：搬常数、删 refreshSessionRoster、换条目为调用。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const API = join(PKG, 'src', 'mobile-api.ts')
const CONST = join(PKG, 'src', 'mobile', 'api', 'constants.ts')

// 1) 常数搬到 api/constants.ts
const MOVED = { SESSION_PAGE_SIZE: 40, SESSION_LIST_REFRESH_MIN_MS: 60_000 }
let constText = readFileSync(CONST, 'utf8')
for (const [name, value] of Object.entries(MOVED)) {
  if (!constText.includes(`export const ${name}`)) {
    constText += `\n/** 会话列表每页条数（一页 40 行，手机端不需要一次拿全）。 */\nexport const ${name} = ${value}\n`
  }
}
writeFileSync(CONST, constText)

// 2) mobile-api.ts：删常数定义、删 refreshSessionRoster、换条目
const raw = readFileSync(API, 'utf8')
const eol = raw.includes('\r\n') ? '\r' : ''
const lines = raw.split('\n')

let removedConsts = 0
for (const name of Object.keys(MOVED)) {
  const at = lines.findIndex(line => line.replace(/\r$/, '').startsWith(`const ${name} = `))
  if (at >= 0) { lines.splice(at, 1); removedConsts += 1 }
}

// 删 refreshSessionRoster（函数体到第一个顶格 }）
const fnStart = lines.findIndex(line => line.replace(/\r$/, '').startsWith('function refreshSessionRoster('))
let fnEnd = -1
if (fnStart >= 0) {
  for (let i = fnStart; i < lines.length; i += 1) {
    if (lines[i].replace(/\r$/, '') === '}') { fnEnd = i; break }
  }
}
if (fnStart >= 0 && fnEnd > fnStart) lines.splice(fnStart, fnEnd - fnStart + 1)

// 换 session.list 条目
const start = lines.findIndex(line => line.includes("['session.list', async (ctx) => {"))
let entryEnd = -1
if (start >= 0) {
  for (let i = start; i < lines.length; i += 1) {
    if (lines[i].replace(/\r$/, '').trim() === '}],') { entryEnd = i; break }
  }
}
if (start >= 0 && entryEnd > start) {
  const indent = lines[start].match(/^\s*/)[0]
  lines.splice(start, entryEnd - start + 1, `${indent}['session.list', async (ctx) => sessionList({ apiProxy: ctx.apiProxy, payload: ctx.payload, rpcId: ctx.rpcId, request: ctx.request })],${eol}`)
}

// 3) import
if (!lines.some(line => line.includes('session-list-handler.ts'))) {
  const lastImport = lines.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
  lines.splice(lastImport + 1, 0, `import { sessionList } from './mobile/api/session-list-handler.ts'${eol}`)
}
// 常数从 api/constants.ts 补导入
const CONST_NAMES = Object.keys(MOVED).join(', ')
const constImportIndex = lines.findIndex(line => line.includes("from './mobile/api/constants.ts'"))
if (constImportIndex >= 0) {
  const line = lines[constImportIndex].replace(/\r$/, '')
  const m = /^import \{([^}]+)\} from '.\/mobile\/api\/constants.ts'/.exec(line)
  if (m) {
    const names = new Set(m[1].split(',').map(s => s.trim()).filter(Boolean))
    for (const name of Object.keys(MOVED)) names.add(name)
    lines[constImportIndex] = `import { ${[...names].sort().join(', ')} } from './mobile/api/constants.ts'${eol}`
  }
}

writeFileSync(API, lines.join('\n'))
console.log(`删常数 ${removedConsts} 个；删 refreshSessionRoster ${fnStart >= 0 ? fnEnd - fnStart + 1 : 0} 行；session.list 条目已换；${raw.split('\n').length} → ${lines.length} 行`)
