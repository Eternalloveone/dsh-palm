import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const VIEWS = join(PKG, 'src', 'mobile', 'views')

function patch(file, needle, replacement, importLine) {
  const path = join(VIEWS, file)
  let text = readFileSync(path, 'utf8')
  if (text.includes(replacement.split('\r\n')[0])) return false
  if (!text.includes(importLine)) {
    // 找最后一个 import 行插进去
    const lines = text.split(/\r?\n/)
    let last = -1
    lines.forEach((line, index) => { if (line.startsWith('import ')) last = index })
    lines.splice(last + 1, 0, importLine)
    text = lines.join('\r\n')
  }
  text = text.replace(needle, replacement)
  writeFileSync(path, text)
  return true
}

const artifacts = patch(
  'ArtifactsView.tsx',
  '<EmptyState title="还没有产出文件" hint="改动过的文件、生成的报告会按轮列在这里。" />',
  [
    '<EmptyState',
    '        icon={<FolderIcon />}',
    '        title="还没有产出文件"',
    '        hint="改动过的文件、生成的报告会按轮列在这里。"',
    '      />',
  ].join('\r\n'),
  "import { FolderIcon } from '../components/icons.tsx'",
)

const context = patch(
  'ContextView.tsx',
  '<EmptyState title="宿主还没报上下文用量" hint="跑完一轮对话后再看，这里会有真实数字。" />',
  [
    '<EmptyState',
    '        icon={<ClockIcon />}',
    '        title="宿主还没报上下文用量"',
    '        hint="跑完一轮对话后再看，这里会有真实数字。"',
    '      />',
  ].join('\r\n'),
  "import { ClockIcon } from '../components/icons.tsx'",
)

console.log(JSON.stringify({ artifacts, context }))
