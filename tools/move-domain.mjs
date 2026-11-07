/**
 * 按域搬移分发表条目：把 `[METHOD_CONST, async (ctx) => {...}]` 整块搬到 api/<domain>.ts。
 * 只处理「两条分发表 + 单行方法常量」这种已知形状；形状不符会拒绝执行而不是猜。
 *
 * 用法：node tools/move-domain.mjs workspace
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const domain = process.argv[2]
if (!domain) { console.error('用法：node tools/move-domain.mjs <domain>'); process.exit(1) }

const REPO = join(import.meta.dirname, '..')
const API = join(REPO, 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const OUT = join(REPO, 'packages', 'dsh-palm', 'src', 'mobile', 'api', `${domain}.ts`)
if (existsSync(OUT)) { console.log(`${OUT} 已存在，停止（先人工合并）`); process.exit(1) }

let text = readFileSync(API, 'utf8')
const lines = text.split('\n')

// 1) 方法常量 → 方法名
const methodOf = new Map()
for (const line of lines) {
  const m = /^const ([A-Z][A-Z0-9_]*) = '([a-z]+)\.[A-Za-z]+'/.exec(line)
  if (m) methodOf.set(m[1], m[2])
}

// 2) 解析分发表里的条目区间
const tableStarts = []
lines.forEach((line, index) => {
  if (/makeMobileDispatchTable</.test(line)) tableStarts.push(index)
})
if (tableStarts.length < 2) { console.error('分发表数量不符，停止'); process.exit(1) }

const entries = [] // { start, end, constName }
for (let t = 0; t < tableStarts.length; t += 1) {
  const from = tableStarts[t]
  const to = t + 1 < tableStarts.length ? tableStarts[t + 1] : lines.length
  for (let i = from; i < to; i += 1) {
    const head = /^\s*\[([A-Z][A-Z0-9_]*),/.exec(lines[i])
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
    entries.push({ start: i, end, constName: head[1] })
    i = end
  }
}

const picked = entries.filter(entry => methodOf.get(entry.constName) === domain)
if (picked.length === 0) { console.error(`没有 ${domain}.* 的条目`); process.exit(1) }

// 3) 摘出条目文本
const blocks = picked.map(entry => lines.slice(entry.start, entry.end + 1).join('\n'))

// 4) 需要的导入：从 mobile-api.ts 的 import 语句里找符号 → 模块
const symbolToModule = new Map()
for (const line of lines) {
  const m = /^import (?:type )?\{([^}]+)\} from '([^']+)'/.exec(line)
  if (!m) continue
  for (const raw of m[1].split(',')) {
    const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
    if (name) symbolToModule.set(name, m[2])
  }
}

const body = blocks.join('\n')
const used = new Set([...body.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)].map(m => m[1]))
const need = [...used].filter(name => symbolToModule.has(name)).sort()

// 相对路径要从 src/mobile/api/ 出发重算
const rebase = spec => {
  if (!spec.startsWith('.')) return spec
  const abs = spec.replace(/^\.\//, '').replace(/^\.\.\//, '../')
  return spec.startsWith('./') ? `../../${spec.slice(2)}` : `../../../${spec.replace(/^\.\.\//, '')}`
}
const importLines = need.map(name => {
  const spec = rebase(symbolToModule.get(name))
  return `import { ${name} } from '${spec}'`
})

// 5) 组装新模块
const header = `/**
 * ${domain} 域的 RPC 处理器（P2 域拆分，整块搬出自 makeMobileApiRoutes 的分发表）。
 *
 * 行为与搬出前完全一致：条目顺序、参数形状、返回体都没动。
 * 依赖通过 MethodContext 与导入获得，不持有闭包状态。
 *
 * @module dsh-palm/mobile/api/${domain}
 */

${importLines.join('\n')}

export const ${domain}Handlers = [
${blocks.join(',\n')},
] as const
`
writeFileSync(OUT, header)

// 6) 从原文件删除条目（从后往前删，避免行号漂移）
const removed = [...picked].sort((a, b) => b.start - a.start)
for (const entry of removed) lines.splice(entry.start, entry.end - entry.start + 1)
// 在两张分发表里各插入一行展开
for (const tableStart of tableStarts) {
  lines.splice(tableStart + 1, 0, `    ...[].concat(${domain}Handlers as never),`)
}
lines.splice(tableStarts[0], 0, `import { ${domain}Handlers } from './mobile/api/${domain}.ts'`)

writeFileSync(API, lines.join('\n'))
console.log(`搬出 ${picked.length} 个 ${domain} 处理器，导入 ${need.length} 个符号`)
console.log(`新文件 ${OUT}`)
