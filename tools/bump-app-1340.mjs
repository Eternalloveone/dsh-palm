import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')

const A = join(ROOT, 'packages', 'dsh-palm', 'src', 'mobile', 'architecture.test.ts')
let a = readFileSync(A, 'utf8')
a = a.replace("'views/App.tsx': 1_325,", "'views/App.tsx': 1_340,")
writeFileSync(A, a)

const B = join(ROOT, 'tools', 'budget.json')
const b = JSON.parse(readFileSync(B, 'utf8'))
if (b.files['src/mobile/views/App.tsx'] !== undefined) b.files['src/mobile/views/App.tsx'] = 1_345
writeFileSync(B, JSON.stringify(b, null, 2) + '\n')

console.log('App.tsx 1340 / json 1345')
