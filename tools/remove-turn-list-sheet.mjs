import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const FILE = join(PKG, 'src', 'mobile', 'components', 'sheets.tsx')
let text = readFileSync(FILE, 'utf8')
const before = text

const start = text.search(/export function TurnListSheet/)
if (start === -1) {
  console.log('没有 TurnListSheet，跳过')
  process.exit(0)
}

// 往前吃到它的文档注释开头
const docStart = text.lastIndexOf('/**', start)
const anchor = docStart === -1 ? start : docStart

// 组件结束：从 start 往后第一个独立的 "}" 行（兼容 CRLF）
const rest = text.slice(start)
const endMatch = /\r?\n\}\r?\n/.exec(rest)
if (endMatch === null) {
  console.log('找不到组件结束位置，放弃')
  process.exit(1)
}
const end = start + endMatch.index + endMatch[0].length

text = text.slice(0, anchor) + text.slice(end)

// 安全阀：删掉的应该是一个组件（100~200 行），不是整个文件
const removed = before.split('\n').length - text.split('\n').length
if (removed < 40 || removed > 300) {
  console.log(`删除行数异常（${removed}），放弃写盘`)
  process.exit(1)
}

writeFileSync(FILE, text)
console.log(`已删除 TurnListSheet（${removed} 行），剩余引用需清理`)
