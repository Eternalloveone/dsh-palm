import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'docs', 'final-regression.md')
let text = readFileSync(P, 'utf8')

const before = '✅ 可删 3 个（测试仍引用 2 个，故意保留）'
const after = '✅ **可删 0 个**（测试仍引用 2 个，故意保留）'

if (text.includes(before)) {
  text = text.replace(before, after)
  writeFileSync(P, text)
  console.log('已更新为 0')
} else {
  console.log('已是 0 或未找到旧句')
}
