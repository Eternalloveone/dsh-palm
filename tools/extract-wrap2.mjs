// 把闭包版 wrap 换成 api/wrap.ts 的显式 rpcId 版本。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const raw = readFileSync(API, 'utf8')
const lines = raw.split('\n')
const eol = raw.includes('\r\n') ? '\r' : ''

// 1) 找闭包内定义并删除
const start = lines.findIndex(line => /^\s*const wrap = \(response:/.test(line))
if (start < 0) { console.log('未找到 wrap 定义（可能已搬）'); process.exit(0) }
let end = start
for (let i = start; i < lines.length; i += 1) {
  if (/^\s*\}\)\s*$/.test(lines[i].replace(/\r$/, ''))) { end = i; break }
}

const kept = [...lines.slice(0, start), ...lines.slice(end + 1)]

// 2) 所有调用点补 rpcId 实参（跳过新的 import 行与定义处）
let rewritten = 0
const out = kept.map(line => {
  if (line.includes("from './mobile/api/wrap.ts'")) return line
  if (!/\bwrap\(/.test(line)) return line
  rewritten += 1
  return line.replace(/\bwrap\(/g, 'wrap(rpcId, ')
})

// 3) 顶层 import
const lastImport = out.reduce((acc, line, index) => (line.startsWith('import ') ? index : acc), -1)
out.splice(lastImport + 1, 0, `import { wrap } from './mobile/api/wrap.ts'${eol}`)

writeFileSync(API, out.join('\n'))
console.log(`删除闭包 wrap ${end - start + 1} 行；改写调用点 ${rewritten} 处；文件 ${lines.length} → ${out.length}`)
