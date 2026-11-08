import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'ChatView.test.tsx')
let text = readFileSync(P, 'utf8')

/* 第二条测试的 jumpTo：浮层没了 → 用 pendingTurn 重渲染驱动同一个 jumpToTurn。 */
const oldJump = /      const jumpTo = async \(row: number\): Promise<void> => \{\r?\n        await act\(async \(\) => \{ fireEvent\.pointerDown\(handle, \{ pointerId: 1, clientX: 900 \}\) \}\)\r?\n        await act\(async \(\) => \{ fireEvent\.pointerUp\(handle, \{ pointerId: 1, clientX: 900 \}\) \}\)\r?\n        await waitFor\(\(\) => \{ expect\(document\.querySelectorAll\('\.turn-row'\)\.length\)\.toBeGreaterThan\(row\) \}\)\r?\n        await act\(async \(\) => \{ fireEvent\.click\(document\.querySelectorAll\('\.turn-row'\)\[row\] as HTMLElement\) \}\)\r?\n      \}\r?\n      await jumpTo\(0\)/

const newJump = [
  '      // 轮次清单已迁成独立页：用 App 链路（pendingTurn）驱动同一条跳转。',
  '      const jumpTo = async (target: { turn: number; seq: number }): Promise<void> => {',
  '        await act(async () => {',
  '          view.rerender(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} pendingTurn={target} onPendingTurnConsumed={() => {}} />)',
  '        })',
  '      }',
  '      await jumpTo({ turn: 56, seq: 99 })',
].join('\r\n')

text = text.replace(oldJump, newJump)
text = text.replace('      await jumpTo(1)', '      await jumpTo({ turn: 57, seq: 109 })')

// 用 rerender 需要保留 render 的返回值
text = text.replace(
  /      render\(<ChatView session=\{session\} onBack=\{\(\) => \{\}\} showToolCalls=\{true\} showSystemMessages=\{false\} \/>\)\r?\n      await screen\.findByText\(/,
  '      const view = render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)\r\n      await screen.findByText(',
)

writeFileSync(P, text)
console.log('view.rerender:', text.includes('view.rerender'), '| turn-row 残留:', (text.match(/turn-row/g) ?? []).length)
