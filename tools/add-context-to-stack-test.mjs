import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'App.page-stack.test.ts')
let text = readFileSync(P, 'utf8')
const eol = text.includes('\r\n') ? '\r\n' : '\n'

const anchorA = "  artifacts: { kind: 'chat', session, workspace },"
if (!text.includes('  context: {')) {
  text = text.replace(anchorA, anchorA + eol + "  context: { kind: 'chat', session, workspace },")
}

const anchorB = "  { kind: 'artifacts', session, workspace, turns: [] },"
if (!text.includes("kind: 'context'")) {
  text = text.replace(anchorB, anchorB + eol + "  { kind: 'context', session, workspace, usage: {} },")
}

writeFileSync(P, text)
console.log('context fixture:', text.includes('  context: {'), text.includes("kind: 'context'"))
