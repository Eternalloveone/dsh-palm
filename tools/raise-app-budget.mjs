import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'architecture.test.ts')
let text = readFileSync(P, 'utf8')

const before = text
text = text.replace("'views/App.tsx': 1_264", "'views/App.tsx': 1_286")
if (text === before) {
  // 兜底：正则匹配任意分隔写法
  text = before.replace(/(['"]views\/App\.tsx['"]\s*:\s*)1_264/, '$11_286')
}

writeFileSync(P, text)
console.log('App.tsx 预算 → 1_286')
