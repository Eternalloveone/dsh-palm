import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'App.page-stack.test.ts')
let text = readFileSync(P, 'utf8')
const eol = text.includes('\r\n') ? '\r\n' : '\n'

const anchorA = "  model: { kind: 'chat', session, workspace },"
if (!text.includes('  appearance: {')) {
  text = text.replace(anchorA, anchorA + eol + "  appearance: { kind: 'settings', workspace },")
}

const anchorB = "  { kind: 'model', session, workspace },"
if (!text.includes("kind: 'appearance'")) {
  text = text.replace(anchorB, anchorB + eol + "  { kind: 'appearance', workspace },")
}

writeFileSync(P, text)
console.log('appearance 已加入等价性表:', text.includes('  appearance: {') && text.includes("kind: 'appearance'"))
