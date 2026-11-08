import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'SessionListView.tsx')
const lines = readFileSync(P, 'utf8').split('\n')

// 1) 修好被误改的 import 行
const importAt = lines.findIndex(line => line.startsWith('import {') && lines.slice(lines.indexOf(line), lines.indexOf(line) + 40).some(l => l.includes(': queuePersistedList as never')))
for (let i = 0; i < lines.length; i += 1) {
  if (lines[i].trim() === 'queuePersistedList: queuePersistedList as never,') {
    // 只在 import 块内（下一个非空行不是 createListCacheSlice 的实参）才还原
    const prevIsImport = lines.slice(0, i).some(l => l.startsWith('import {') && !l.includes('} from'))
    if (prevIsImport) {
      lines[i] = lines[i].replace('queuePersistedList: queuePersistedList as never,', 'queuePersistedList,')
      break
    }
  }
}

// 2) 在 createListCacheSlice({...}) 实参里加 cast
const callAt = lines.findIndex(line => line.includes('createListCacheSlice({'))
if (callAt >= 0) {
  for (let i = callAt; i < callAt + 12; i += 1) {
    if (lines[i].trim() === 'queuePersistedList,') {
      const indent = lines[i].match(/^\s*/)[0]
      lines[i] = `${indent}queuePersistedList: queuePersistedList as never,`
      break
    }
  }
}

writeFileSync(P, lines.join('\n'))
console.log('已修 import 并给实参加 cast')
