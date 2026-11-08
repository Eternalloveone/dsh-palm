import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BUD = join(import.meta.dirname, '..', 'tools', 'budget.json')
const budget = JSON.parse(readFileSync(BUD, 'utf8'))

// kernels：+61（preview-slice.ts 与其 10 条单测）
budget.dirs['src/mobile/kernels'] = 860
budget.dirsRaised['src/mobile/kernels'] = {
  reason: 'P3 模型切片：kernels/preview-slice.ts（会话行摘要取数 + 限流并发，10 条单测），从 SessionListView 抽出，视图层去取数的第一步',
  expires: '2027-03-31',
}

// views：抽出后应下降，按实测收紧（只降不升）
budget.dirs['src/mobile/views'] = Math.min(budget.dirs['src/mobile/views'], 20_560)

writeFileSync(BUD, JSON.stringify(budget, null, 2) + '\n')
console.log('kernels=860, views=' + budget.dirs['src/mobile/views'])
