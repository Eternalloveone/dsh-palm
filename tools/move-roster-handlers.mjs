// subagent.list / agentPreset.list 原地改成调用新实现。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const raw = readFileSync(API, 'utf8')
const lines = raw.split('\n')
const eol = raw.includes('\r\n') ? '\r' : ''

const MAP = [
  ['subagent.list', 'subagentList'],
  ['agentPreset.list', 'agentPresetList'],
]

let replaced = 0
for (const [method, fn] of MAP) {
  const start = lines.findIndex(line => line.includes(`['${method}', async (ctx) => {`))
  if (start < 0) { console.log(`跳过 ${method}`); continue }
  let end = start
  for (let i = start; i < lines.length; i += 1) {
    if (lines[i].replace(/\r$/, '').trim() === '}],') { end = i; break }
  }
  const indent = lines[start].match(/^\s*/)[0]
  lines.splice(start, end - start + 1, `${indent}['${method}', async (ctx) => ${fn}(ctx)],${eol}`)
  replaced += 1
}

if (replaced > 0 && !lines.some(line => line.includes('roster-handlers.ts'))) {
  const lastImport = lines.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
  lines.splice(lastImport + 1, 0, `import { agentPresetList, subagentList } from './mobile/api/roster-handlers.ts'${eol}`)
}

writeFileSync(API, lines.join('\n'))
console.log(`替换 ${replaced} 个花名册处理器；${raw.split('\n').length} → ${lines.length} 行`)
