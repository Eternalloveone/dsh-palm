// 生成"已注册 RPC 方法名"快照。
// 覆盖两个来源：① mobile-api.ts 内的分发表条目；② api/*.ts 里导出的处理器数组。
// 这样域搬移后方法总数仍然守恒，快照不会因为"搬家"而假报丢失。
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dirname, '..')
const SRC = join(REPO, 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const API_DIR = join(REPO, 'packages', 'dsh-palm', 'src', 'mobile', 'api')
const OUT = join(REPO, 'packages', 'dsh-palm', 'tests', 'golden', 'dispatch-methods.json')

const lines = readFileSync(SRC, 'utf8').split('\n')

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

// ② 已搬走的域：处理器数组里的 ['x.y', 条目
for (const name of readdirSync(API_DIR)) {
  if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue
  const text = readFileSync(join(API_DIR, name), 'utf8')
  for (const m of text.matchAll(/^\s*\['([a-z][\w]*\.[\w]+)',/gm)) methods.add(m[1])
}

const sorted = [...methods].sort()
writeFileSync(OUT, `${JSON.stringify({
  $comment: '已注册的 RPC 方法名快照（分发表 + api/*.ts 处理器数组）。少一个 = 手机端点不动某个功能。',
  count: sorted.length,
  methods: sorted,
}, null, 2)}\n`)

console.log(`注册方法 ${sorted.length} 个`)
