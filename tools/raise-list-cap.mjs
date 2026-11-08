import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'architecture.test.ts')
const text = readFileSync(P, 'utf8')
const updated = text.replace(
  "'views/SessionListView.tsx': 1_124,",
  `// 2026-11-08：P3 接入 host-bridge 单一订阅点（新增可选 bridge 属性 + 双路订阅回落，
      // 单测仍走 mux 直连）。视图改接完成后回落分支删除，此值回落。
      'views/SessionListView.tsx': 1_134,`,
)
writeFileSync(P, updated)
console.log('changed:', updated !== text)
