import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'ChatView.test.tsx')
let text = readFileSync(P, 'utf8')

/* 轮次清单浮层已删除（⑫ 迁成独立页）：这两条测试改为走「App 设置 pendingTurn」的等价路径，
   覆盖的仍是同一个 jumpToTurn 落点逻辑，不再依赖浮层 DOM。 */

const openBlock = /    \/\/ 轻点打开轮次清单（不移动 = 点击）。\r?\n(?:    await act\(async \(\) => \{ fireEvent\.pointerDown[\s\S]*?\r?\n)/g

// 1) 打开清单 + 点条目 → 改为：给 ChatView 一个 pendingTurn
text = text.replace(
  /    \/\/ 轻点打开轮次清单（不移动 = 点击）。\r?\n    await act\(async \(\) => \{ fireEvent\.pointerDown\(handle, \{ pointerId: 1, clientX: 900 \}\) \}\)\r?\n    await act\(async \(\) => \{ fireEvent\.pointerUp\(handle, \{ pointerId: 1, clientX: 900 \}\) \}\)\r?\n    \/\/ 轮次清单里点最上面那条 = 第 56 轮。[^\r\n]*\r?\n    \/\/ 直接按行元素点。\r?\n    await waitFor\(\(\) => \{ expect\(document\.querySelectorAll\('\.turn-row'\)\.length\)\.toBe\(2\) \}\)\r?\n    const item = document\.querySelectorAll\('\.turn-row'\)\[0\] as HTMLElement\r?\n    await act\(async \(\) => \{ fireEvent\.click\(item\) \}\)\r?\n/,
  `    // 轮次清单已迁成独立页：这里用 App 真实链路（pendingTurn）驱动同一条跳转。\r\n    await act(async () => { rerender(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} pendingTurn={{ turn: 56, seq: 99 }} onPendingTurnConsumed={() => {}} />) })\r\n`,
)

writeFileSync(P, text)
console.log('替换后仍含 turn-row:', text.includes('.turn-row'))
