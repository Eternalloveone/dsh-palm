import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'tools', 'budget.json')
const budget = JSON.parse(readFileSync(P, 'utf8'))

budget.dirs['src/mobile/kernels'] = 760
budget.dirsRaised['src/mobile/kernels'] = {
  reason: 'P3 单一订阅点：kernels/host-bridge.ts（一帧只派发一次 + 重连代数）与其 8 条单测；视图后续改接此内核，旧订阅点删除后本值回落',
  expires: '2027-03-31',
}

writeFileSync(P, JSON.stringify(budget, null, 2) + '\n')
console.log('kernels 预算 -> 760（含 raisedReason）')
