import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BUD = join(import.meta.dirname, '..', 'tools', 'budget.json')
const budget = JSON.parse(readFileSync(BUD, 'utf8'))

// ui：+172（结论卡组件 158 行 + 7 条单测）
budget.dirs['src/mobile/ui'] = 1350
budget.dirsRaised['src/mobile/ui'] = {
  reason: 'P4 结论卡四态渲染层：ui/verdict-card.tsx（四态一骨架、动作超 3 个收进 ⋯、脚注只渲染真数字）+ 7 条组件测试',
  expires: '2027-03-31',
}

// src/mobile：随 ui 增长同步上调
budget.dirs['src/mobile'] = 61_000
budget.dirsRaised['src/mobile'] ||= {
  reason: 'P2–P4 新模块（api/ 41 个、kernels/ 4 个、ui/verdict-card）与生成物；旧样式删除后回落',
  expires: '2027-03-31',
}

writeFileSync(BUD, JSON.stringify(budget, null, 2) + '\n')
console.log('ui=1350, mobile=61000')
