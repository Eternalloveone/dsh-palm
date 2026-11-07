// settings 域：白名单搬到 api/settings-handlers.ts，两个处理器改为原位调用。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const raw = readFileSync(API, 'utf8')
const lines = raw.split('\n')
const eol = raw.includes('\r\n') ? '\r' : ''

// 1) 删白名单常量块（从 const 行到顶格的 }）
const wStart = lines.findIndex(line => line.startsWith('const SETTINGS_WRITE_WHITELIST'))
let wEnd = -1
if (wStart >= 0) {
  for (let i = wStart; i < lines.length; i += 1) {
    if (lines[i].replace(/\r$/, '') === '}') { wEnd = i; break }
  }
}
if (wStart >= 0 && wEnd > wStart) lines.splice(wStart, wEnd - wStart + 1)

// 2) 两个处理器改调用
const REPLACEMENTS = [
  ['settings.read', 'settingsRead(ctx)'],
  ['settings.mutate', 'settingsMutate(ctx)'],
]
let replaced = 0
for (const [method, call] of REPLACEMENTS) {
  const start = lines.findIndex(line => line.includes(`['${method}', async (ctx) => {`))
  if (start < 0) { console.log(`跳过 ${method}`); continue }
  let end = start
  for (let i = start; i < lines.length; i += 1) {
    if (lines[i].replace(/\r$/, '').trim() === '}],') { end = i; break }
  }
  lines.splice(start, end - start + 1, `    ['${method}', async (ctx) => ${call}],${eol}`)
  replaced += 1
}

// 3) import
if (replaced > 0 && !lines.some(line => line.includes('settings-handlers.ts'))) {
  const lastImport = lines.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
  lines.splice(lastImport + 1, 0, `import { settingsRead, settingsMutate } from './mobile/api/settings-handlers.ts'${eol}`)
}

writeFileSync(API, lines.join('\n'))
console.log(`白名单删除 ${wStart >= 0 ? wEnd - wStart + 1 : 0} 行；处理器替换 ${replaced} 个；${raw.split('\n').length} → ${lines.length} 行`)
