// 已注册 RPC 方法名快照：拆 mobile-api.ts 时，任何「语法合法但方法静默消失」都会在这里红。
// 这类回归 typecheck 抓不到、单测也不一定覆盖，只能靠方法名清单。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', '..', '..')
const SRC = join(PKG, 'src', 'mobile-api.ts')
const GOLDEN = join(PKG, 'tests', 'golden', 'dispatch-methods.json')

interface Snapshot {
  count: number
  methods: string[]
}

const golden: Snapshot = JSON.parse(readFileSync(GOLDEN, 'utf8'))

function registeredMethods(): string[] {
  const lines = readFileSync(SRC, 'utf8').split('\n')
  const constToMethod = new Map<string, string>()
  for (const line of lines) {
    const m = /^const ([A-Z][A-Z0-9_]*) = '([a-z][\w]*\.[\w]+)'/.exec(line.replace(/\r$/, ''))
    if (m) constToMethod.set(m[1], m[2])
  }

  const methods = new Set<string>()
  let inTable = false
  for (const line of lines) {
    const bare = line.replace(/\r$/, '')
    if (/makeMobileDispatchTable</.test(bare)) { inTable = true; continue }
    if (!inTable) continue
    const inline = /^\s*\['([a-z][\w]*\.[\w]+)',/.exec(bare)
    if (inline) { methods.add(inline[1]); continue }
    const viaConst = /^\s*\[([A-Z][A-Z0-9_]*),/.exec(bare)
    if (viaConst && constToMethod.has(viaConst[1])) methods.add(constToMethod.get(viaConst[1])!)
  }
  return [...methods].sort()
}

describe('已注册 RPC 方法', () => {
  it('与快照完全一致（少一个 = 手机端点不动某个功能）', () => {
    const now = registeredMethods()
    const lost = golden.methods.filter(name => !now.includes(name))
    const added = now.filter(name => !golden.methods.includes(name))
    expect(
      { lost, added },
      `方法清单变了。\n丢失（危险）：${lost.join(', ') || '无'}\n新增：${added.join(', ') || '无'}\n`
      + '若确属有意，跑 node tools/snapshot-dispatch-methods.mjs 并说明理由。',
    ).toEqual({ lost: [], added: [] })
  })

  it('快照非空（防止空文件让断言假绿）', () => {
    expect(golden.count).toBeGreaterThan(40)
    expect(golden.methods.length).toBe(golden.count)
  })
})
