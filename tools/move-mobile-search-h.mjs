// mobile.searchMessages / mobile.error 原位替换。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const raw = readFileSync(API, 'utf8')
const lines = raw.split('\n')
const eol = raw.includes('\r\n') ? '\r' : ''

const MAP = [
  ['MOBILE_SEARCH_MESSAGES_METHOD', 'mobileSearchMessages'],
  ['MOBILE_ERROR_METHOD', 'mobileError'],
]

let replaced = 0
for (const [key, fn] of MAP) {
  const start = lines.findIndex(line => line.includes(`[${key}, async (ctx) => {`))
  if (start < 0) { console.log(`跳过 ${key}`); continue }
  let end = start
  for (let i = start; i < lines.length; i += 1) {
    if (lines[i].replace(/\r$/, '').trim() === '}],') { end = i; break }
  }
  const indent = lines[start].match(/^\s*/)[0]
  lines.splice(start, end - start + 1, `${indent}[${key}, async (ctx) => ${fn}(ctx)],${eol}`)
  replaced += 1
}

if (replaced > 0 && !lines.some(line => line.includes('mobile-search-handlers.ts'))) {
  const lastImport = lines.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
  lines.splice(lastImport + 1, 0, `import { mobileError, mobileSearchMessages } from './mobile/api/mobile-search-handlers.ts'${eol}`)
}

writeFileSync(API, lines.join('\n'))
console.log(`替换 ${replaced} 个处理器；${raw.split('\n').length} → ${lines.length} 行`)
