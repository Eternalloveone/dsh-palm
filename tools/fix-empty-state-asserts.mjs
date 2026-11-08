import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const views = join(PKG, 'src', 'mobile', 'views')

/* 空态文案已统一（EmptyState），把两处旧断言改成新文案。 */
{
  const path = join(views, 'ContextView.test.tsx')
  let text = readFileSync(path, 'utf8')
  text = text.replace(
    /expect\(screen\.getByText\(\/还没报这个会话的上下文用量\/\)\)\.toBeDefined\(\)/,
    "expect(screen.getByText(/宿主还没报上下文用量/)).toBeDefined()",
  )
  writeFileSync(path, text)
}

{
  const path = join(views, 'ArtifactsView.test.tsx')
  let text = readFileSync(path, 'utf8')
  text = text.replace(
    /    expect\(screen\.getByText\(\/还没有产出文件\/\)\)\.toBeDefined\(\)\r?\n    expect\(screen\.getByText\(\/会出现在这里\/\)\)\.toBeDefined\(\)/,
    '    expect(screen.getByText(/这次会话还没有产出文件/)).toBeDefined()\r\n    expect(screen.getByText(/会按轮列在这里/)).toBeDefined()',
  )
  writeFileSync(path, text)
}

console.log('断言已对齐新文案')
