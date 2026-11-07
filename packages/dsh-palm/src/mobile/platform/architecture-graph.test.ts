// 分层断言的模块图版本：查真实 import 边，而不是正则。
import { describe, expect, it } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { edgesOf } from './module-graph.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const MOBILE = join(ROOT, 'mobile')

function allSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) out.push(...allSourceFiles(abs))
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(abs)
  }
  return out
}

const FILES = allSourceFiles(MOBILE)
const ALL_EDGES = FILES.flatMap(file => edgesOf(file, ROOT))
const rel = (p: string) => p.replace(/^mobile\//, '')
const from = (pattern: RegExp) => ALL_EDGES.filter(e => pattern.test(rel(e.from)))
const to = (edges: typeof ALL_EDGES, pattern: RegExp) => edges.filter(e => pattern.test(rel(e.to)))

describe('architecture（模块图）', () => {
  it('所有相对导入都能解析（否则图是漏的）', () => {
    const bad = ALL_EDGES.filter(e => !e.resolved && e.to.startsWith('.'))
    expect(bad.map(e => `${rel(e.from)} -> ${e.to}`)).toEqual([])
  })

  it('ui 内核不依赖数据层与视图', () => {
    const bad = to(from(/^ui\//), /^(api\.ts|views\/|data\/|session\/|projections\/)/)
    expect(bad.map(e => `${rel(e.from)} -> ${rel(e.to)}`)).toEqual([])
  })

  it('design/tokens.ts 保持纯数据（零依赖）', () => {
    expect(from(/^design\/tokens\.ts$/).map(e => `${rel(e.from)} -> ${rel(e.to)}`)).toEqual([])
  })

  it('views 对 api.ts 只允许 import type', () => {
    const bad = to(from(/^views\//), /^api\.ts$/).filter(e => e.kind !== 'type-only')
    expect(bad.map(e => `${rel(e.from)} -> ${rel(e.to)} [${e.kind}]`)).toEqual([])
  })

  it('图规模在预期区间（防止扫描器静默失效）', () => {
    expect(FILES.length).toBeGreaterThan(200)
    expect(ALL_EDGES.length).toBeGreaterThan(800)
  })
})
