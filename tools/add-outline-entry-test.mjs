import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'ChatView.test.tsx')
let text = readFileSync(P, 'utf8')

if (text.includes('轻点轮次滑杆进 ⑫ 大纲页')) {
  console.log('已存在，跳过')
  process.exit(0)
}

const block = [
  '',
  "    it('轻点轮次滑杆进 ⑫ 大纲页，并把轮次清单交出去', async () => {",
  '      scrollHeightMock = 20_000',
  '      clientHeightMock = 600',
  '      loadChatPageMock.mockResolvedValueOnce(rowPage([',
  "        makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '第一个问题' }] }, 9),",
  "        makeEntry('assistant/message', { turn: 1, step: 0, message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '第一个回答' }] } }, 10),",
  '      ], { hasMore: false }))',
  '      historyMock.mockResolvedValue(historyPage([]))',
  '      const onOpenOutline = vi.fn()',
  "      render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} onOpenOutline={onOpenOutline} />)",
  "      await screen.findByText('第一个回答')",
  "      userScroll(document.querySelector('.chat-scroll')!, 5_000)",
  "      const handle = await screen.findByRole('button', { name: '轮次导航：轻点开清单，按住拖动刮擦' })",
  "      Object.defineProperty(handle, 'setPointerCapture', { value: () => {}, configurable: true })",
  "      Object.defineProperty(handle, 'hasPointerCapture', { value: () => true, configurable: true })",
  "      Object.defineProperty(handle, 'releasePointerCapture', { value: () => {}, configurable: true })",
  '      await act(async () => { fireEvent.pointerDown(handle, { pointerId: 1, clientX: 900 }) })',
  '      await act(async () => { fireEvent.pointerUp(handle, { pointerId: 1, clientX: 900 }) })',
  '      expect(onOpenOutline).toHaveBeenCalledTimes(1)',
  '      expect(Array.isArray(onOpenOutline.mock.calls[0][0])).toBe(true)',
  '    })',
  '',
].join('\r\n')

// 插在"头部入口"describe 的收尾之前
const anchor = "  describe('头部入口（页面迁出后必须真的点得进去）', () => {"
const start = text.indexOf(anchor)
const endOfDescribe = text.indexOf('\r\n  })\r\n', start)
if (start === -1 || endOfDescribe === -1) {
  console.log('定位失败，放弃')
  process.exit(1)
}

text = text.slice(0, endOfDescribe) + block + text.slice(endOfDescribe + '\r\n  })'.length)
writeFileSync(P, text)
console.log('已加滑杆入口测试')
