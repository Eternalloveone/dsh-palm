/**
 * 带三段自检的域搬移：把 workspace.* 5 个处理器整块搬到 api/workspace.ts。
 * 任一段自检失败 → 不改文件直接退出。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const API = join(PKG, 'src', 'mobile-api.ts')
const WS = join(PKG, 'src', 'mobile', 'api', 'workspace.ts')
const TYPES = join(PKG, 'src', 'mobile', 'api', 'context-types.ts')

if (existsSync(WS)) { console.log('workspace.ts 已存在，先人工确认'); process.exit(1) }

const raw = readFileSync(API, 'utf8')
const eol = raw.includes('\r\n') ? '\r' : ''
const lines = raw.split('\n')

// ── 解析全部条目（含边界复核）────────────────────────────────
const tableStarts = []
lines.forEach((line, i) => { if (/makeMobileDispatchTable</.test(line)) tableStarts.push(i) })

function parseEntries() {
  const out = []
  for (let t = 0; t < tableStarts.length; t += 1) {
    const from = tableStarts[t]
    const to = t + 1 < tableStarts.length ? tableStarts[t + 1] : lines.length
    for (let i = from; i < to; i += 1) {
      const head = /^\s*\[(?:'([a-z]+)\.[A-Za-z]+'|([A-Z][A-Z0-9_]*)),/.exec(lines[i])
      if (!head) continue
      let depth = 0, started = false, end = i
      for (let j = i; j < to; j += 1) {
        for (const ch of lines[j]) {
          if ('[{('.includes(ch)) { depth += 1; started = true }
          else if (']})'.includes(ch)) depth -= 1
        }
        if (started && depth <= 0) { end = j; break }
      }
      out.push({ start: i, end, table: t, method: head[1] ?? null, constName: head[2] ?? null })
      i = end
    }
  }
  return out
}

const entries = parseEntries()
const workspaceEntries = entries.filter(e => e.method === 'workspace')
console.log(`总条目 ${entries.length}，workspace 条目 ${workspaceEntries.length}`)

// ── 自检 1：条目数与边界 ──────────────────────────────
if (workspaceEntries.length !== 5) { console.log('自检1失败：workspace 条目数不是 5'); process.exit(1) }
for (const e of workspaceEntries) {
  const block = lines.slice(e.start, e.end + 1)
  const tail = block[block.length - 1].replace(/\r$/, '').trim()
  if (!tail.endsWith('],') && tail !== ']') {
    console.log(`自检1失败：条目 ${e.method} 的结尾不像条目边界：${tail.slice(-20)}`)
    process.exit(1)
  }
}
console.log('自检1通过：5 条条目边界完整')

// ── 组装新模块 ───────────────────────────────────────
const blocks = workspaceEntries.map(e => lines.slice(e.start, e.end + 1).join('\n'))
const body = blocks.join('\n')
  .replace(/async \(ctx\) =>/g, 'async (ctx: ProxyHandlerContext) =>')
  .replace(/\bwrap\(rpcId, /g, 'wrap(ctx.rpcId, ')
  .replace(/\binvalidateRosterCaches\(\)/g, 'ctx.invalidateRosterCaches()')

writeFileSync(TYPES, `/**
 * 处理器上下文类型（P2 域拆分必需）。
 * @module dsh-palm/mobile/api/context-types
 */
import type { IncomingMessage } from 'node:http'
import type { ApiProxy } from '../../api-proxy-types.ts'

export interface ProxyHandlerContext {
  apiProxy: ApiProxy
  payload: unknown
  rpcId: string
  signal?: AbortSignal
  request: IncomingMessage
  /** 写操作后清花名册缓存（闭包内函数，经 ctx 传入避免反向依赖）。 */
  invalidateRosterCaches: () => void
}
`)

writeFileSync(WS, `/**
 * workspace 域的 RPC 处理器（P2 域拆分：整块搬出分发表条目）。
 *
 * 行为与搬出前一致；依赖全部来自导入与 ctx，不持有闭包状态。
 *
 * @module dsh-palm/mobile/api/workspace
 */
import { rename } from 'node:fs/promises'
import { ROSTER_TTL_MS } from './constants.ts'
import type { ProxyHandlerContext } from './context-types.ts'
import { processState } from './process-state.ts'
import { wrap } from './wrap.ts'

export const workspaceHandlers = [
${body},
] as const
`)

// ── 从 mobile-api.ts 摘除并插入展开 ──────────────────
const removed = [...workspaceEntries].sort((a, b) => b.start - a.start)
for (const e of removed) lines.splice(e.start, e.end - e.start + 1)

// 重新定位第 4 张表（索引会因删除而变）
const nowTables = []
lines.forEach((line, i) => { if (/makeMobileDispatchTable</.test(line)) nowTables.push(i) })
if (nowTables.length !== 4) { console.log(`自检2失败：分发表数量变了（${nowTables.length}）`); process.exit(1) }
lines.splice(nowTables[3] + 1, 0, `    ...workspaceHandlers,${eol}`)

// ctx 增加 invalidateRosterCaches
const ctxLine = lines.findIndex(line => line.includes('const ctx = { apiProxy, payload, rpcId, signal, request }'))
if (ctxLine >= 0) {
  lines[ctxLine] = lines[ctxLine].replace('signal, request }', 'signal, request, invalidateRosterCaches }')
}

// 顶层 import
const lastImport = lines.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
lines.splice(lastImport + 1, 0, `import { workspaceHandlers } from './mobile/api/workspace.ts'${eol}`)

// ── 自检 3：方法名守恒 ───────────────────────────────
const constToMethod = new Map()
for (const line of lines) {
  const m = /^const ([A-Z][A-Z0-9_]*) = '([a-z][\w]*\.[\w]+)'/.exec(line.replace(/\r$/, ''))
  if (m) constToMethod.set(m[1], m[2])
}
const methods = new Set()
let inTable = false
for (const line of lines) {
  const bare = line.replace(/\r$/, '')
  if (/makeMobileDispatchTable</.test(bare)) { inTable = true; continue }
  if (!inTable) continue
  const inline = /^\s*\['([a-z][\w]*\.[\w]+)',/.exec(bare)
  if (inline) { methods.add(inline[1]); continue }
  const viaConst = /^\s*\[([A-Z][A-Z0-9_]*),/.exec(bare)
  if (viaConst && constToMethod.has(viaConst[1])) methods.add(constToMethod.get(viaConst[1]))
}
for (const m of body.matchAll(/^\s*\['([a-z][\w]*\.[\w]+)',/gm)) methods.add(m[1])

if (methods.size !== 59) {
  console.log(`自检3失败：方法数 ${methods.size} ≠ 59，未写入`)
  process.exit(1)
}
console.log('自检3通过：方法名仍为 59 个')

writeFileSync(API, lines.join('\n'))
console.log(`已写入：mobile-api.ts ${raw.split('\n').length} → ${lines.length} 行`)
