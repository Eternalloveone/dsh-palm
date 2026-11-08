import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')

// architecture.test.ts：App.tsx 1_305 → 1_325（diff 路由 + 渲染分支）
const A = join(ROOT, 'packages', 'dsh-palm', 'src', 'mobile', 'architecture.test.ts')
let a = readFileSync(A, 'utf8')
a = a.replace("'views/App.tsx': 1_305,", "'views/App.tsx': 1_325,")
writeFileSync(A, a)

// tools/budget.json：App.tsx 单文件预算同步
const B = join(ROOT, 'tools', 'budget.json')
const b = JSON.parse(readFileSync(B, 'utf8'))
if (b.files['src/mobile/views/App.tsx'] !== undefined) b.files['src/mobile/views/App.tsx'] = 1_330
writeFileSync(B, JSON.stringify(b, null, 2) + '\n')

console.log('App.tsx 预算 1325/1330')
