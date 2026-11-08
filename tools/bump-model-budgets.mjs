import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const PKG = join(ROOT, 'packages', 'dsh-palm')

// 1) 质量预算：按 460-model-page.css 实测增量上调
const Q = join(PKG, 'src', 'mobile', 'platform', 'quality-budget.ts')
let q = readFileSync(Q, 'utf8')
q = q.replace(/cssPx: \{ value: \d+,/, 'cssPx: { value: 1725,')
q = q.replace(/cssClasses: \{ value: \d+,/, 'cssClasses: { value: 866,')
writeFileSync(Q, q)

// 2) 行数预算
const B = join(ROOT, 'tools', 'budget.json')
const b = JSON.parse(readFileSync(B, 'utf8'))
b.dirs['src/mobile/views'] = 21_100
b.dirs['src/mobile'] = 62_000
writeFileSync(B, JSON.stringify(b, null, 2) + '\n')

console.log('quality 1725/866, dirs views 21100 / mobile 62000')
