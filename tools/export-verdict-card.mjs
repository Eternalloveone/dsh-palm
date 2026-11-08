import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'ui', 'index.ts')
const text = readFileSync(P, 'utf8')
if (text.includes('verdict-card')) {
  console.log('already exported')
  process.exit(0)
}
const eol = text.includes('\r\n') ? '\r\n' : '\n'
const line = `export { VerdictCard, type VerdictAction, type VerdictArtifact, type VerdictCardProps, type VerdictFootnote, type VerdictState } from './verdict-card.tsx'`
const anchor = "export { Menu, Popover"
if (!text.includes(anchor)) {
  console.log('未找到锚点')
  process.exit(1)
}
writeFileSync(P, text.replace(anchor, line + eol + anchor))
console.log('export added')
