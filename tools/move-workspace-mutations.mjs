// 把 workspace 的四个写操作改成一行调用（原位替换，不动表结构）。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const raw = readFileSync(API, 'utf8')
const lines = raw.split('\n')
const eol = raw.includes('\r\n') ? '\r' : ''

const MAP = [
  ['workspace.create', 'workspaceCreate'],
  ['workspace.delete', 'workspaceDelete'],
  ['workspace.rename', 'workspaceRename'],
  ['workspace.archiveSession', 'workspaceArchiveSession'],
]

let replaced = 0
for (const [method, fn] of MAP) {
  const start = lines.findIndex(line => line.includes(`['${method}', async (ctx) => {`))
  if (start < 0) { console.log(`跳过 ${method}（已替换）`); continue }
  let end = start
  for (let i = start; i < lines.length; i += 1) {
    if (lines[i].replace(/\r$/, '').trim() === '}],') { end = i; break }
  }
  const call = `    ['${method}', async (ctx) => ${fn}({ apiProxy: ctx.apiProxy, rpcId: ctx.rpcId, request: ctx.request, invalidateRosterCaches })],${eol}`
  lines.splice(start, end - start + 1, call)
  replaced += 1
}

const importLine = `import { workspaceCreate, workspaceDelete, workspaceRename, workspaceArchiveSession } from './mobile/api/workspace-mutations.ts'${eol}`
if (replaced > 0 && !lines.some(line => line.includes('workspace-mutations.ts'))) {
  const lastImport = lines.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
  lines.splice(lastImport + 1, 0, importLine)
}

writeFileSync(API, lines.join('\n'))
console.log(`替换 ${replaced} 个写操作；${raw.split('\n').length} → ${lines.length} 行`)
