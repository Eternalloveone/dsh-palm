import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'ContextView.tsx')
let text = readFileSync(P, 'utf8')

// 已占用现在是页面上的大号数字，明细里再列一遍就会出现两个同名数字（测试也会歧义）。
text = text.replace(
  /\r?\n\s*\{pressureTokens === undefined \? null : \(\r?\n\s*<>\r?\n\s*<dt>已占用<\/dt>\r?\n\s*<dd>\{formatTokens\(pressureTokens\)\}<\/dd>\r?\n\s*<\/>\r?\n\s*\)\}/,
  '',
)

writeFileSync(P, text)
console.log('已占用明细已移除:', !text.includes('<dt>已占用</dt>'))
