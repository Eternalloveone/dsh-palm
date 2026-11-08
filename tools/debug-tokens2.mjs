import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'styles', '000-tokens.css'), 'utf8')

function declarationsIn(selectorText) {
  const out = {}
  let from = 0
  for (;;) {
    const start = CSS.indexOf(selectorText, from)
    if (start === -1) break
    from = start + selectorText.length
    const open = CSS.indexOf('{', start)
    const close = CSS.indexOf('}', open)
    if (open === -1 || close === -1) continue
    for (const line of CSS.slice(open + 1, close).split(';')) {
      const match = /^\s*(--palm-[a-z0-9-]+)\s*:\s*([^;]+)$/i.exec(line.trim())
      if (match !== null) out[match[1]] = match[2].trim()
    }
  }
  return out
}

const base = declarationsIn(':root')
console.log('base 令牌数:', Object.keys(base).length)
console.log('base 含 r-s:', '--palm-r-s' in base, '| 含 hi:', '--palm-hi' in base)
const g = declarationsIn("html[data-skin='graphite']")
console.log('graphite 覆盖数:', Object.keys(g).length, '| 含 r-s:', '--palm-r-s' in g)
const merged = Object.keys({ ...base, ...g })
console.log('合并后:', merged.length)
