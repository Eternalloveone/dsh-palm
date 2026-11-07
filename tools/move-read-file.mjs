// mobile.readFile 原位替换（第一批文件读取族）。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const raw = readFileSync(API, 'utf8')
const lines = raw.split('\n')
const eol = raw.includes('\r\n') ? '\r' : ''

const KEY = 'MOBILE_READ_FILE_METHOD'
const start = lines.findIndex(line => line.includes(`[${KEY}, async (ctx) => {`))
if (start < 0) { console.log('未找到 readFile'); process.exit(0) }
let end = start
for (let i = start; i < lines.length; i += 1) {
  if (lines[i].replace(/\r$/, '').trim() === '}],') { end = i; break }
}
const indent = lines[start].match(/^\s*/)[0]
lines.splice(start, end - start + 1, `${indent}[${KEY}, async (ctx) => mobileReadFile(ctx)],${eol}`)

if (!lines.some(line => line.includes('mobile-file-handlers.ts'))) {
  const lastImport = lines.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
  lines.splice(lastImport + 1, 0, `import { mobileReadFile } from './mobile/api/mobile-file-handlers.ts'${eol}`)
}

writeFileSync(API, lines.join('\n'))
console.log(`readFile 已换：删 ${end - start + 1} 行；${raw.split('\n').length} → ${lines.length} 行`)
