import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'ChatView.tsx')
let text = readFileSync(P, 'utf8')

// 先窄化再算目标：否则 TS 认为 contextUsage 可能 undefined
text = text.replace(
  /    const target = contextEntryTarget\(contextUsage !== undefined, onOpenContext !== undefined\)\r?\n    if \(target === 'none'\) return/,
  [
    '    if (contextUsage === undefined) return',
    '    const target = contextEntryTarget(true, onOpenContext !== undefined)',
  ].join('\r\n'),
)

writeFileSync(P, text)
console.log('narrowed:', text.includes('if (contextUsage === undefined) return\r\n    const target'))
