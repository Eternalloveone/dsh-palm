import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const STYLES = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'styles')

/** 删掉一条规则块：从选择器行到配对的收尾 `}`（CRLF 安全）。 */
function dropRule(text, className) {
  const start = text.indexOf(`.${className} {`)
  if (start === -1) return { text, removed: false }
  const close = text.indexOf('\r\n}\r\n', start)
  if (close === -1) return { text, removed: false }
  // 连同前面的空行一起删，避免留下双空行
  let from = start
  while (from > 0 && /\r?\n/.test(text.slice(from - 2, from))) from -= 2
  return { text: text.slice(0, from) + text.slice(close + 5), removed: true }
}

for (const [file, className] of [
  ['490-artifacts-page.css', 'artifacts-page-note'],
]) {
  const path = join(STYLES, file)
  const before = readFileSync(path, 'utf8')
  const { text, removed } = dropRule(before, className)
  if (removed) writeFileSync(path, text)
  console.log(`${file} / .${className}: ${removed ? '已删' : '未找到'}`)
}
