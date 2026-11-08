import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'App.tsx')
let text = readFileSync(P, 'utf8')
const eol = text.includes('\r\n') ? '\r\n' : '\n'

if (text.includes("case 'sub-chat'")) {
  console.log('sub-chat 分支已存在，不重复插入')
  process.exit(0)
}

const anchor = "    case 'approval':"
if (!text.includes(anchor)) {
  console.log('找不到 approval 分支')
  process.exit(1)
}

const restored = [
  "    case 'sub-chat':",
  '      // 只读子会话只有一个入口：运行中页。',
  "      return { kind: 'run-overview' }",
  "    case 'approval':",
].join(eol)

text = text.replace(anchor, restored)
writeFileSync(P, text)
console.log('sub-chat 分支已补回')
