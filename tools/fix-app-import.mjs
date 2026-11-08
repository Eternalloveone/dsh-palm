import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const A = join(PKG, 'src', 'mobile', 'views', 'App.tsx')
let app = readFileSync(A, 'utf8')

// 修好被脚本切坏的 import
app = app.replace(
  /import \{ observeSession, prompt\s+sendCommand,\s*\} from '\.\.\/data\/session\.ts'/,
  "import { observeSession, prompt, sendCommand } from '../data/session.ts'",
)

// routeKeyOf 补 approval-mode 分支（routeKeyOf 需要带参数分支）
if (!app.includes("route.kind === 'approval-mode'")) {
  app = app.replace(
    "  if (route.kind === 'approval-mode') return `approval-mode:",
    "  if (route.kind === 'approval-mode') return `approval-mode:",
  )
}

writeFileSync(A, app)
console.log('import 修复:', app.includes("import { observeSession, prompt, sendCommand }"))
