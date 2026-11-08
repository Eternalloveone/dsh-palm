// sessionState + readInboxProjection + shouldRefreshInbox + readGoalProjection 一起搬。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const raw = readFileSync(API, 'utf8')
const eol = raw.includes('\r\n') ? '\r' : ''
const lines = raw.split('\n')

/** 删一个具名顶层函数（含其前面的 JSDoc 注释）。 */
function dropFunction(name, opts = {}) {
  const prefix = opts.export === false ? `async function ${name}(` : `export function ${name}(`
  let start = lines.findIndex(line => line.replace(/\r$/, '').startsWith(prefix))
  if (start < 0) start = lines.findIndex(line => line.replace(/\r$/, '').startsWith(`export async function ${name}(`))
  if (start < 0) return 0
  // 连带向上吞掉紧邻的 JSDoc/注释块
  let docStart = start
  while (docStart > 0) {
    const prev = lines[docStart - 1].replace(/\r$/, '')
    if (prev.startsWith(' *') || prev.startsWith('/**') || prev.startsWith('//')) docStart -= 1
    else break
  }
  let end = start
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].replace(/\r$/, '') === '}') { end = i; break }
  }
  const removed = end - docStart + 1
  lines.splice(docStart, removed)
  return removed
}

const report = {}
report.readInboxProjection = dropFunction('readInboxProjection', { export: false })
report.shouldRefreshInbox = dropFunction('shouldRefreshInbox')
report.readGoalProjection = dropFunction('readGoalProjection', { export: false })

// inboxFreshAt 常量 + 两个节流常量
const mapAt = lines.findIndex(line => line.replace(/\r$/, '').startsWith('const inboxFreshAt'))
if (mapAt >= 0) lines.splice(mapAt, 1)
for (const name of ['INBOX_FRESH_INTERVAL_MS', 'INBOX_EMPTY_FRESH_INTERVAL_MS']) {
  const at = lines.findIndex(line => line.replace(/\r$/, '').startsWith(`const ${name}`))
  if (at >= 0) lines.splice(at, 1)
}

// sessionState 条目
const KEY = 'MOBILE_SESSION_STATE_METHOD'
const uStart = lines.findIndex(line => line.includes(`[${KEY}, async (ctx) => {`))
let uEnd = -1
if (uStart >= 0) {
  for (let i = uStart; i < lines.length; i += 1) {
    if (lines[i].replace(/\r$/, '').trim() === '}],') { uEnd = i; break }
  }
}
if (uStart >= 0 && uEnd > uStart) {
  const indent = lines[uStart].match(/^\s*/)[0]
  lines.splice(uStart, uEnd - uStart + 1, `${indent}[${KEY}, async (ctx) => mobileSessionState(ctx)],${eol}`)
}

// imports：sessionState + inbox-fresh
if (!lines.some(line => line.includes('mobile-session-state.ts'))) {
  const lastImport = lines.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
  lines.splice(lastImport + 1, 0, `import { mobileSessionState } from './mobile/api/mobile-session-state.ts'${eol}`)
}
// shouldRefreshInbox 仍被主文件别处用到 → 从 inbox-fresh 导入并再导出
let importsInbox = false
for (let i = 0; i < lines.length; i += 1) {
  const l = lines[i].replace(/\r$/, '')
  if (/^import \{[^}]*\bshouldRefreshInbox\b/.test(l)) { importsInbox = true; break }
}
if (!importsInbox) {
  const lastImport = lines.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
  lines.splice(lastImport + 1, 0, `import { readInboxProjection, shouldRefreshInbox } from './mobile/api/inbox-fresh.ts'${eol}`)
  lines.splice(lastImport + 2, 0, `export { shouldRefreshInbox }${eol}`)
}

writeFileSync(API, lines.join('\n'))
console.log('删：', JSON.stringify(report), `；${raw.split('\n').length} → ${lines.length} 行`)
