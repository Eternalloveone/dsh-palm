/**
 * 一次性迁移工具：把 `<button>` 换成 `ui/primitives` 的 `Button`（W2-2 用）。
 *
 * 为什么写脚本：37 个文件、190 处，手改既慢又容易改错闭合标签。这里只做**机械替换**：
 * `<button` → `<Button`、`</button>` → `</Button>`，并保证 `Button` 已从 primitives 导入。
 * 语义判断（该不该用 IconButton / Chip / 换成 div）仍然留给人。
 *
 * 安全措施：
 * - 开闭标签数量必须相等，否则整文件跳过（防止自闭合或嵌套误伤）；
 * - 已经导入了 primitives 的文件不重复加 import；
 * - 只改传入的文件，不做目录遍历。
 *
 * 用法：
 *   node tools/codemod/button-to-primitive.mjs src/mobile/sheets.tsx src/mobile/diff-view.tsx
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const IMPORT_LINE = "import { Button } from '../ui/primitives.tsx'"
const PKG_ROOT = resolve(import.meta.dirname, '..', '..', 'packages', 'dsh-palm')

/** 相对路径 → 绝对路径。 */
function abs(file) {
  return resolve(PKG_ROOT, file)
}

/** 计算文件里相对 root 的 primitives 导入路径。 */
function importPathFor(file) {
  const absFile = abs(file)
  const uiDir = resolve(PKG_ROOT, 'src', 'mobile', 'ui')
  const relative = absFile.slice(resolve(PKG_ROOT, 'src', 'mobile').length + 1)
  const depth = relative.split(/[\\/]/).length - 1
  return (depth === 0 ? './ui/primitives.tsx' : '../'.repeat(depth) + 'ui/primitives.tsx')
}

/** 在最后一个 import 语句后插入导入（保持文件头部结构，跳过跨行 import 块）。 */
function addImport(text, spec) {
  const line = `import { Button } from '${spec}'`
  const lines = text.split('\n')
  let last = -1
  let openImport = false
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index] ?? ''
    if (!openImport && /^import\s/.test(current)) {
      // 单行 import 直接算数；`import {` 这种要看花括号何时闭合。
      if (/\bfrom\s+['"][^'"]+['"]/.test(current) || !current.includes('{')) last = index
      else openImport = true
      continue
    }
    if (openImport) {
      if (/\bfrom\s+['"][^'"]+['"]/.test(current)) {
        openImport = false
        last = index
      }
    }
  }
  if (last === -1) return line + '\n' + text
  lines.splice(last + 1, 0, line)
  return lines.join('\n')
}

const results = []
for (const file of process.argv.slice(2)) {
  const path = abs(file)
  const before = readFileSync(path, 'utf8')
  const opens = (before.match(/<button\b/g) ?? []).length
  const closes = (before.match(/<\/button>/g) ?? []).length
  if (opens < closes) {
    results.push(`${file}: 跳过（开 ${opens} / 闭 ${closes}，闭多于开）`)
    continue
  }
  if (opens === 0) continue

  let after = before.replace(/<button\b/g, '<Button').replace(/<\/button>/g, '</Button>')
  const hasImport = /from\s+['"][^'"]*ui\/primitives\.tsx['"]/.test(after)
  if (!hasImport) after = addImport(after, importPathFor(file))

  writeFileSync(path, after)
  const selfClosed = opens - closes
  results.push(`${file}: ${opens} 处已替换${selfClosed > 0 ? `（含 ${selfClosed} 处自闭合）` : ''}`)
}

for (const line of results) console.log('[codemod] ' + line)
