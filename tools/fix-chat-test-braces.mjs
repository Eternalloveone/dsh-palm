import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'ChatView.test.tsx')
let text = readFileSync(P, 'utf8')

// 上一步插入时把 describe 的收尾行吞掉了，这里补回来
if (!text.trimEnd().endsWith('})\r\n})') && text.trimEnd().endsWith('})')) {
  const tail = text.trimEnd()
  text = `${tail}\r\n  })\r\n})`
  writeFileSync(P, text)
  console.log('已补回 describe 收尾')
} else {
  console.log('结尾看起来正常，未改动')
}

// 快速括号平衡检查（忽略字符串里的括号，只做粗检）
const open = (text.match(/\{/g) ?? []).length
const close = (text.match(/\}/g) ?? []).length
console.log(`花括号：${open} 开 / ${close} 闭`)
