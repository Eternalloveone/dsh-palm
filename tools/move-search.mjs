// mobile.search 处理器本体搬出；CHAT_SEARCH_HITS 进 constants.ts。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const API = join(PKG, 'src', 'mobile-api.ts')
const CONST = join(PKG, 'src', 'mobile', 'api', 'constants.ts')

const raw = readFileSync(API, 'utf8')
const eol = raw.includes('\r\n') ? '\r' : ''
const lines = raw.split('\n')

// 1) 常量 CHAT_SEARCH_HITS
const cAt = lines.findIndex(line => line.replace(/\r$/, '').startsWith('const CHAT_SEARCH_HITS'))
let cValue = '200'
if (cAt >= 0) {
  cValue = lines[cAt].replace(/\r$/, '').replace('const CHAT_SEARCH_HITS = ', '').replace(/;$/, '').trim()
  lines.splice(cAt, 1)
  let constText = readFileSync(CONST, 'utf8')
  if (!constText.includes('CHAT_SEARCH_HITS')) {
    constText += `\n/** 会话内搜索最多回多少处命中（多取一条判 hasMore）。 */\nexport const CHAT_SEARCH_HITS = ${cValue}\n`
    writeFileSync(CONST, constText)
  }
}

// 2) 换 search 条目（注意 catch 块与 `}],` 粘连，逐字符定位收尾）
const KEY = 'MOBILE_SEARCH_METHOD'
const start = lines.findIndex(line => line.includes(`[${KEY}, async (ctx) => {`))
if (start < 0) { console.log('未找到 search'); process.exit(0) }
let end = -1
for (let i = start; i < lines.length; i += 1) {
  const t = lines[i].replace(/\r$/, '')
  if (t.trim() === '}],' || t.endsWith('}      }],') || t.includes('}      }],')) { end = i; break }
}
if (end < 0) { console.log('未找到 search 结尾'); process.exit(1) }
const indent = lines[start].match(/^\s*/)[0]
lines.splice(start, end - start + 1, `${indent}[${KEY}, async (ctx) => mobileSearch(ctx)],${eol}`)

// 3) import
if (!lines.some(line => line.includes('mobile-search.ts'))) {
  const lastImport = lines.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
  lines.splice(lastImport + 1, 0, `import { mobileSearch } from './mobile/api/mobile-search.ts'${eol}`)
}
// constants 导入去掉 CHAT_SEARCH_HITS
const ci = lines.findIndex(line => line.includes("from './mobile/api/constants.ts'"))
if (ci >= 0) {
  const m = /^import \{([^}]+)\} from '\.\/mobile\/api\/constants\.ts'/.exec(lines[ci].replace(/\r$/, ''))
  if (m) {
    const names = m[1].split(',').map(s => s.trim()).filter(Boolean).filter(n => n !== 'CHAT_SEARCH_HITS')
    lines[ci] = `import { ${names.join(', ')} } from './mobile/api/constants.ts'${eol}`
  }
}

writeFileSync(API, lines.join('\n'))
console.log(`search 已换：删 ${end - start + 1} 行；${raw.split('\n').length} → ${lines.length} 行`)
