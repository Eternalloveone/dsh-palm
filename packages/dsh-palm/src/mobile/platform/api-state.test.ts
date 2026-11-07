// 模块级可变状态棘轮：拆分 mobile-api.ts 时，不允许"顺手再加一个模块级 let"。
// 这是拆分期最容易引入的隐性 bug 源（两份状态互相看不见）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', '..', '..')
const SRC = join(PKG, 'src', 'mobile-api.ts')

/**
 * 拆分前基线（L 行为实测行号，仅供定位，不参与断言）。
 * 规则：只能从这份名单里**删**，不能加。要加必须同时说明为什么它不是共享状态。
 */
const BASELINE = [
  'usageCache',
  'sessionListSortedCache',
  'finishedRunsFile',
  'sessionProjectionSnapshots',
  'workspaceListTtlCache',
  'agentPresetTtlCache',
  'searchSyncTimer',
  'activeSearchIndexer',
  'locateSessionCache',
  'ordinarySearchSnapshotCache',
  'ordinarySearchSnapshotRefresh',
  'sessionRosterInFlight',
] as const

function moduleLevelMutable(): string[] {
  const names: string[] = []
  for (const line of readFileSync(SRC, 'utf8').split('\n')) {
    const match = /^(?:export\s+)?(?:let|var)\s+([A-Za-z_$][\w$]*)/.exec(line)
    if (match) names.push(match[1])
  }
  return names
}

describe('mobile-api 模块级可变状态', () => {
  it('不新增模块级 let/var（只能搬走，不能变多）', () => {
    const now = moduleLevelMutable()
    const added = now.filter(name => !(BASELINE as readonly string[]).includes(name))
    expect(added, `新增了模块级可变状态：${added.join(', ')}。\n`
      + '拆分期禁止新增：共享状态必须收进 api/context.ts，而不是在模块顶层再开一个 let。').toEqual([])
  })

  it('总数不超过基线', () => {
    expect(moduleLevelMutable().length).toBeLessThanOrEqual(BASELINE.length)
  })

  it('基线里的名字都还在 mobile-api.ts 里（搬走一个就删一条）', () => {
    const now = moduleLevelMutable()
    const gone = (BASELINE as readonly string[]).filter(name => !now.includes(name))
    expect(gone, `这些状态已不在 mobile-api.ts：${gone.join(', ')}。\n`
      + '搬走是好消息，请把它从 BASELINE 删除（数量只会更少）。').toEqual([])
  })
})
