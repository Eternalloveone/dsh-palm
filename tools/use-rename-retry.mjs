import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src')

/** 把 atomic 落盘三处（folders / notify / pairing）的 renameSync 换成带重试版本。 */
const targets = [
  join(ROOT, 'folders.ts'),
  join(ROOT, 'notify', 'notify-store.ts'),
  join(ROOT, 'pairing.ts'),
]

for (const file of targets) {
  let text = readFileSync(file, 'utf8')
  const before = text

  // 只在"tmp → 目标"这一处替换：调用点形如 renameSync(temp, this.file) / renameSync(tmp, path)
  const renamedCalls = text.replace(/renameSync\((temp|tmp|tempFile|staging|next)\s*,\s*([^)]+)\)/g, 'renameWithRetry($1, $2)')
  if (renamedCalls !== text) text = renamedCalls

  // 加 import（若用了 renameWithRetry 但还没有 import）
  if (text.includes('renameWithRetry(') && !text.includes('atomic-write.ts')) {
    const depth = file.includes(`${join('src', 'notify')}`) ? '..' : '.'
    const spec = depth === '..' ? '../atomic-write.ts' : './atomic-write.ts'
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    const lines = text.split('\n')
    const lastImport = lines.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
    lines.splice(lastImport + 1, 0, `import { renameWithRetry } from '${spec}'${eol}`)
    text = lines.join('\n')
  }

  // 不再需要 renameSync 的 import（若已无其它用途）
  if (!/renameSync\(/.test(text)) {
    text = text.replace(/,?\s*renameSync/g, '')
  }

  if (text !== before) {
    writeFileSync(file, text)
    console.log('patched', file.replace(ROOT, 'src'))
  } else {
    console.log('unchanged', file.replace(ROOT, 'src'))
  }
}
