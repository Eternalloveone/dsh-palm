import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const VIEWS = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views')
const tsx = join(VIEWS, 'ArtifactsView.tsx')

let text = readFileSync(tsx, 'utf8')
// 表头与空态都出现"还没有"，会让「这页到底说了几遍」变成两遍；改为互补的两句
text = text.replace("? '这次会话还没有产出文件'", "? '这次会话还没有产物'")
writeFileSync(tsx, text)

console.log('表头:', text.includes("'这次会话还没有产物'"), '| 空态:', text.includes('title="还没有产出文件"'))
