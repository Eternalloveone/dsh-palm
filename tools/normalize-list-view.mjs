import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'SessionListView.tsx')
let text = readFileSync(P, 'utf8')

// 1) 统一换行（此前插入块时用了 '\r' 拼行，把多行挤成一行）
text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

// 2) 重写列表缓存/预览依赖块
const BLOCK = `/** 预览切片的依赖注入：读取、折叠、压缩各一件，便于单测替换。 */
const previewDeps = { history, foldEvents, previewSummary }

/** 列表缓存切片：名册页写穿 + 摘要表持久化 + 冷启动播种。 */
const listCache = createListCacheSlice({
  sessionListCache: sessionListCache as never,
  loadPersistedPreviews,
  maintainPersistedCaches: maintainPersistedCaches as never,
  queuePersistedList: queuePersistedList as never,
  queuePersistedPreviews,
})

/** 行摘要缓存（跨挂载存活；导出供测试隔离）。 */
export const sessionPreviewCache = listCache.sessionPreviewCache

`
text = text.replace(
  /\/\*\* 预览切片的依赖注入[\s\S]*?export const sessionPreviewCache = listCache\.sessionPreviewCache\n[\s\S]*?\/\*\* Props for the session list\. \*\//,
  BLOCK + '/** Props for the session list. */',
)

// 3) 修好 props 顺序（mux 的注释被 bridge 挤开了）
text = text.replace(
  `  /** The live-event client, for the host's session-list frames. */
  /** P3：全站唯一订阅点；给了它就不再直接订阅 mux。 */

  bridge?: HostBridge | undefined

  mux?: MuxClient | undefined`,
  `  /** The live-event client, for the host's session-list frames. */
  mux?: MuxClient | undefined
  /** P3：全站唯一订阅点；给了它就不再直接订阅 mux。 */
  bridge?: HostBridge | undefined`,
)

// 4) 输出 CRLF
writeFileSync(P, text.replace(/\n/g, '\r\n'))
const lines = text.split('\n')
console.log('行数:', lines.length, '；listCache 块存在:', text.includes('const listCache = createListCacheSlice'))
