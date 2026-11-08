import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'ChatView.test.tsx')
let text = readFileSync(P, 'utf8')

// 这条测试原本用裸 render，没有 rerender：改成保留返回值
const anchor = "    await screen.findByText('第 57 轮的回答')\r\n    const scroller = document.querySelector('.chat-scroll')!"
const idx = text.indexOf(anchor)
const before = text.lastIndexOf('    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)', idx)
if (before !== -1 && idx !== -1) {
  text = text.slice(0, before) +
    '    const view = render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)' +
    text.slice(before + '    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)'.length)
  text = text.replace(
    'await act(async () => { rerender(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} pendingTurn={{ turn: 56, seq: 99 }} onPendingTurnConsumed={() => {}} />) })',
    'await act(async () => { view.rerender(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} pendingTurn={{ turn: 56, seq: 99 }} onPendingTurnConsumed={() => {}} />) })',
  )
  writeFileSync(P, text)
  console.log('已改用 view.rerender:', text.includes('view.rerender(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} pendingTurn={{ turn: 56'))
} else {
  console.log('定位失败:', before, idx)
}
