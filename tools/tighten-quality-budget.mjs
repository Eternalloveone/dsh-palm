import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const STYLES = join(PKG, 'src', 'mobile', 'styles')
const QUALITY = join(PKG, 'src', 'mobile', 'platform', 'quality-budget.ts')

const CSS = readdirSync(STYLES)
  .filter(name => name.endsWith('.css') && name !== '000-tokens.css')
  .sort()
  .map(name => readFileSync(join(STYLES, name), 'utf8'))
  .join('\n')

const count = (text, pattern) => (text.match(pattern) ?? []).length
const measured = {
  cssPx: count(CSS, /\b\d+(\.\d+)?px\b/g),
  cssClasses: new Set([...CSS.matchAll(/^\s*\.[a-zA-Z][a-zA-Z0-9_-]*/gm)].map(match => match[0].trim())).size,
  cssHex: count(CSS, /#[0-9a-fA-F]{3,8}\b/g),
  cssImportant: count(CSS, /!important/g),
}

let text = readFileSync(QUALITY, 'utf8')
const applied = []
for (const [key, value] of Object.entries(measured)) {
  const pattern = new RegExp(`(${key}: \\{ value: )(\\d+)`)
  const match = pattern.exec(text)
  if (match === null) continue
  const cap = Number(match[2])
  // 只降不升：实测比上限小就收紧，绝不越过实测往上放宽
  if (value < cap) {
    text = text.replace(match[0], `${match[1]}${value}`)
    applied.push(`${key}: ${cap} → ${value}`)
  } else if (value > cap) {
    applied.push(`${key}: 实测 ${value} > 上限 ${cap}（未动，需人工决定）`)
  }
}

writeFileSync(QUALITY, text)
console.log(applied.length === 0 ? '质量预算无需调整' : applied.join('\n'))
