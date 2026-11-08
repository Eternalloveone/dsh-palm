import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const MOD = join(PKG, 'src', 'mobile', 'api', 'mobile-session-state.ts')
const API = join(PKG, 'src', 'mobile-api.ts')

// 1) 新模块里把 readGoalProjection 导出
let mod = readFileSync(MOD, 'utf8')
if (!mod.includes('export async function readGoalProjection')) {
  mod = mod.replace('async function readGoalProjection(', 'export async function readGoalProjection(')
  writeFileSync(MOD, mod)
  console.log('readGoalProjection 已导出')
}

// 2) mobile-api 从新模块导入它
let api = readFileSync(API, 'utf8')
const eol = api.includes('\r\n') ? '\r' : ''
const lines = api.split('\n')
const has = lines.some(line => line.includes("from './mobile/api/mobile-session-state.ts'"))
if (!has) {
  const lastImport = lines.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
  lines.splice(lastImport + 1, 0, `import { mobileSessionState, readGoalProjection } from './mobile/api/mobile-session-state.ts'${eol}`)
  writeFileSync(API, lines.join('\n'))
  console.log('import 已补 readGoalProjection')
} else {
  // 已存在 → 把 readGoalProjection 加进那个 import
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes("from './mobile/api/mobile-session-state.ts'")) continue
    if (lines[i].includes('readGoalProjection')) { console.log('import 已含 readGoalProjection'); break }
    lines[i] = lines[i].replace('{ mobileSessionState }', '{ mobileSessionState, readGoalProjection }')
    writeFileSync(API, lines.join('\n'))
    console.log('import 追加成功')
    break
  }
}
