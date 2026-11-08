import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'ui', 'error-note.tsx')
let text = readFileSync(P, 'utf8')

// 接口里补 icon（用行定位，别猜换行符）
const lines = text.split(/\r?\n/)
const end = lines.findIndex((line, index) => line.trim() === '}' && lines.slice(0, index).some(l => l.includes('interface ErrorNoteProps')))
if (end !== -1) {
  lines.splice(end, 0, '  /** 可选图标：16px 线性 SVG。 */', '  icon?: ReactNode')
  text = lines.join('\r\n')
}

// 需要 ReactNode 类型导入
if (!text.includes("import type { ReactNode }")) {
  text = text.replace(/^(import .*\n)/, 'import type { ReactNode } from \'react\'\r\n$1')
}

writeFileSync(P, text)
console.log(JSON.stringify({ icon: text.includes('icon?: ReactNode'), 导入: text.includes("import type { ReactNode }") }))
