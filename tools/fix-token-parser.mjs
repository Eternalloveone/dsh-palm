import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'design', 'tokens-golden.test.ts')
let text = readFileSync(P, 'utf8')

// 一个选择器可能出现多次（例如 `:root, html[data-skin='graphite']` 分块书写）：
// 必须把所有出现的块**合并**，只取第一处会漏令牌。
text = text.replace(
  `/** 取出某个选择器块（\`html[data-skin='x']\` / \`:root\` / \`@media\` 里的 \`:root\`）里的令牌声明。 */
function declarationsIn(selectorText: string): Record<string, string> {
  const start = CSS.indexOf(selectorText)
  if (start === -1) return {}
  const open = CSS.indexOf('{', start)
  const close = CSS.indexOf('}', open)
  if (open === -1 || close === -1) return {}

  const out: Record<string, string> = {}
  for (const line of CSS.slice(open + 1, close).split(';')) {
    const match = /^\\s*(--palm-[a-z0-9-]+)\\s*:\\s*([^;]+)$/i.exec(line.trim())
    if (match !== null) out[match[1]] = match[2].trim()
  }
  return out
}`,
  `/**
 * 取出某个选择器**所有出现处**的令牌声明（后出现的覆盖先出现的）。
 *
 * 令牌文件里同一个选择器会出现多次：基础层写一个 \`:root\`，皮肤层再写
 * \`:root, html[data-skin='graphite']\`。只取第一处会漏掉一半令牌（曾经真的漏了
 * \`--palm-hi\` 与 \`--palm-r-s\`）。
 */
function declarationsIn(selectorText: string): Record<string, string> {
  const out: Record<string, string> = {}
  let from = 0
  for (;;) {
    const start = CSS.indexOf(selectorText, from)
    if (start === -1) break
    from = start + selectorText.length
    const open = CSS.indexOf('{', start)
    const close = CSS.indexOf('}', open)
    if (open === -1 || close === -1) continue
    for (const line of CSS.slice(open + 1, close).split(';')) {
      const match = /^\\s*(--palm-[a-z0-9-]+)\\s*:\\s*([^;]+)$/i.exec(line.trim())
      if (match !== null) out[match[1]] = match[2].trim()
    }
  }
  return out
}`,
)

writeFileSync(P, text)
console.log('解析器已改为合并多处选择器')
