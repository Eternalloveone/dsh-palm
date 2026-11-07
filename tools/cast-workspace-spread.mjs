import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
let text = readFileSync(API, 'utf8')
const before = '    ...workspaceHandlers,'
const after = '    ...(workspaceHandlers as unknown as never[]),'
if (text.includes(after)) {
  console.log('already cast')
} else if (text.includes(before)) {
  writeFileSync(API, text.replace(before, after))
  console.log('spread cast applied')
} else {
  console.log('spread line not found')
}
