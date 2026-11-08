import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')

// 1) 质量预算：按 450-diff-page.css 的实测增量上调
const Q = join(PKG, 'src', 'mobile', 'platform', 'quality-budget.ts')
let q = readFileSync(Q, 'utf8')
const pxBefore = /cssPx: \{ value: (\d+),/.exec(q)?.[1]
const clsBefore = /cssClasses: \{ value: (\d+),/.exec(q)?.[1]
q = q.replace(/cssPx: \{ value: \d+,/, 'cssPx: { value: 1723,')
q = q.replace(/cssClasses: \{ value: \d+,/, 'cssClasses: { value: 857,')
writeFileSync(Q, q)
console.log(`quality: cssPx ${pxBefore}→1723, cssClasses ${clsBefore}→857`)

// 2) 行数预算（views / mobile）
const B = join(import.meta.dirname, '..', 'tools', 'budget.json')
const b = JSON.parse(readFileSync(B, 'utf8'))
b.dirs['src/mobile/views'] = 20_900
b.dirs['src/mobile'] = 61_650
if (b.dirsRaised['src/mobile/views']) {
  b.dirsRaised['src/mobile/views'].reason = 'P6 18 屏迁移：ApprovalView + DiffView（各带测试）；18 屏迁完删旧浮层后回落'
}
writeFileSync(B, JSON.stringify(b, null, 2) + '\n')
console.log('dirs: views 20900, mobile 61650')
