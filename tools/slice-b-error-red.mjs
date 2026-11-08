import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'styles', '190-disclosures.css')
let text = readFileSync(P, 'utf8')

// 定版图：过程行里的「报错数量」用红色（语义色），只在真有错误时出现。
const replaced = text.replace(
  /(\.chat-proc-errors \{[^}]*?)color: var\(--text-tertiary\);/,
  '$1color: var(--palm-danger);',
)

writeFileSync(P, replaced)
console.log(JSON.stringify({ patched: replaced !== text, red: /\.chat-proc-errors \{[^}]*--palm-danger/.test(replaced) }))
