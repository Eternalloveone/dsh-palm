import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')

// ① 组件测试：秒数现在是独立大字块，脚注只剩工具/token
const a = join(PKG, 'src', 'mobile', 'ui', 'verdict-card.test.tsx')
let ta = readFileSync(a, 'utf8')
ta = ta.replace(
  "expect(screen.getByText('42 秒 · 7 次工具 · 1.2k tokens')).toBeDefined()",
  "expect(screen.getByText('42s')).toBeDefined()\r\n    expect(screen.getByText('7 次工具 · 1.2k tokens')).toBeDefined()",
)
writeFileSync(a, ta)

// ② 行渲染测试：文本断言从「8 秒」改成「8s」
const b = join(PKG, 'src', 'mobile', 'render', 'turn-verdict-row.test.tsx')
let tb = readFileSync(b, 'utf8')
tb = tb.replace("expect(card.textContent).toContain('8 秒')", "expect(card.textContent).toContain('8s')")
writeFileSync(b, tb)

console.log(JSON.stringify({ a: ta.includes("'42s'"), b: tb.includes("'8s'") }))
