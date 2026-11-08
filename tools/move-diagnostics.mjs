// diagnostics + buildHealthReport + MOBILE_ALLOWLIST 三件一起搬。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const raw = readFileSync(API, 'utf8')
const eol = raw.includes('\r\n') ? '\r' : ''
const lines = raw.split('\n')

// 1) 删 MOBILE_ALLOWLIST 常量块
const aStart = lines.findIndex(line => line.replace(/\r$/, '').startsWith('export const MOBILE_ALLOWLIST'))
let aEnd = -1
if (aStart >= 0) {
  for (let i = aStart; i < lines.length; i += 1) {
    if (lines[i].replace(/\r$/, '') === '])') { aEnd = i; break }
  }
}
if (aStart >= 0 && aEnd > aStart) lines.splice(aStart, aEnd - aStart + 1)

// 2) 删 buildHealthReport 函数（保留 re-export）
const fStart = lines.findIndex(line => line.replace(/\r$/, '').startsWith('export function buildHealthReport('))
let fEnd = -1
if (fStart >= 0) {
  for (let i = fStart; i < lines.length; i += 1) {
    if (lines[i].replace(/\r$/, '') === '}') { fEnd = i; break }
  }
}
if (fStart >= 0 && fEnd > fStart) {
  lines.splice(fStart, fEnd - fStart + 1, `export { buildHealthReport } from './mobile/api/health-report.ts'${eol}`)
}

// 3) 换 diagnostics 条目
const KEY = 'MOBILE_DIAGNOSTICS_METHOD'
const dStart = lines.findIndex(line => line.includes(`[${KEY}, async (ctx) => {`))
let dEnd = -1
if (dStart >= 0) {
  for (let i = dStart; i < lines.length; i += 1) {
    if (lines[i].replace(/\r$/, '').trim() === '}],') { dEnd = i; break }
  }
}
if (dStart >= 0 && dEnd > dStart) {
  const indent = lines[dStart].match(/^\s*/)[0]
  lines.splice(dStart, dEnd - dStart + 1, `${indent}[${KEY}, async (ctx) => mobileDiagnostics(ctx)],${eol}`)
}

// 4) import
if (!lines.some(line => line.includes('mobileDiagnostics')&&line.includes('health-report'))) {
  const lastImport = lines.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
  lines.splice(lastImport + 1, 0, `import { mobileDiagnostics } from './mobile/api/health-report.ts'${eol}`)
}
if (!lines.some(line => line.includes("MOBILE_ALLOWLIST")&&line.includes('allowlist.ts'))) {
  const lastImport = lines.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
  lines.splice(lastImport + 1, 0, `import { MOBILE_ALLOWLIST } from './mobile/api/allowlist.ts'${eol}`)
}

writeFileSync(API, lines.join('\n'))
console.log(`allowlist 删 ${aStart >= 0 ? aEnd - aStart + 1 : 0} 行；buildHealthReport 删 ${fStart >= 0 ? fEnd - fStart + 1 : 0} 行；diagnostics 已换；${raw.split('\n').length} → ${lines.length} 行`)
