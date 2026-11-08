import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const PKG = join(ROOT, 'packages', 'dsh-palm')

// 质量预算：产物页 8 个类
const Q = join(PKG, 'src', 'mobile', 'platform', 'quality-budget.ts')
let q = readFileSync(Q, 'utf8')
q = q.replace(/cssClasses: \{ value: \d+,/, 'cssClasses: { value: 895,')
q = q.replace(/cssPx: \{ value: \d+,/, 'cssPx: { value: 1731,')
writeFileSync(Q, q)

// 行数预算
const B = join(ROOT, 'tools', 'budget.json')
const b = JSON.parse(readFileSync(B, 'utf8'))
b.files['src/mobile/views/App.tsx'] = 1_420
b.dirs['src/mobile/session'] = 2_960
b.dirs['src/mobile/views'] = 21_800
b.dirs['src/mobile'] = 63_000
if (b.dirsRaised['src/mobile/session']) {
  b.dirsRaised['src/mobile/session'].reason = 'P6 ⑧ 屏数据层：session/artifacts.ts（按轮聚合产物 + 跨轮去重统计 + 7 条单测）'
}
writeFileSync(B, JSON.stringify(b, null, 2) + '\n')

// 架构棘轮：App.tsx
const A = join(PKG, 'src', 'mobile', 'architecture.test.ts')
let a = readFileSync(A, 'utf8')
const match = /'views\/App\.tsx': ([\d_]+),/.exec(a)
if (match !== null) {
  const current = Number(match[1].split('_').join(''))
  a = a.replace(match[0], "'views/App.tsx': " + String(current + 16) + ',')
  writeFileSync(A, a)
  console.log('App arch →', current + 16)
}
console.log('budgets bumped')
