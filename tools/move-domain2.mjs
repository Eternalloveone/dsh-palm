/**
 * 按域搬移分发表条目（第二轮：支持内联字符串键 + 只往命中条目的那张表插入展开）。
 * 用法：node tools/move-domain2.mjs workspace
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const domain = process.argv[2]
if (!domain) { console.error('用法：node tools/move-domain2.mjs <domain>'); process.exit(1) }

const REPO = join(import.meta.dirname, '..')
const API = join(REPO, 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const OUT = join(REPO, 'packages', 'dsh-palm', 'src', 'mobile', 'api', `${domain}.ts`)
if (existsSync(OUT)) { console.log(`${OUT} 已存在，停止`); process.exit(1) }

const lines = readFileSync(API, 'utf8').split('\n')

const methodOf = new Map()
for (const line of lines) {
  const m = /^const ([A-Z][A-Z0-9_]*) = '([a-z]+)\.[A-Za-z]+'/.exec(line)
  if (m) methodOf.set(m[1], m[2])
}

const tableStarts = []
lines.forEach((line, index) => { if (/makeMobileDispatchTable</.test(line)) tableStarts.push(index) })

const entries = []
for (let t = 0; t < tableStarts.length; t += 1) {
  const from = tableStarts[t]
  const to = t + 1 < tableStarts.length ? tableStarts[t + 1] : lines.length
  for (let i = from; i < to; i += 1) {
    const head = /^\s*\[(?:'([a-z]+)\.[A-Za-z]+'|([A-Z][A-Z0-9_]*)),/.exec(lines[i])
    if (!head) continue
    let depth = 0
    let started = false
    let end = i
    for (let j = i; j < to; j += 1) {
      for (const ch of lines[j]) {
        if (ch === '[' || ch === '{' || ch === '(') { depth += 1; started = true }
        else if (ch === ']' || ch === '}' || ch === ')') depth -= 1
      }
      if (started && depth <= 0) { end = j; break }
    }
    const owner = head[1] ?? methodOf.get(head[2])
    entries.push({ start: i, end, owner, table: t })
    i = end
  }
}

const picked = entries.filter(entry => entry.owner === domain)
if (picked.length === 0) { console.error(`没有 ${domain}.* 的条目`); process.exit(1) }

const blocks = picked.map(entry => lines.slice(entry.start, entry.end + 1).join('\n'))
const body = blocks.join('\n')

const symbolToModule = new Map()
for (const line of lines) {
  const m = /^import (?:type )?\{([^}]+)\} from '([^']+)'/.exec(line)
  if (!m) continue
  for (const raw of m[1].split(',')) {
    const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
    if (name) symbolToModule.set(name, m[2])
  }
}
const used = new Set([...body.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)].map(m => m[1]))
const need = [...used].filter(name => symbolToModule.has(name)).sort()
const rebase = spec => (spec.startsWith('./') ? `../../${spec.slice(2)}` : spec.startsWith('../') ? `../${spec}` : spec)
const importLines = need.map(name => `import { ${name} } from '${rebase(symbolToModule.get(name))}'`)

writeFileSync(OUT, `/**
 * ${domain} 域的 RPC 处理器（P2 域拆分：整块搬出分发表条目）。
 *
 * 行为与搬出前一致：条目顺序、参数形状、返回体都没动；
 * 依赖全部来自导入与 MethodContext/ProxyContext，不持有闭包状态。
 *
 * @module dsh-palm/mobile/api/${domain}
 */

${importLines.join('\n')}

export const ${domain}Handlers = [
${blocks.join(',\n')},
] as const
`)

const removed = [...picked].sort((a, b) => b.start - a.start)
for (const entry of removed) lines.splice(entry.start, entry.end - entry.start + 1)

const tableIndex = picked[0].table
lines.splice(tableStarts[tableIndex] + 1, 0, `    ...(${domain}Handlers as unknown as never[]),`)
lines.splice(0, 0, `import { ${domain}Handlers } from './mobile/api/${domain}.ts'`)
writeFileSync(API, lines.join('\n'))

console.log(`搬出 ${picked.length} 个 ${domain} 处理器（第 ${tableIndex + 1} 张表），导入 ${need.length} 个符号`)
console.log(`原文件 ${lines.length} 行`)
