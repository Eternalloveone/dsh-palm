import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'SessionListView.tsx')
let text = readFileSync(P, 'utf8')

// 三个筛选的计数（定版图：「全部 40 / 进行中 1 / 待确认 0」）。
// 口径：当前已加载的会话页，不再额外拉全量。
if (!text.includes('filterCounts')) {
  const anchor = '      <SessionListFilters folderFilter={folderFilter} folders={folders} onSelect={setFolderFilter} />'
  const replacement = [
    '      <SessionListFilters',
    '        folderFilter={folderFilter}',
    '        folders={folders}',
    '        onSelect={setFolderFilter}',
    '        counts={filterCounts}',
    '      />',
  ].join('\r\n')
  text = text.replace(anchor, replacement)

  // 计数在渲染前算好：全部 = 已加载行数；进行中 / 待确认分别数状态位
  const marker = '      <SessionListFilters'
  const index = text.indexOf(marker)
  const counts = [
    '  /** 筛选胶囊上的计数（只在已加载的页内统计，不额外拉数据）。 */',
    '  const filterCounts = {',
    '    all: rows.length,',
    '    running: rows.filter(row => row.running).length,',
    '    pending: rows.filter(row => row.pending === true).length,',
    '  }',
    '',
  ].join('\r\n')
  text = `${text.slice(0, index)}${counts}${text.slice(index)}`
  writeFileSync(P, text)
}

console.log('filterCounts:', text.includes('const filterCounts'), '| 传入:', text.includes('counts={filterCounts}'))
