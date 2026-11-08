import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'render', 'message-row.tsx')
let text = readFileSync(P, 'utf8')
const eol = text.includes('\r\n') ? '\r\n' : '\n'

// 1) 导入结论卡与适配层
if (!text.includes("ui/verdict-card.tsx'")) {
  text = text.replace(
    "import { stepModel, type StepVariant } from './step-view.ts'",
    `import { stepModel, type StepVariant } from './step-view.ts'${eol}import { VerdictCard } from '../ui/verdict-card.tsx'${eol}import { turnVerdictProps } from '../views/chat/lib/turn-verdict.ts'`,
  )
}

// 2) 纯文字回合（没有文件、没有计划）现在渲染一张结论卡，而不是留空
const anchor = `    if (reportCount === 0 && planItems.length === 0) return null`
if (!text.includes(anchor)) {
  console.log('未找到空回合返回点')
  process.exit(1)
}

const replacement = [
  `    if (reportCount === 0 && planItems.length === 0) {`,
  `      // 纯文字回合：以前这里直接返回 null，于是"这一轮说了什么"在列表里没有落点。`,
  `      // 现在给一张结论卡（四态由 turnVerdictProps 判定），正文第一句就是结论。`,
  `      const verdict = turnVerdictProps({ message, running: false })`,
  `      if (verdict === undefined) return null`,
  `      return (`,
  `        <div`,
  `          data-mid={message.id}`,
  `          data-message-id={message.id}`,
  `          data-row-seq={focusSeqAttr}`,
  `          className="chat-turn-verdict"`,
  `          style={style}`,
  `        >`,
  `          <VerdictCard {...verdict} />`,
  `        </div>`,
  `      )`,
  `    }`,
].join(eol)

text = text.replace(anchor, replacement)
writeFileSync(P, text)
console.log('message-row 已接入结论卡')
