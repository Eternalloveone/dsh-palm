import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const STYLES = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'styles')

/** 删除以这些选择器开头的规则块（含其后的属性选择器变体与伪类变体）。 */
const TARGETS = {
  '005-components.css': ['palm-btn', 'palm-input', 'palm-chip', 'palm-row', 'palm-tag', 'palm-icon', 'palm-foot', 'palm-verdict'],
  '400-run-overview.css': ['turn-list', 'turn-row'],
}

/** 该选择器行是否属于目标类（含 [attr] / :pseudo / -suffix 变体）。 */
function matches(line, roots) {
  const match = /^\.([a-zA-Z][a-zA-Z0-9_-]*)/.exec(line)
  if (match === null) return false
  const cls = match[1]
  return roots.some(root => cls === root || cls.startsWith(root + '-'))
}

let removedBlocks = 0
let removedLines = 0

for (const [file, roots] of Object.entries(TARGETS)) {
  const path = join(STYLES, file)
  const lines = readFileSync(path, 'utf8').split('\n')
  const out = []
  let skipping = false
  let inTargetComment = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (!skipping) {
      // 目标选择器（可能是逗号列表的首行）
      if (matches(line.replace(/\r$/, ''), roots)) {
        // 注释行也算进目标块（紧邻其上）
        while (out.length > 0) {
          const last = out[out.length - 1].replace(/\r$/, '')
          if (last.trim().startsWith('/*') || (last.trim().startsWith('*') && last.trim() !== '*/')) {
            out.pop()
            removedLines += 1
          } else break
        }
        skipping = true
        inTargetComment = false
        removedBlocks += 1
      }
    }

    if (skipping) {
      removedLines += 1
      const trimmed = line.replace(/\r$/, '').trim()
      // 规则块结束：单独一行的 }
      if (trimmed === '}') {
        skipping = false
        continue
      }
      continue
    }

    out.push(line)
  }

  writeFileSync(path, out.join('\n'))
}

console.log(`删除 ${removedBlocks} 个规则块，共 ${removedLines} 行`)
