// 试点：把 ['workspace.list', ...] 的 10 行实现换成一行调用（不动表结构、不用展开）。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const raw = readFileSync(API, 'utf8')
const lines = raw.split('\n')
const eol = raw.includes('\r\n') ? '\r' : ''

const start = lines.findIndex(line => line.includes("['workspace.list', async (ctx) => {"))
if (start < 0) { console.log('未找到 workspace.list 条目（可能已换）'); process.exit(0) }

let end = start
for (let i = start; i < lines.length; i += 1) {
  if (lines[i].replace(/\r$/, '').trim() === '}],') { end = i; break }
}

const kept = [
  ...lines.slice(0, start),
  `    ['workspace.list', async (ctx) => workspaceList({ apiProxy: ctx.apiProxy, rpcId: ctx.rpcId, request: ctx.request })],${eol}`,
  ...lines.slice(end + 1),
]

const lastImport = kept.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
kept.splice(lastImport + 1, 0, `import { workspaceList } from './mobile/api/workspace-list.ts'${eol}`)

writeFileSync(API, kept.join('\n'))
console.log(`workspace.list 已改为调用新实现：删 ${end - start + 1} 行，加 2 行；${lines.length} → ${kept.length}`)
