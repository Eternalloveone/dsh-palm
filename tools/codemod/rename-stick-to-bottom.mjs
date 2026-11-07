/** 一次性重命名：useChatScroll → useStickToBottom（W2-5 提升为内核级 hook）。 */
import { readFileSync, writeFileSync } from 'node:fs'

const base = 'packages/dsh-palm/src/mobile'
const hook = `${base}/ui/hooks/use-stick-to-bottom.ts`
const test = `${base}/ui/hooks/use-stick-to-bottom.test.tsx`

const hookText = readFileSync(hook, 'utf8')
  .replace(/useChatScroll/g, 'useStickToBottom')
  .replace('@module dsh-palm/mobile/views/chat/use-chat-scroll', '@module dsh-palm/mobile/ui/hooks/use-stick-to-bottom')
writeFileSync(hook, hookText)

const testText = readFileSync(test, 'utf8')
  .replace(/useChatScroll/g, 'useStickToBottom')
  .replace("'./use-chat-scroll.ts'", "'./use-stick-to-bottom.ts'")
writeFileSync(test, testText)

console.log('[rename] useChatScroll → useStickToBottom')
