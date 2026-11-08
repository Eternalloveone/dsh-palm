import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'SessionListView.tsx')
const lines = readFileSync(P, 'utf8').split(/\r?\n/)

// 1012–1017 是误插进 JSX 的 const 块（1-based）：整段删掉，计数已内联进 prop。
const startIndex = lines.findIndex(line => line.includes('const filterCounts = {'))
if (startIndex === -1) {
  console.log('没找到 const 块')
} else {
  // 往前一行如果是注释，也一起删
  const commentIndex = startIndex > 0 && lines[startIndex - 1].trim().startsWith('/**') ? startIndex - 1 : startIndex
  let endIndex = startIndex
  while (endIndex < lines.length && lines[endIndex].trim() !== '}') endIndex += 1
  lines.splice(commentIndex, endIndex - commentIndex + 1)
  writeFileSync(P, lines.join('\r\n'))
  console.log(`删除 ${endIndex - commentIndex + 1} 行；剩余 const filterCounts:`, lines.some(line => line.includes('filterCounts')))
}
