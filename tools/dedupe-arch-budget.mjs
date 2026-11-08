import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'architecture.test.ts')
let text = readFileSync(P, 'utf8')
const eol = text.includes('\r\n') ? '\r\n' : '\n'
const line = `      'views/App.tsx': 1_286,${eol}`

const first = text.indexOf(line)
const second = text.indexOf(line, first + line.length)
if (first < 0 || second < 0) {
  console.log('没有重复项（first=%d, second=%d）', first, second)
  process.exit(0)
}
// 删掉第二处（连带它上面那行 P6 注释）
const comment = `      // 2026-11-08：P6 页面栈接入（压栈/弹栈 + routeKeyOf）；旧标记删除后回落。${eol}`
const commentAt = text.lastIndexOf(comment, second)
const cutFrom = commentAt >= 0 && commentAt > first ? commentAt : second
text = text.slice(0, cutFrom) + text.slice(second + line.length)
writeFileSync(P, text)
console.log('重复项已删除')
