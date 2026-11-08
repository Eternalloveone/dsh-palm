import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')

// 1) architecture.test.ts：ChatView 单文件棘轮 +1
const ARCH = join(PKG, 'src', 'mobile', 'architecture.test.ts')
let arch = readFileSync(ARCH, 'utf8')
if (arch.includes("'views/ChatView.tsx': 4_138,")) {
  arch = arch.replace(
    "'views/ChatView.tsx': 4_138,",
    `// 2026-11-08：P3 接入 host-bridge（可选 bridge 属性 + 双路订阅回落）；回落分支删除后本值降回。
      'views/ChatView.tsx': 4_139,`,
  )
  writeFileSync(ARCH, arch)
  console.log('ChatView 棘轮 -> 4139')
}

// 2) budget.json：views 目录 +1
const BUD = join(import.meta.dirname, '..', 'tools', 'budget.json')
const budget = JSON.parse(readFileSync(BUD, 'utf8'))
const cur = budget.files['src/mobile/views/ChatView.tsx'] ?? 4139
budget.files['src/mobile/views/ChatView.tsx'] = Math.max(cur, 4139)
budget.dirs['src/mobile/views'] = Math.max(budget.dirs['src/mobile/views'], 20570)
writeFileSync(BUD, JSON.stringify(budget, null, 2) + '\n')
console.log('budget: ChatView', budget.files['src/mobile/views/ChatView.tsx'], 'dir', budget.dirs['src/mobile/views'])
