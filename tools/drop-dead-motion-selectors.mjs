import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'styles', '360-reduced-motion.css')
const before = readFileSync(P, 'utf8')

// 这两个类在别处已经不存在（基类都删了），reduced-motion 里的覆盖是死引用：
// 只从选择器名单里摘掉这两行，不动规则本体。
let text = before
  .replace(/\r?\n  \.chat-chip,(?=\r?\n)/, '')
  .replace(/\r?\n  \.sheet-toggle-switch-knob,(?=\r?\n)/, '')

writeFileSync(P, text)
console.log('删除:', before.split('\n').length - text.split('\n').length, '行')
