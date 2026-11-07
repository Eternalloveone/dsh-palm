import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const API = join(PKG, 'src', 'mobile-api.ts')

const lines = readFileSync(API, 'utf8').split('\n')
const start = lines.findIndex(line => /^function isAllowedSettingsOp\b/.test(line))
if (start < 0) {
  console.log('already moved')
  process.exit(0)
}
let end = start
let depth = 0
let started = false
for (let i = start; i < lines.length; i += 1) {
  for (const ch of lines[i]) {
    if (ch === '{') { depth += 1; started = true }
    else if (ch === '}') depth -= 1
  }
  if (started && depth <= 0) { end = i; break }
}

const next = [...lines.slice(0, start), ...lines.slice(end + 1)]
// 去掉搬走时可能留下的连续空行
while (next[start] === '' && next[start - 1] === '') next.splice(start, 1)

const importLine = "import { isAllowedSettingsOp } from './mobile/api/settings.ts'"
const anchor = next.findIndex(line => line.includes("from './mobile/api/process-state.ts'"))
next.splice(anchor + 1, 0, importLine)

writeFileSync(API, next.join('\n'))
console.log(`moved isAllowedSettingsOp (${end - start + 1} lines); file ${lines.length} → ${next.length}`)
