import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const text = readFileSync(P, 'utf8')

// 派发表形如 [METHOD, async (ctx) => handler(ctx)] 或 [METHOD, async (ctx) => { ...多行... }]
const inline = []
const delegated = []
for (const match of text.matchAll(/\[([A-Z0-9_]+_METHOD),\s*async \(ctx\) => ([\s\S]{0,40})/g)) {
  const [, method, head] = match
  if (head.trim().startsWith('{')) inline.push(method)
  else delegated.push(method)
}

console.log(`派发表项：${inline.length + delegated.length}`)
console.log(`外置（一行调用 api/*.ts）：${delegated.length}`)
console.log(`仍写在 mobile-api.ts 里的内联处理器：${inline.length}`)
for (const method of inline) console.log(`  ${method}`)
