import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'SessionListView.tsx')
let text = readFileSync(P, 'utf8')
const eol = text.includes('\r\n') ? '\r' : ''
const lines = text.split('\n')

// 1) 删掉本地的 sessionPreviewCache / seedPersistedCaches / setCachedList / syncPersistedPreviews
function dropBlock(pred) {
  const start = lines.findIndex(line => pred(line.replace(/\r$/, '')))
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
  cache: dropBlock(line => line.startsWith('export const sessionPreviewCache')),
  seed: dropBlock(line => line.startsWith('function seedPersistedCaches')),
  setCachedList: dropBlock(line => line.startsWith('function setCachedList')),
  sync: dropBlock(line => line.startsWith('function syncPersistedPreviews')),
}

let out = lines.join('\n')

// 2) import + 建切片（放在 previewDeps 之后）
if (!out.includes('list-cache-slice.ts')) {
  const arr = out.split('\n')
  const lastImport = arr.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
  arr.splice(lastImport + 1, 0, `import { createListCacheSlice } from '../kernels/list-cache-slice.ts'${eol}`)
  out = arr.join('\n')
}

if (!out.includes('const listCache =')) {
  out = out.replace(
    'const previewDeps = { history, foldEvents, previewSummary }',
    [
      'const previewDeps = { history, foldEvents, previewSummary }',
      '',
      '/** 列表缓存切片（名册页写穿 + 摘要表持久化 + 冷启动播种）；sessionPreviewCache 由它持有。 */',
      'const listCache = createListCacheSlice({',
      '  sessionListCache: sessionListCache as never,',
      '  loadPersistedPreviews,',
      '  maintainPersistedCaches,',
      '  queuePersistedList,',
      '  queuePersistedPreviews,',
      '})',
      '',
      '/** 行摘要缓存（跨挂载存活；导出供测试隔离）。 */',
      'export const sessionPreviewCache = listCache.sessionPreviewCache',
    ].join(eol),
  )
}

// 3) 调用点改名
out = out.replace(/\bseedPersistedCaches\(\)/g, 'listCache.ensureSeeded()')
out = out.replace(/\bsetCachedList\(/g, 'listCache.writeList(')
out = out.replace(/\bsyncPersistedPreviews\(\)/g, 'listCache.syncPreviews()')

writeFileSync(P, out)
console.log('删：', JSON.stringify(removed), '；行数：', out.split('\n').length)
