import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'ChatView.test.tsx')
let text = readFileSync(P, 'utf8')

if (text.includes('头部入口：产物')) {
  console.log('已存在入口测试，跳过')
  process.exit(0)
}

const block = [
  '',
  "  describe('头部入口（页面迁出后必须真的点得进去）', () => {",
  "    it('点「产物」把当前产物交给上层（去 ⑧ 独立页）', async () => {",
  '      loadChatPageMock.mockResolvedValueOnce(rowPage([',
  "        makeEntry('assistant/message', {",
  '          turn: 1,',
  '          step: 0,',
  "          message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '做完了' }], metadata: { produced: ['src/a.ts'] } },",
  '        }, 10),',
  '      ], { hasMore: false }))',
  '      historyMock.mockResolvedValue(historyPage([]))',
  '      const onOpenArtifacts = vi.fn()',
  "      render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} onOpenArtifacts={onOpenArtifacts} />)",
  "      const button = await screen.findByRole('button', { name: '产物' })",
  '      await act(async () => { fireEvent.click(button) })',
  '      expect(onOpenArtifacts).toHaveBeenCalledTimes(1)',
  '      expect(Array.isArray(onOpenArtifacts.mock.calls[0][0])).toBe(true)',
  '    })',
  '',
  "    it('点「模型与思考」进 ⑤ 独立页', async () => {",
  '      loadChatPageMock.mockResolvedValueOnce(rowPage([], { hasMore: false }))',
  '      historyMock.mockResolvedValue(historyPage([]))',
  '      const onOpenModel = vi.fn()',
  "      render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} onOpenModel={onOpenModel} />)",
  "      const button = await screen.findByRole('button', { name: '模型与思考' })",
  '      await act(async () => { fireEvent.click(button) })',
  '      expect(onOpenModel).toHaveBeenCalledTimes(1)',
  '    })',
  '',
  "    it('没给回调时不渲染这两个入口（老用法行为不变）', async () => {",
  '      loadChatPageMock.mockResolvedValueOnce(rowPage([], { hasMore: false }))',
  '      historyMock.mockResolvedValue(historyPage([]))',
  "      render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)",
  "      await screen.findByRole('button', { name: '更多' })",
  "      expect(screen.queryByRole('button', { name: '产物' })).toBeNull()",
  "      expect(screen.queryByRole('button', { name: '模型与思考' })).toBeNull()",
  '    })',
  '  })',
  '',
].join('\r\n')

const end = text.lastIndexOf('})')
text = text.slice(0, end) + block + text.slice(end)
writeFileSync(P, text)
console.log('已加头部入口测试')
