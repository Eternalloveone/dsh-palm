import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'App.page-stack.test.ts')
let text = readFileSync(P, 'utf8')
const eol = text.includes('\r\n') ? '\r\n' : '\n'

const anchorA = "  appearance: { kind: 'settings', workspace },"
if (!text.includes('  outline: {')) {
  text = text.replace(anchorA, anchorA + eol + "  outline: { kind: 'chat', session, workspace },")
}

const anchorB = "  { kind: 'appearance', workspace },"
if (!text.includes("kind: 'outline'")) {
  text = text.replace(anchorB, anchorB + eol + "  { kind: 'outline', session, workspace, turns: [], currentTurn: 1 },")
}

writeFileSync(P, text)
console.log('outline fixture:', text.includes('  outline: {'), text.includes("kind: 'outline'"))
