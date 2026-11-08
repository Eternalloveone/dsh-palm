import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'chat', 'components', 'chat-attention-panels.tsx')
let text = readFileSync(P, 'utf8')
const eol = text.includes('\r\n') ? '\r\n' : '\n'

// 用 UI 原语代替裸 <button>（质量预算 rawButtons ≤ 0）
if (!text.includes("from '../../../ui/primitives.tsx'")) {
  text = text.replace(
    "import { ApprovalPanel, QuestionPanel } from '../../../components/sheets.tsx'",
    `import { ApprovalPanel, QuestionPanel } from '../../../components/sheets.tsx'${eol}import { Button } from '../../../ui/primitives.tsx'`,
  )
}

text = text.replace(
  `<button${eol}              type="button"`,
  `<Button${eol}              type="button"`,
)
text = text.replace(`看完整详情 ›${eol}            </button>`, `看完整详情 ›${eol}            </Button>`)

writeFileSync(P, text)
console.log('primitive:', text.includes('ui/primitives'), '| 裸 button:', /<button/.test(text))
