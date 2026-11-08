import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'SessionListView.tsx')
const lines = readFileSync(P, 'utf8').split('\n')

// 把错位到 `import {` 与成员列表之间的那行挪到最近的空行之后
const bad = lines.findIndex(line => line.startsWith('import { fetchSessionPreview'))
if (bad < 0) { console.log('未找到错位 import'); process.exit(0) }
const line = lines[bad]
lines.splice(bad, 1)

// 找到该多行 import 结束的 `} from '...'` 行，插到它后面
let end = -1
for (let i = bad; i < Math.min(lines.length, bad + 30); i += 1) {
  if (lines[i].startsWith('} from ')) { end = i; break }
}
if (end < 0) { console.log('未找到多行 import 结尾'); process.exit(1) }
lines.splice(end + 1, 0, line)

writeFileSync(P, lines.join('\n'))
console.log('import 已挪到多行导入之后（L' + (end + 2) + '）')
