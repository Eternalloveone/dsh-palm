import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'architecture.test.ts')
let text = readFileSync(P, 'utf8')
const before = text
text = text.replace("'views/App.tsx': 1_286,", "'views/App.tsx': 1_305,")
if (text === before) {
  console.log('未找到 1_286 条目')
  process.exit(1)
}
writeFileSync(P, text)
console.log("architecture.test.ts: 'views/App.tsx' → 1_305")
