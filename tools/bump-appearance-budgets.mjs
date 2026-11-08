import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const PKG = join(ROOT, 'packages', 'dsh-palm')

// 质量预算（外观页：+5 类、+1 px）
const Q = join(PKG, 'src', 'mobile', 'platform', 'quality-budget.ts')
let q = readFileSync(Q, 'utf8')
q = q.replace(/cssPx: \{ value: \d+,/, 'cssPx: { value: 1727,')
q = q.replace(/cssClasses: \{ value: \d+,/, 'cssClasses: { value: 873,')
writeFileSync(Q, q)

// 行数预算
const B = join(ROOT, 'tools', 'budget.json')
const b = JSON.parse(readFileSync(B, 'utf8'))
b.dirs['src/mobile/views'] = 21_400
b.dirs['src/mobile'] = 62_400
b.dirs['src/mobile/platform'] = 4_540
if (b.dirsRaised['src/mobile/platform']) {
  b.dirsRaised['src/mobile/platform'].reason = 'P6 ⑭ 外观页：platform/skin.ts（三皮肤存储 + 应用 + 广播 + 单测）；并入 display-prefs 后回落'
}
b.files['src/mobile/views/App.tsx'] = 1_390
writeFileSync(B, JSON.stringify(b, null, 2) + '\n')

// 架构棘轮：views/App.tsx 实测值 +20
const A = join(PKG, 'src', 'mobile', 'architecture.test.ts')
let a = readFileSync(A, 'utf8')
const pattern = /'views\/App\.tsx': ([\d_]+),/
const match = pattern.exec(a)
if (match !== null) {
  const current = Number(match[1].split('_').join(''))
  a = a.replace(match[0], "'views/App.tsx': " + String(current + 20) + ',')
}
writeFileSync(A, a)

console.log('budgets bumped; App arch =', match === null ? '未找到' : Number(match[1].split('_').join('')) + 20)
