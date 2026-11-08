import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'architecture.test.ts')
const text = readFileSync(P, 'utf8')
const updated = text.replace(
  "'views/RunOverviewView.tsx': 981,",
  `// 2026-11-08：P3 接入 host-bridge（可选 bridge 属性 + 双路订阅回落）；回落分支删除后本值降回。
      'views/RunOverviewView.tsx': 987,`,
)
writeFileSync(P, updated)
console.log('changed:', updated !== text)
