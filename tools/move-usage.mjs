// usage 处理器 + discoverUsageProviders + USAGE_CACHE_TTL_MS 一起搬。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const API = join(PKG, 'src', 'mobile-api.ts')
const CONST = join(PKG, 'src', 'mobile', 'api', 'constants.ts')

const raw = readFileSync(API, 'utf8')
const eol = raw.includes('\r\n') ? '\r' : ''
const lines = raw.split('\n')

// 1) 常量
const cAt = lines.findIndex(line => line.replace(/\r$/, '').startsWith('const USAGE_CACHE_TTL_MS'))
if (cAt >= 0) {
  const value = lines[cAt].replace(/\r$/, '').replace('const USAGE_CACHE_TTL_MS = ', '').replace(/;$/, '').trim()
  lines.splice(cAt, 1)
  let constText = readFileSync(CONST, 'utf8')
  if (!constText.includes('USAGE_CACHE_TTL_MS')) {
    constText += `\n/** 用量/余额的短缓存 TTL。 */\nexport const USAGE_CACHE_TTL_MS = ${value}\n`
    writeFileSync(CONST, constText)
  }
}

// 2) discoverUsageProviders
const fStart = lines.findIndex(line => line.replace(/\r$/, '').startsWith('async function discoverUsageProviders('))
let fEnd = -1
if (fStart >= 0) {
  for (let i = fStart + 1; i < lines.length; i += 1) {
    if (lines[i] === '}' || lines[i] === '}\r') { fEnd = i; break }
  }
}
if (fStart >= 0 && fEnd > fStart) lines.splice(fStart, fEnd - fStart + 1)

// 3) usage 条目
const KEY = 'MOBILE_USAGE_METHOD'
const uStart = lines.findIndex(line => line.includes(`[${KEY}, async (ctx) => {`))
let uEnd = -1
if (uStart >= 0) {
  for (let i = uStart; i < lines.length; i += 1) {
    if (lines[i].replace(/\r$/, '').trim() === '}],') { uEnd = i; break }
  }
}
if (uStart >= 0 && uEnd > uStart) {
  const indent = lines[uStart].match(/^\s*/)[0]
  lines.splice(uStart, uEnd - uStart + 1, `${indent}[${KEY}, async (ctx) => mobileUsage(ctx)],${eol}`)
}

// 4) imports
if (!lines.some(line => line.includes('mobile-usage.ts'))) {
  const lastImport = lines.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
  lines.splice(lastImport + 1, 0, `import { mobileUsage } from './mobile/api/mobile-usage.ts'${eol}`)
}
// constants 补 USAGE_CACHE_TTL_MS
const constIdx = lines.findIndex(line => line.includes("from './mobile/api/constants.ts'"))
if (constIdx >= 0) {
  const m = /^import \{([^}]+)\} from '\.\/mobile\/api\/constants\.ts'/.exec(lines[constIdx].replace(/\r$/, ''))
  if (m && !m[1].includes('USAGE_CACHE_TTL_MS')) {
    const names = m[1].split(',').map(s => s.trim()).filter(Boolean)
    names.push('USAGE_CACHE_TTL_MS')
    names.sort()
    lines[constIdx] = `import { ${names.join(', ')} } from './mobile/api/constants.ts'${eol}`
  }
}

writeFileSync(API, lines.join('\n'))
console.log(`usage 完成：删函数 ${fStart >= 0 ? fEnd - fStart + 1 : 0} 行；${raw.split('\n').length} → ${lines.length} 行`)
