import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'styles', '000-tokens.css'), 'utf8')
console.log('文件里 --palm-r-s 出现次数:', (CSS.match(/--palm-r-s\s*:/g) ?? []).length)
console.log('文件里 --palm-hi 出现次数:', (CSS.match(/--palm-hi\s*:/g) ?? []).length)

let from = 0
let index = 0
for (;;) {
  const start = CSS.indexOf(':root', from)
  if (start === -1) break
  from = start + 5
  const open = CSS.indexOf('{', start)
  const close = CSS.indexOf('}', open)
  const body = CSS.slice(open + 1, close)
  const keys = [...body.matchAll(/(--palm-[a-z0-9-]+)\s*:/gi)].map(m => m[1])
  index += 1
  console.log(`第 ${index} 个 :root 块：${keys.length} 个令牌；含 r-s=${keys.includes('--palm-r-s')} hi=${keys.includes('--palm-hi')}`)
}
