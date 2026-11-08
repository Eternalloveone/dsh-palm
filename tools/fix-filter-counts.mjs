import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'SessionListView.tsx')
let text = readFileSync(P, 'utf8')

// 上一步把 const 插进了 JSX，语法炸了；改成在 prop 里内联对象。
text = text.replace(
  /  \/\*\* 筛选胶囊上的计数（只在已加载的页内统计，不额外拉数据）。 \*\/\r?\n  const filterCounts = \{\r?\n    all: rows\.length,\r?\n    running: rows\.filter\(row => row\.running\)\.length,\r?\n    pending: rows\.filter\(row => row\.pending === true\)\.length,\r?\n  \}\r?\n\r?\n/,
  '',
)

text = text.replace(
  '        counts={filterCounts}',
  [
    '        counts={{',
    '          all: rows.length,',
    '          running: rows.filter(row => row.running).length,',
    '          pending: rows.filter(row => row.pending === true).length,',
    '        }}',
  ].join('\r\n'),
)

writeFileSync(P, text)
console.log('内联:', text.includes('counts={{'), '| 残留 const:', text.includes('const filterCounts'))
