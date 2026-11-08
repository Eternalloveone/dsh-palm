import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'ChatView.tsx')
const before = readFileSync(P, 'utf8')

// 这些 console.debug 没有开关、只在开发时有用，生产控制台里是纯噪声；
// 删掉同时把 ChatView 拉回行数预算以内（预算只降不升，不能靠上调过门）。
const lines = before.split(/\r?\n/)
const kept = lines.filter(line => !/^\s*console\.debug\(/.test(line))
const removed = lines.length - kept.length

writeFileSync(P, kept.join('\r\n'))
console.log(`删除 console.debug：${removed} 行；${lines.length} → ${kept.length}`)
