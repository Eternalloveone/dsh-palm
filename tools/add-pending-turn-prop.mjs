import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'ChatView.tsx')
let text = readFileSync(P, 'utf8')
const eol = '\r\n'

const propAnchor = /  \/\*\* 打开回合大纲独立页（P6 ⑫ 屏）；不给就还开浮层。 \*\/\r?\n  onOpenOutline\?:[^\r\n]*(?:\r?\n[^\r\n]*)?\r?\n/
const propMatch = propAnchor.exec(text)
console.log('找到 onOpenOutline 属性块:', propMatch !== null)

if (propMatch !== null && !text.includes('  pendingTurn?: ')) {
  const block = propMatch[0]
  text = text.replace(
    block,
    block +
      `  /** 大纲页点了某一轮：回到对话后落位到它（由 App 置，ChatView 消费后清空）。 */${eol}` +
      `  pendingTurn?: { turn: number; seq: number } | undefined${eol}` +
      `  /** 消费完成回调（不清空的话返回再进会重复跳）。 */${eol}` +
      `  onPendingTurnConsumed?: (() => void) | undefined${eol}`,
  )
}

// 解构
if (text.includes('  onOpenOutline,' + eol + '}') && !text.includes('  pendingTurn,' + eol)) {
  text = text.replace('  onOpenOutline,' + eol + '}', '  onOpenOutline,' + eol + '  pendingTurn,' + eol + '  onPendingTurnConsumed,' + eol + '}')
}

writeFileSync(P, text)
const ok = text.includes('  pendingTurn?: ') && text.includes('  pendingTurn,' + eol)
console.log('属性:', text.includes('  pendingTurn?: '), '| 解构:', text.includes('  pendingTurn,' + eol), '| ok:', ok)
