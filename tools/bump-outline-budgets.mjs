import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const PKG = join(ROOT, 'packages', 'dsh-palm')

// 1) ChatView 单文件预算（+3 行：onOpenOutline 透传）
const B = join(ROOT, 'tools', 'budget.json')
const b = JSON.parse(readFileSync(B, 'utf8'))
b.files['src/mobile/views/ChatView.tsx'] = 4_160
b.dirs['src/mobile/views'] = 21_600
b.dirs['src/mobile'] = 62_700
writeFileSync(B, JSON.stringify(b, null, 2) + '\n')

// 2) 质量预算（大纲页 7 类）
const Q = join(PKG, 'src', 'mobile', 'platform', 'quality-budget.ts')
let q = readFileSync(Q, 'utf8')
q = q.replace(/cssClasses: \{ value: \d+,/, 'cssClasses: { value: 885,')
q = q.replace(/cssPx: \{ value: \d+,/, 'cssPx: { value: 1730,')
writeFileSync(Q, q)

// 3) 架构棘轮：App.tsx
const A = join(PKG, 'src', 'mobile', 'architecture.test.ts')
let a = readFileSync(A, 'utf8')
const pattern = /'views\/App\.tsx': ([\d_]+),/
const match = pattern.exec(a)
if (match !== null) {
  const current = Number(match[1].split('_').join(''))
  a = a.replace(match[0], "'views/App.tsx': " + String(current + 22) + ',')
  writeFileSync(A, a)
  console.log('App arch →', current + 22)
}

console.log('budgets bumped')
