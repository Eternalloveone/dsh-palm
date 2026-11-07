// 生成"已注册 RPC 方法名"快照：这是拆 mobile-api.ts 时唯一能拦住
// 「语法合法但某个方法静默消失」的门。
// 用法：node tools/snapshot-dispatch-methods.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dirname, '..')
const SRC = join(REPO, 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const OUT = join(REPO, 'packages', 'dsh-palm', 'tests', 'golden', 'dispatch-methods.json')

const lines = readFileSync(SRC, 'utf8').split('\n')

// 方法常量表：const X_METHOD = 'a.b'
const constToMethod = new Map()
for (const line of lines) {
  const m = /^const ([A-Z][A-Z0-9_]*) = '([a-z][\w]*\.[\w]+)'/.exec(line.replace(/\r$/, ''))
  if (m) constToMethod.set(m[1], m[2])
}

// 分发表条目：['a.b', ...] 或 [CONST, ...]
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

const sorted = [...methods].sort()
writeFileSync(OUT, `${JSON.stringify({
  $comment: '已注册的 RPC 方法名快照。拆文件时少一个方法 = 手机端点不动某个功能，只有这里能立刻发现。',
  count: sorted.length,
  methods: sorted,
}, null, 2)}\n`)

console.log(`方法常量 ${constToMethod.size} 个，注册方法 ${sorted.length} 个`)
console.log(sorted.join(', '))
