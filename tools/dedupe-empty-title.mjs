import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const VIEWS = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views')

// 表头已经有一句"这次会话还没有产出文件"，空态标题重复会撞测试选择器（也读着啰嗦）
const tsx = join(VIEWS, 'ArtifactsView.tsx')
let text = readFileSync(tsx, 'utf8')
text = text.replace('title="这次会话还没有产出文件"', 'title="还没有产出文件"')
writeFileSync(tsx, text)

const spec = join(VIEWS, 'ArtifactsView.test.tsx')
let spec_text = readFileSync(spec, 'utf8')
spec_text = spec_text.replace('/这次会话还没有产出文件/', '/还没有产出文件/')
writeFileSync(spec, spec_text)

console.log('去重:', text.includes('title="还没有产出文件"'), spec_text.includes('/还没有产出文件/'))
