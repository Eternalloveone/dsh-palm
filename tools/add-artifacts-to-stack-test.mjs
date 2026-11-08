import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'App.page-stack.test.ts')
let text = readFileSync(P, 'utf8')
const eol = text.includes('\r\n') ? '\r\n' : '\n'

const anchorA = "  outline: { kind: 'chat', session, workspace },"
if (!text.includes('  artifacts: {')) {
  text = text.replace(anchorA, anchorA + eol + "  artifacts: { kind: 'chat', session, workspace },")
}

const anchorB = "  { kind: 'outline', session, workspace, turns: [], currentTurn: 1 },"
if (!text.includes("kind: 'artifacts'")) {
  text = text.replace(anchorB, anchorB + eol + "  { kind: 'artifacts', session, workspace, turns: [] },")
}

writeFileSync(P, text)
console.log('artifacts fixture:', text.includes('  artifacts: {'), text.includes("kind: 'artifacts'"))
