import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const STYLES = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'styles')

// 只删「整块规则」且块内不含嵌套花括号；行尾 CRLF/LF 都吃
function dropRule(text, className) {
  const pattern = new RegExp(`(?:\\r?\\n){0,2}\\.${className}\\s*\\{[^{}]*\\}\\r?\\n`, 'g')
  const next = text.replace(pattern, '\n')
  return { text: next, removed: next !== text }
}

const path = join(STYLES, '490-artifacts-page.css')
const before = readFileSync(path, 'utf8')
const { text, removed } = dropRule(before, 'artifacts-page-note')
if (removed) writeFileSync(path, text)
console.log(`.artifacts-page-note: ${removed ? '已删' : '未找到'}；行数 ${before.split('\n').length} → ${text.split('\n').length}`)
