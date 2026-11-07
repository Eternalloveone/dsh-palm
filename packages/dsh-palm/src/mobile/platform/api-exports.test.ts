// 导出面等价断言：拆分 mobile-api.ts 时，任何意外丢失的导出都会在这里红。
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', '..', '..')
const SRC = join(PKG, 'src', 'mobile-api.ts')
const GOLDEN = join(PKG, 'tests', 'golden', 'api-exports.json')

interface Snapshot {
  count: number
  hash: string
  lines: string[]
}

const golden: Snapshot = JSON.parse(readFileSync(GOLDEN, 'utf8'))

function current(): Snapshot {
  const lines = readFileSync(SRC, 'utf8')
    .split('\n')
    .filter(line => line.startsWith('export '))
    .map(line => line.trim().replace(/\s+/g, ' '))
    .sort()
  return {
    count: lines.length,
    hash: createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16),
    lines,
  }
}

describe('mobile-api 导出面', () => {
  it('与快照完全一致（拆分不得悄悄丢导出）', () => {
    const now = current()
    const lost = golden.lines.filter(line => !now.lines.includes(line))
    const added = now.lines.filter(line => !golden.lines.includes(line))
    expect(
      { lost, added },
      `导出面变了。\n丢失（危险）：${lost.join(' | ') || '无'}\n新增：${added.join(' | ') || '无'}\n`
      + '若确属有意，请跑 node tools/snapshot-api-exports.mjs 并说明理由。',
    ).toEqual({ lost: [], added: [] })
    expect(now.hash).toBe(golden.hash)
  })

  it('快照本身非空（防止空文件让断言假绿）', () => {
    expect(golden.count).toBeGreaterThan(10)
    expect(golden.lines.length).toBe(golden.count)
  })
})
