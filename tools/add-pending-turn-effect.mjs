import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'ChatView.tsx')
let text = readFileSync(P, 'utf8')
const eol = '\r\n'

// 1) 解构补上 pendingTurn / onPendingTurnConsumed
if (!text.includes('  pendingTurn,' + eol)) {
  text = text.replace('  onOpenOutline,' + eol, '  onOpenOutline,' + eol + '  pendingTurn,' + eol + '  onPendingTurnConsumed,' + eol)
}

// 2) 消费 effect：放在 jumpToTurnRef 注册之后（行已就绪时立刻跳）
if (!text.includes('consumedTurnKeyRef')) {
  const anchor = '  const jumpToTurnNumber = useCallback((turn: number): void => {'
  const block = [
    '  /** 大纲页选中的轮次：行到位后跳过去，然后通知外部清空请求。 */',
    '  const consumedTurnKeyRef = useRef<string | undefined>(undefined)',
    '  useEffect(() => {',
    '    if (pendingTurn === undefined) {',
    '      consumedTurnKeyRef.current = undefined',
    '      return',
    '    }',
    '    if (messages.length === 0) return',
    '    const key = `${pendingTurn.turn}:${pendingTurn.seq}`',
    '    if (consumedTurnKeyRef.current === key) return',
    '    consumedTurnKeyRef.current = key',
    '    jumpToTurnRef.current?.({ turn: pendingTurn.turn, seq: pendingTurn.seq, prompt: \'\', response: \'\', loaded: true })',
    '    onPendingTurnConsumed?.()',
    '  }, [pendingTurn, messages.length, onPendingTurnConsumed])',
    '',
    '',
  ].join(eol)
  text = text.replace(anchor, block + anchor)
}

writeFileSync(P, text)
console.log('解构:', text.includes('  pendingTurn,' + eol), '| effect:', text.includes('consumedTurnKeyRef'))
