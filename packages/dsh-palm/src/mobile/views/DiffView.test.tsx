// @vitest-environment jsdom
/**
 * 单文件 diff 页（P6 ⑩ 屏）的页面外壳：标题/路径、三槽布局、返回落点、
 * 加载/失败/图片三态与「复制原文」。
 *
 * 行视图本身（增删类名、上下文无底色、行号、超长行）在
 * `components/diff-rows.test.tsx` 里测；这里只测页面组装与取数状态。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiffView } from './DiffView.tsx'
import { readFile } from '../data/fs.ts'
import { resetPageCache } from '../page-cache.ts'

// 取数走 data 门面（视图不直连 api.ts）；这里只替换最外层的读文件。
vi.mock('../data/fs.ts', () => ({ readFile: vi.fn() }))
const readFileMock = vi.mocked(readFile)

/** 一份能同时覆盖增/删/上下文的最小 diff。 */
const SAMPLE = [
  '--- a/src/mobile/views/App.tsx',
  '+++ b/src/mobile/views/App.tsx',
  '@@ -1,3 +1,4 @@',
  ' const a = 1',
  '-const b = 1',
  '+const b = 2',
  ' const c = 3',
  '',
].join('\n')

beforeEach(() => {
  cleanup()
  resetPageCache()
  readFileMock.mockReset()
})

afterEach(() => { cleanup() })

describe('单文件 diff 页（P6 ⑩ 屏）', () => {
  it('标题只放文件名，目录单独一行', async () => {
    readFileMock.mockResolvedValue({ kind: 'text', path: 'src/mobile/views/App.tsx', name: 'App.tsx', text: SAMPLE })
    render(<DiffView path="src/mobile/views/App.tsx" sessionId="s-1" onBack={() => {}} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('App.tsx')
    expect(screen.getByText('src/mobile/views')).toBeDefined()
    // 读文件按会话 cwd 解析相对路径，不能丢 sessionId。
    expect(readFileMock).toHaveBeenCalledWith('src/mobile/views/App.tsx', 's-1')
    await screen.findByText('const b = 2')
  })

  it('没有目录时不留空行', async () => {
    readFileMock.mockResolvedValue({ kind: 'text', path: 'README.md', name: 'README.md', text: '# 标题\n' })
    render(<DiffView path="README.md" sessionId="s-1" onBack={() => {}} />)
    expect(document.querySelector('.diff-page-path')).toBeNull()
    await screen.findByText('# 标题')
  })

  it('按 diffLayout 出三个槽，正文是只读行视图', async () => {
    readFileMock.mockResolvedValue({ kind: 'text', path: 'a/b.ts', name: 'b.ts', text: SAMPLE })
    const { container } = render(<DiffView path="a/b.ts" sessionId="s-1" onBack={() => {}} />)
    const slots = [...container.querySelectorAll('[data-slot]')].map(node => node.getAttribute('data-slot'))
    expect(slots).toEqual(['header', 'diff', 'pager'])
    await screen.findByText('const b = 2')
    expect(container.querySelector('.diff-page-row-add')).toBeTruthy()
    expect(container.querySelector('.diff-page-row-del')).toBeTruthy()
    expect(container.querySelector('.diff-page-row-ctx')).toBeTruthy()
  })

  it('返回按钮调用 onBack（由页面栈回到会话）', () => {
    readFileMock.mockReturnValue(new Promise(() => {}))
    const onBack = vi.fn()
    render(<DiffView path="a.ts" sessionId="s-1" onBack={onBack} />)
    screen.getByRole('button', { name: '返回' }).click()
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('Windows 路径也能正确取目录', async () => {
    readFileMock.mockResolvedValue({ kind: 'text', path: 'src/mobile/App.tsx', name: 'App.tsx', text: 'const a = 1\n' })
    render(<DiffView path={'src\\mobile\\App.tsx'} sessionId="s-1" onBack={() => {}} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('App.tsx')
    expect(screen.getByText('src\\mobile')).toBeDefined()
    await screen.findByText('const a = 1')
  })

  it('读取中显示占位，宿主拒绝时给出可读错误', async () => {
    readFileMock.mockReturnValue(new Promise(() => {}))
    const { unmount } = render(<DiffView path="a.ts" sessionId="s-1" onBack={() => {}} />)
    expect(screen.getByText('正在读取文件…')).toBeDefined()
    unmount()

    readFileMock.mockRejectedValue(new Error('文件不可读'))
    render(<DiffView path="a.ts" sessionId="s-1" onBack={() => {}} />)
    expect((await screen.findByRole('alert')).textContent).toBe('文件不可读')
  })

  it('复制原文：拿到文件文本后用剪贴板写一次', async () => {
    readFileMock.mockResolvedValue({ kind: 'text', path: 'C:/proj/a.ts', name: 'a.ts', text: 'const a = 1\n' })
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    render(<DiffView path="C:/proj/a.ts" sessionId="s-1" onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: '复制文件原文' }))
    expect(writeText).toHaveBeenCalledWith('const a = 1\n')
  })

  it('图片文件按图片渲染，不给复制原文', async () => {
    readFileMock.mockResolvedValue({ kind: 'image', path: 'C:/x.png', name: 'x.png', dataUrl: 'data:image/png;base64,AAAA' })
    render(<DiffView path="C:/x.png" sessionId="s-1" onBack={() => {}} />)
    const image = await screen.findByRole('img', { name: 'x.png' })
    expect(image.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(screen.queryByRole('button', { name: '复制文件原文' })).toBeNull()
  })
})
