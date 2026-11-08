import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'SessionListView.tsx')
const text = readFileSync(P, 'utf8')
const eol = text.includes('\r\n') ? '\r' : ''

const BLOCK = [
  '/** 预览切片的依赖注入：读取、折叠、压缩各一件，便于单测替换。 */',
  'const previewDeps = { history, foldEvents, previewSummary }',
  '',
  '/** 列表缓存切片：名册页写穿 + 摘要表持久化 + 冷启动播种。 */',
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
  '',
].join(eol)

let updated = text
if (!text.includes('const listCache = createListCacheSlice')) {
  const marker = '/** Props for the session list. */'
  if (!text.includes(marker)) {
    console.log('未找到插入锚点')
    process.exit(1)
  }
  updated = text.replace(marker, BLOCK + marker)
}

writeFileSync(P, updated)
console.log('切片接线已插入:', updated.includes('const listCache = createListCacheSlice'))
