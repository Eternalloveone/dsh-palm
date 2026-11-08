import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'docs', 'p8-cleanup-inventory.md')
let text = readFileSync(P, 'utf8')

// 更正 previewPath 的结论：它还有第二个入口（代码块里的文件链），不是死路
text = text.replace(
  '| `previewPath` 浮层预览 | 全仓 5 处；`onOpenDiff` 给出后 `setPreviewPath` 不再被调用 | `ChatView` 的 `previewPath` 状态 + `FilePreviewSheet` 的这处调用 | 中（`FilePreviewSheet` 本身别删，⑩ 页在复用它） |',
  '| ~~`previewPath` 浮层预览~~ **（更正：不是死路）** | 有**两个**入口：① 文件行点击（`onOpenDiff` 给出后走页面）；② **代码块里的 `.file-link` 路径点击**，在没有 `window.dshOpenFile` 的浏览器里回落到它 | 不删。已改为"有 ⑩ 页就先走页面，没有才回落浮层"，两个入口行为一致 | — |',
)

writeFileSync(P, text)
console.log('更正写入:', text.includes('更正：不是死路'))
