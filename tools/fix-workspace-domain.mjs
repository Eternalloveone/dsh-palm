// 修 workspace.ts 的类型与缺失导入；并把两个内部符号从 mobile-api 导出。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const API = join(PKG, 'src', 'mobile-api.ts')
const WS = join(PKG, 'src', 'mobile', 'api', 'workspace.ts')

// 1) mobile-api.ts：导出两个被 workspace 用到的内部符号
let api = readFileSync(API, 'utf8')
if (!api.includes('export const ROSTER_TTL_MS')) {
  api = api.replace('const ROSTER_TTL_MS = ', 'export const ROSTER_TTL_MS = ')
}
if (!api.includes('export function invalidateRosterCaches')) {
  api = api.replace('function invalidateRosterCaches(', 'export function invalidateRosterCaches(')
}
writeFileSync(API, api)

// 2) workspace.ts：补类型标注与缺失导入
let ws = readFileSync(WS, 'utf8')
ws = ws.replace(/async \(ctx\) =>/g, 'async (ctx: ProxyHandlerContext) =>')
if (!ws.includes('ProxyHandlerContext')) {
  ws = ws.replace(
    /^(import .*)$/m,
    `$1\nimport type { ProxyHandlerContext } from './types.ts'`,
  )
}
if (!ws.includes('ROSTER_TTL_MS')) {
  ws = ws.replace(
    /^(import .*)$/m,
    `$1\nimport { ROSTER_TTL_MS, invalidateRosterCaches } from '../../mobile-api.ts'`,
  )
}
writeFileSync(WS, ws)
console.log('patched workspace.ts')
