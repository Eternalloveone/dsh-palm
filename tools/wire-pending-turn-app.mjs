import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'App.tsx')
let app = readFileSync(P, 'utf8')
const eol = '\r\n'

// 1) 状态：大纲页选中的轮次
if (!app.includes('const [pendingTurn')) {
  app = app.replace(
    '  const [finishToast, setFinishToast] = useState<FinishedRun | undefined>(undefined)',
    '  const [finishToast, setFinishToast] = useState<FinishedRun | undefined>(undefined)' +
      eol + '  /** 大纲页点了哪一轮：回到对话后由 ChatView 消费并落位。 */' +
      eol + '  const [pendingTurn, setPendingTurn] = useState<{ turn: number; seq: number } | undefined>(undefined)',
  )
}

// 2) 大纲页 onPick：记住目标再返回
if (!app.includes('onPick={(entry) => {')) {
  app = app.replace(
    '              onPick={() => { back() }}',
    '              onPick={(entry) => {' + eol +
      '                setPendingTurn({ turn: entry.turn, seq: entry.seq })' + eol +
      '                back()' + eol +
      '              }}',
  )
}

// 3) 传给 ChatView
if (!app.includes('pendingTurn={pendingTurn}')) {
  app = app.replace(
    '            onOpenOutline={(turns, currentTurn) => {',
    '            pendingTurn={pendingTurn}' + eol +
      '            onPendingTurnConsumed={() => { setPendingTurn(undefined) }}' + eol +
      '            onOpenOutline={(turns, currentTurn) => {',
  )
}

writeFileSync(P, app)
console.log('state:', app.includes('const [pendingTurn'), '| pick:', app.includes('onPick={(entry) => {'), '| pass:', app.includes('pendingTurn={pendingTurn}'))
