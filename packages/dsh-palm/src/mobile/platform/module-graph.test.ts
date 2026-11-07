// 模块图自检：证明四种曾漏掉的形态都能被看见。
// 这些用例对应 architecture.test.ts 里正则实现的已知盲区。
import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildGraph, edgesOf, dependsOn } from './module-graph.ts'

function makeFixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'mg-'))
  for (const [path, content] of Object.entries(files)) {
    const abs = join(root, path)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
  return root
}

describe('module-graph', () => {
  it('抓到动态 import()', () => {
    const root = makeFixture({
      'a.ts': `export const load = () => import('./b.ts')`,
      'b.ts': `export const x = 1`,
    })
    const edges = edgesOf(join(root, 'a.ts'), root)
    expect(edges).toContainEqual(expect.objectContaining({ to: 'b.ts', kind: 'dynamic', resolved: true }))
  })

  it('抓到 export * from', () => {
    const root = makeFixture({
      'a.ts': `export * from './b.ts'`,
      'b.ts': `export const x = 1`,
    })
    const edges = edgesOf(join(root, 'a.ts'), root)
    expect(edges).toContainEqual(expect.objectContaining({ to: 'b.ts', kind: 're-export' }))
  })

  it('抓到 import type', () => {
    const root = makeFixture({
      'a.ts': `import type { T } from './b.ts'\nexport const y: T = 1 as never`,
      'b.ts': `export type T = number`,
    })
    const edges = edgesOf(join(root, 'a.ts'), root)
    expect(edges).toContainEqual(expect.objectContaining({ to: 'b.ts', kind: 'type-only' }))
  })

  it('能通过别名解析', () => {
    const root = makeFixture({
      'src/a.ts': `import { x } from '@lib/x.ts'\nexport const y = x`,
      'src/lib/x.ts': `export const x = 1`,
    })
    const edges = edgesOf(join(root, 'src/a.ts'), root, { '@lib': 'src/lib' })
    expect(edges).toContainEqual(expect.objectContaining({ to: 'src/lib/x.ts', resolved: true }))
  })

  it('能表达"某目录不得依赖某模块"', () => {
    const root = makeFixture({
      'ui/a.ts': `import '../api/client.ts'\nexport const z = 1`,
      'api/client.ts': `export const call = 1`,
    })
    const entry = join(root, 'ui/a.ts')
    const { edges } = buildGraph([entry], root)
    expect(dependsOn(edges, /^ui\//, /^api\//)).toHaveLength(1)
  })

  it('未解析的裸包标记 resolved=false，不误报', () => {
    const root = makeFixture({ 'a.ts': `import ts from 'typescript'` })
    const edges = edgesOf(join(root, 'a.ts'), root)
    expect(edges[0]).toMatchObject({ to: 'typescript', resolved: false })
  })
})
