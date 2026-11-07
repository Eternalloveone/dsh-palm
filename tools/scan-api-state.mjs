// 只读探查：mobile-api.ts 里的模块级状态（拆分时最容易出事的东西）。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FILE = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const text = readFileSync(FILE, 'utf8')
const lines = text.split('\n')

const decl = /^(?:export\s+)?(const|let|var)\s+([A-Za-z_$][\w$]*)/
const found = []
for (let i = 0; i < lines.length; i += 1) {
  const m = decl.exec(lines[i])
  if (!m) continue
  const [, kind, name] = m
  // 统计全文件里该名字的出现次数（粗口径：整词匹配）
  const uses = [...text.matchAll(new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`, 'g'))].length
  found.push({ kind, name, line: i + 1, uses, exported: lines[i].startsWith('export') })
}

const mutable = found.filter(f => f.kind !== 'const')
const shared = found.filter(f => f.uses > 1)

console.log(`模块级声明 ${found.length} 个：const ${found.length - mutable.length} / let ${mutable.length}`)
console.log(`\n== 可变状态（let/var，拆分时最危险）`)
for (const f of mutable) console.log(`  L${String(f.line).padStart(4)} ${f.name.padEnd(28)} 引用 ${f.uses}`)
if (mutable.length === 0) console.log('  （无）')

console.log(`\n== 被多处引用的声明（可能是共享状态）`)
for (const f of shared.sort((a, b) => b.uses - a.uses).slice(0, 20)) {
  console.log(`  L${String(f.line).padStart(4)} ${f.kind.padEnd(5)} ${f.name.padEnd(28)} 引用 ${f.uses}${f.exported ? ' [export]' : ''}`)
}

console.log(`\n== 只在一处出现的声明（可随域搬走）`)
console.log(`  ${found.filter(f => f.uses === 1).length} 个`)

console.log(`\n文件总行数 ${lines.length}`)
