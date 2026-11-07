// mobile.finishedRuns 原位替换。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const raw = readFileSync(API, 'utf8')
const lines = raw.split('\n')
const eol = raw.includes('\r\n') ? '\r' : ''

const KEY = 'MOBILE_FINISHED_RUNS_METHOD'
const start = lines.findIndex(line => line.includes(`[${KEY}, async (ctx) => {`))
if (start < 0) { console.log('未找到 finishedRuns（可能已换）'); process.exit(0) }
let end = start
for (let i = start; i < lines.length; i += 1) {
  if (lines[i].replace(/\r$/, '').trim() === '}],') { end = i; break }
}
const indent = lines[start].match(/^\s*/)[0]
lines.splice(start, end - start + 1, `${indent}[${KEY}, async (ctx) => mobileFinishedRuns(ctx)],${eol}`)

if (!lines.some(line => line.includes('mobile-finished-runs.ts'))) {
  const lastImport = lines.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
  lines.splice(lastImport + 1, 0, `import { mobileFinishedRuns } from './mobile/api/mobile-finished-runs.ts'${eol}`)
}

writeFileSync(API, lines.join('\n'))
console.log(`finishedRuns 已换：删 ${end - start + 1} 行；${raw.split('\n').length} → ${lines.length} 行`)
