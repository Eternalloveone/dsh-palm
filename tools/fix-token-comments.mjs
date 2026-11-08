import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'design', 'tokens-golden.test.ts')
let text = readFileSync(P, 'utf8')

// 令牌值后面可能跟着行内注释（`--palm-r-s: 8px; /* 圆角 */`），
// 逐行整匹配会把这类令牌漏掉（真的漏了 --palm-r-s 与 --palm-hi）。
if (!text.includes('stripComments')) {
  text = text.replace(
    "const CSS = readFileSync(TOKENS_FILE, 'utf8')",
    "const stripComments = (css: string): string => css.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '')\r\nconst CSS = stripComments(readFileSync(TOKENS_FILE, 'utf8'))",
  )
}
writeFileSync(P, text)
console.log('已剥离注释:', text.includes('stripComments'))
