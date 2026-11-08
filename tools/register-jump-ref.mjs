import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'ChatView.tsx')
let text = readFileSync(P, 'utf8')
const eol = '\r\n'

// 1) 在 jumpToTurn 定义之前声明 ref
if (!text.includes('const jumpToTurnRef')) {
  text = text.replace(
    '  const jumpToTurn = useCallback((entry: TurnEntry): void => {',
    '  /** 大纲页选中轮次后调用（在本函数定义之后注册，避免 TDZ 与依赖顺序问题）。 */' +
      eol + '  const jumpToTurnRef = useRef<((entry: TurnEntry) => void) | undefined>(undefined)' +
      eol + '  const jumpToTurn = useCallback((entry: TurnEntry): void => {',
  )
}

// 2) 在 jumpToTurnNumber 之前注册：ref 指向最新的 jumpToTurn
if (!text.includes('jumpToTurnRef.current = jumpToTurn')) {
  text = text.replace(
    '  const jumpToTurnNumber = useCallback((turn: number): void => {',
    '  jumpToTurnRef.current = jumpToTurn' + eol + eol +
      '  const jumpToTurnNumber = useCallback((turn: number): void => {',
  )
}

writeFileSync(P, text)
console.log('ref 声明:', text.includes('const jumpToTurnRef'), '| 注册:', text.includes('jumpToTurnRef.current = jumpToTurn'))
