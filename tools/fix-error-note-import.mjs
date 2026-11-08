import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'ui', 'error-note.tsx')
let text = readFileSync(P, 'utf8')

if (!text.includes("import type { ReactNode }")) {
  text = text.replace(
    "import { Button } from './primitives.tsx'",
    "import type { ReactNode } from 'react'\r\nimport { Button } from './primitives.tsx'",
  )
  writeFileSync(P, text)
}

console.log('imported:', text.includes("import type { ReactNode }"))
