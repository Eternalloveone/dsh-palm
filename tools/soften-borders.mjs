import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'design', 'tokens.ts')
let text = readFileSync(P, 'utf8')

// 「更少边框」：不改 86 处 CSS，而是把边线本身的对比度降下来——
// 浅色往背景靠、深色也往背景靠，视觉上边框消失，但结构（焦点环、分割）还在。
const pairs = [
  ["'--border-default': '#e2e4e8',", "'--border-default': '#eceef2',"],
  ["'--border-subtle': '#f0f0f2',", "'--border-subtle': '#f6f7f9',"],
  ["'--card-border': '#e8e8ed',", "'--card-border': '#f0f1f5',"],
  ["'--border-default': '#2a2a3a',", "'--border-default': '#232330',"],
  ["'--border-subtle': '#1e1e2a',", "'--border-subtle': '#1a1a23',"],
]

let changed = 0
for (const [from, to] of pairs) {
  if (text.includes(from)) {
    text = text.replace(from, to)
    changed += 1
  }
}

writeFileSync(P, text)
console.log(`边线颜色已降对比：${changed}/${pairs.length}`)
