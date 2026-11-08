import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const VIEWS = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views')

const jobs = [
  {
    file: 'ArtifactsView.tsx',
    guard: 'icon={<FolderIcon />}',
    needle: '<EmptyState title="还没有产出文件" hint="改动过的文件、生成的报告会按轮列在这里。" />',
    replacement: [
      '<EmptyState',
      '        icon={<FolderIcon />}',
      '        title="还没有产出文件"',
      '        hint="改动过的文件、生成的报告会按轮列在这里。"',
      '      />',
    ].join('\r\n'),
    importLine: "import { FolderIcon } from '../components/icons.tsx'",
  },
  {
    file: 'ContextView.tsx',
    guard: 'icon={<ClockIcon />}',
    needle: '<EmptyState title="宿主还没报上下文用量" hint="跑完一轮对话后再看，这里会有真实数字。" />',
    replacement: [
      '<EmptyState',
      '        icon={<ClockIcon />}',
      '        title="宿主还没报上下文用量"',
      '        hint="跑完一轮对话后再看，这里会有真实数字。"',
      '      />',
    ].join('\r\n'),
    importLine: "import { ClockIcon } from '../components/icons.tsx'",
  },
]

const results = {}
for (const job of jobs) {
  const path = join(VIEWS, job.file)
  let text = readFileSync(path, 'utf8')
  if (text.includes(job.guard)) { results[job.file] = 'already'; continue }
  if (!text.includes(job.needle)) { results[job.file] = 'needle-missing'; continue }
  if (!text.includes(job.importLine)) {
    const lines = text.split(/\r?\n/)
    let last = -1
    lines.forEach((line, index) => { if (line.startsWith('import ')) last = index })
    lines.splice(last + 1, 0, job.importLine)
    text = lines.join('\r\n')
  }
  writeFileSync(path, text.replace(job.needle, job.replacement))
  results[job.file] = 'patched'
}

console.log(JSON.stringify(results))
