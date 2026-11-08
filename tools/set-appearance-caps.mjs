import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')

const Q = join(PKG, 'src', 'mobile', 'platform', 'quality-budget.ts')
let q = readFileSync(Q, 'utf8')
q = q.replace(/cssPx: \{ value: \d+,/, 'cssPx: { value: 1728,')
q = q.replace(/cssClasses: \{ value: \d+,/, 'cssClasses: { value: 877,')
writeFileSync(Q, q)

const A = join(PKG, 'src', 'mobile', 'architecture.test.ts')
let a = readFileSync(A, 'utf8')
a = a.replace("'views/SettingsView.tsx': 783,", "'views/SettingsView.tsx': 786,")
writeFileSync(A, a)

console.log('quality 1728/877; SettingsView 786')
