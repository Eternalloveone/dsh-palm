import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const p = rel => join(PKG, rel)
const read = rel => readFileSync(p(rel), 'utf8')
const write = (rel, text) => writeFileSync(p(rel), text)
const eol = '\r\n'

/* 1) ChatView：接收"要跳到哪一轮"的请求（⑫ 页面点条目后回到对话并落位） */
let chat = read('src/mobile/views/ChatView.tsx')
if (!chat.includes('pendingTurn')) {
  chat = chat.replace(
    `  /** 打开回合大纲独立页（P6 ⑫ 屏）；不给就还开浮层。 */`,
    `  /** 大纲页点某一轮后要落到的目标：由 App 设，ChatView 消费后回调清空。 */${eol}  pendingTurn?: { turn: number; seq: number } | undefined${eol}  /** 消费完通知外部清空（否则返回再进会重复跳）。 */${eol}  onPendingTurnConsumed?: (() => void) | undefined${eol}  /** 打开回合大纲独立页（P6 ⑫ 屏）；不给就还开浮层。 */`,
  )
  chat = chat.replace(`  onOpenOutline,${eol}}`, `  onOpenOutline,${eol}  pendingTurn,${eol}  onPendingTurnConsumed,${eol}}`)

  // 消费：等这一页的行到位后再跳（jumpToTurn 需要行在窗口里）
  const hookAnchor = '  /** Toggle the context-usage popover on the ring. */'
  const hook = [
    '  /** 大纲页选中的轮次：行到位后跳过去，然后清空请求。 */',
    '  const consumedTurnRef = useRef<string | undefined>(undefined)',
    '  useEffect(() => {',
    '    if (pendingTurn === undefined) { consumedTurnRef.current = undefined; return }',
    '    const key = `${pendingTurn.turn}:${pendingTurn.seq}`',
    '    if (consumedTurnRef.current === key) return',
    '    if (messages.length === 0) return',
    '    consumedTurnRef.current = key',
    '    jumpToTurnRef.current?.({ turn: pendingTurn.turn, seq: pendingTurn.seq, prompt: \'\', response: \'\', loaded: true })',
    '    onPendingTurnConsumed?.()',
    '  }, [pendingTurn, messages.length, onPendingTurnConsumed])',
    '',
  ].join(eol)
  chat = chat.replace(hookAnchor, hook + hookAnchor)

  // jumpToTurn 的引用：避免 effect 依赖顺序问题
  if (!chat.includes('jumpToTurnRef')) {
    chat = chat.replace(
      '  const jumpToTurn = useCallback((entry: TurnEntry): void => {',
      '  const jumpToTurnRef = useRef<((entry: TurnEntry) => void) | undefined>(undefined)',
    )
  }
  write('src/mobile/views/ChatView.tsx', chat)
}

console.log('pendingTurn:', read('src/mobile/views/ChatView.tsx').includes('pendingTurn'))
