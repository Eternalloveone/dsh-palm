import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const p = rel => join(PKG, rel)
const read = rel => readFileSync(p(rel), 'utf8')
const write = (rel, text) => writeFileSync(p(rel), text)

/* 1) chat-overlays：去掉 turnList 透传与渲染 */
let overlays = read('src/mobile/views/chat/components/chat-overlays.tsx')
overlays = overlays
  .replace(/import \{ TurnListSheet \} from '\.\.\/\.\.\/\.\.\/components\/sheets\.tsx'\r?\n/, '')
  .replace(/[ \t]*turnList: Parameters<typeof TurnListSheet>\[0\] \| undefined\r?\n/, '')
  .replace(/[ \t]*\{turnList !== undefined && <TurnListSheet \{\.\.\.turnList\} \/>\}\r?\n/, '')
  .replace(/[ \t]*turnList = /, '    ')
write('src/mobile/views/chat/components/chat-overlays.tsx', overlays)

/* 2) ChatView：导入、状态、渲染、滑杆入口 */
let chat = read('src/mobile/views/ChatView.tsx')
chat = chat.replace(/, TurnListSheet,/g, ',')
chat = chat.replace(/, turnListOpen, renaming/g, ', renaming')
chat = chat.replace(/, turnListOpen: setTurnListOpen,/g, ',')
chat = chat.replace(/[ \t]*setTurnListOpen\(false\)\r?\n/g, '')
chat = chat.replace(/[ \t]*setTurnListOpen\(true\)\r?\n/g, '      onOpenOutline?.(turnEntries, shownTurn)\r\n')
chat = chat.replace(
  /onOpenTurnList=\{\(\) => \{ if \(onOpenOutline === undefined\) setTurnListOpen\(true\); else onOpenOutline\(turnEntries, shownTurn\) \}\}/,
  'onOpenTurnList={() => { onOpenOutline?.(turnEntries, shownTurn) }}',
)
chat = chat.replace(/[ \t]*turnList=\{turnListOpen \? \{[\s\S]*?\} : undefined\}\r?\n/, '')
write('src/mobile/views/ChatView.tsx', chat)

/* 3) chat-machine / escape */
let machine = read('src/mobile/views/chat/state/chat-machine.ts')
machine = machine
  .replace(/[ \t]*turnListOpen: boolean\r?\n/, '')
  .replace(/'turnListOpen', /, '')
  .replace(/[ \t]*turnListOpen: false,\r?\n/, '')
write('src/mobile/views/chat/state/chat-machine.ts', machine)

let escape = read('src/mobile/views/chat/hooks/use-chat-escape.ts')
escape = escape
  .replace(/[ \t]*setters\.turnListOpen\(false\)\r?\n/, '')
  .replace(/ \|\| ui\.turnListOpen/g, '')
write('src/mobile/views/chat/hooks/use-chat-escape.ts', escape)

const left = ['src/mobile/views/ChatView.tsx', 'src/mobile/views/chat/components/chat-overlays.tsx', 'src/mobile/views/chat/state/chat-machine.ts'].map(rel => (read(rel).match(/turnList/gi) ?? []).length)
console.log('剩余 turnList 引用（三文件）:', left.join(', '))
