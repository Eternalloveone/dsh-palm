import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')

// 切片：CachedListPage 用 unknown 行，且允许额外字段（持久层会补 v/savedAt）
const SLICE = join(PKG, 'src', 'mobile', 'kernels', 'list-cache-slice.ts')
let slice = readFileSync(SLICE, 'utf8')
slice = slice.replace(
  /export interface CachedListPage \{[\s\S]*?\n\}/,
  `export interface CachedListPage {
  rows: readonly unknown[]
  cursor?: string
  hasMore: boolean
  /** 持久层会补 v/savedAt 等字段，这里不限制。 */
  [key: string]: unknown
}`,
)
writeFileSync(SLICE, slice)

// 测试：行用普通对象字面量
const TEST = join(PKG, 'src', 'mobile', 'kernels', 'list-cache-slice.test.ts')
let test = readFileSync(TEST, 'utf8')
test = test.replace(
  '  sessionListCache: Map<string, { rows: unknown[]; hasMore: boolean; at: number }>',
  '  sessionListCache: Map<string, { rows: readonly unknown[]; hasMore: boolean; at: number }>',
)
writeFileSync(TEST, test)

console.log('类型已统一为 readonly unknown[]')
