// ordinarySearchSnapshot + loadOrdinarySearchSnapshot 搬到 api/search-snapshot.ts。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const raw = readFileSync(API, 'utf8')
const eol = raw.includes('\r\n') ? '\r' : ''
const lines = raw.split('\n')

function dropAsync(name) {
  const start = lines.findIndex(line => line.replace(/\r$/, '').startsWith(`async function ${name}(`))
  if (start < 0) return 0
  let docStart = start
  while (docStart > 0) {
    const prev = lines[docStart - 1].replace(/\r$/, '')
    if (prev.startsWith(' *') || prev.startsWith('/**') || prev.startsWith('//')) docStart -= 1
    else break
  }
  let end = start
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].replace(/\r$/, '') === '}') { end = i; break }
  }
  const n = end - docStart + 1
  lines.splice(docStart, n)
  return n
}

const removed = {
  ordinarySearchSnapshot: dropAsync('ordinarySearchSnapshot'),
  loadOrdinarySearchSnapshot: dropAsync('loadOrdinarySearchSnapshot'),
}

// 主文件不再自己实现 → 从新模块导入
if (!lines.some(line => line.includes('search-snapshot.ts'))) {
  const lastImport = lines.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
  lines.splice(lastImport + 1, 0, `import { ordinarySearchSnapshot } from './mobile/api/search-snapshot.ts'${eol}`)
}

writeFileSync(API, lines.join('\n'))
console.log('删：', JSON.stringify(removed), `；${raw.split('\n').length} → ${lines.length} 行`)
