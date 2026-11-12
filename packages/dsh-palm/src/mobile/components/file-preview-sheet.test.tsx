// @vitest-environment jsdom
/** FilePreviewSheet: loading → ready/error states, copy action. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FilePreviewSheet } from './file-preview-sheet.tsx'
import { readFile } from '../api.ts'

vi.mock('../api.ts', () => ({
  readFile: vi.fn(),
}))

// shiki's sync highlighter is pure and lightweight; stub it so the preview
// always takes the plain-text path in jsdom (no grammar/tokenizer concerns).
// CodeBlock also imports languageInfo for its header label.
import { highlightCodeSync, languageInfo } from '../render/shiki.ts'
vi.mock('../render/shiki.ts', () => ({
  highlightCodeSync: vi.fn((_code: string, _lang: string) => null),
  languageInfo: vi.fn((lang: string) => ({ label: lang === '' ? 'text' : lang, runnable: false, ext: 'txt' })),
}))
const highlightMock = vi.mocked(highlightCodeSync)

const readFileMock = vi.mocked(readFile)

/** Fixed session id every render uses (relative paths resolve against it). */
const SESSION = 'session-test-1'

describe('FilePreviewSheet', () => {
  beforeEach(() => { cleanup(); readFileMock.mockReset(); highlightMock.mockReset() })
  afterEach(() => { cleanup() })

  it('shows loading then the previewed text with its path and name', async () => {
    readFileMock.mockResolvedValue({ kind: 'text', path: 'C:/proj/demo.ts', name: 'demo.ts', text: 'const answer = 42\n' })
    render(<FilePreviewSheet path="C:/proj/demo.ts" sessionId={SESSION} onClose={() => {}} />)
    expect(screen.getByText('正在读取文件…')).toBeTruthy()
    const pathLabel = await screen.findByTitle('C:/proj/demo.ts')
    expect(pathLabel).toBeTruthy()
    expect(await screen.findByText('const answer = 42', { selector: '.fp-plain' })).toBeTruthy()
    // The owning session id rides the read so relative paths resolve on the host.
    expect(readFileMock).toHaveBeenCalledWith('C:/proj/demo.ts', SESSION)
  })

  it('renders an error state when the host refuses the file', async () => {
    readFileMock.mockRejectedValue(new Error('文件不可读'))
    render(<FilePreviewSheet path="C:/nope.ts" sessionId={SESSION} onClose={() => {}} />)
    expect(await screen.findByText('文件不可读')).toBeTruthy()
  })

  it('copies the file content on the copy button', async () => {
    readFileMock.mockResolvedValue({ kind: 'text', path: 'C:/proj/a.txt', name: 'a.txt', text: 'hello world' })
    // copyText uses navigator.clipboard; stub it.
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    render(<FilePreviewSheet path="C:/proj/a.txt" sessionId={SESSION} onClose={() => {}} />)
    const copy = await screen.findByRole('button', { name: '复制原文' })
    fireEvent.click(copy)
    expect(writeText).toHaveBeenCalledWith('hello world')
  })

  it('renders a markdown document as formatted md (not plain text)', async () => {
    const md = '# 标题一\n\n正文段落\n\n```ts\nconst x = 1\n```\n'
    readFileMock.mockResolvedValue({ kind: 'text', path: 'C:/proj/README.md', name: 'README.md', text: md })
    const { container } = render(<FilePreviewSheet path="C:/proj/README.md" sessionId={SESSION} onClose={() => {}} />)
    await screen.findByText('标题一')
    expect(container.querySelector('.fp-md')).toBeTruthy()
    // Heading is parsed into an <h1> (markdown render, not plain text).
    const h1 = container.querySelector('.fp-md h1')
    expect(h1?.textContent).toBe('标题一')
    // No plain-text <pre> wrapper for md documents.
    expect(container.querySelector('.fp-plain')).toBeNull()
  })

  /**
   * 真机 2026-11-11：正文里的 md 打开是源码。
   *
   * 根因不是渲染器，是**扩展名解析**：聊天里的路径常带定位尾巴
   * （`docs/x.md#L24`、`x.md?raw`、`report.md:24`），`lastIndexOf('.')` 把尾巴
   * 算进扩展名 → `md#l24` 不是 md → 落到 `<pre>` 源码视图。
   */
  it('md 路径带定位尾巴（#L24 / ?raw / :24）仍按文档渲染', async () => {
    const md = '# 标题一\n\n正文段落\n'
    for (const suffix of ['#L24', '?raw', ':24', ':24-30']) {
      readFileMock.mockResolvedValue({
        kind: 'text', path: `C:/proj/README.md${suffix}`, name: 'README.md', text: md,
      })
      const view = render(
        <FilePreviewSheet path={`C:/proj/README.md${suffix}`} sessionId={SESSION} onClose={() => {}} />,
      )
      const container = view.container
      await waitFor(() => {
        expect(container.querySelector('.fp-md h1'), suffix).toBeTruthy()
      })
      expect(container.querySelector('.fp-plain'), suffix).toBeNull()
      view.unmount()
    }
  })

  it('markdown 能在「渲染」与「源码」之间切换（默认渲染）', async () => {
    const md = '# 标题一\n\n正文段落\n'
    readFileMock.mockResolvedValue({ kind: 'text', path: 'C:/proj/README.md', name: 'README.md', text: md })
    const { container } = render(<FilePreviewSheet path="C:/proj/README.md" sessionId={SESSION} onClose={() => {}} />)
    await waitFor(() => { expect(container.querySelector('.fp-md h1')).toBeTruthy() })

    const toggle = container.querySelector('[data-role="md-view-toggle"]') as HTMLButtonElement
    expect(toggle.textContent).toBe('源码')
    expect(toggle.getAttribute('data-view')).toBe('rendered')

    // 切到源码：原文里能看到 `#` 标记，渲染块消失。
    fireEvent.click(toggle)
    await waitFor(() => { expect(container.querySelector('.fp-md')).toBeNull() })
    expect(container.querySelector('.fp-plain')?.textContent).toContain('# 标题一')
    expect(toggle.textContent).toBe('预览')
    expect(toggle.getAttribute('data-view')).toBe('source')

    // 再切回渲染。
    fireEvent.click(toggle)
    await waitFor(() => { expect(container.querySelector('.fp-md h1')?.textContent).toBe('标题一') })
    expect(toggle.textContent).toBe('源码')
  })

  it('只有 markdown 才有视图切换按钮（代码/日志不受影响）', async () => {
    readFileMock.mockResolvedValue({ kind: 'text', path: 'C:/proj/demo.ts', name: 'demo.ts', text: 'const a = 1\n' })
    const { container } = render(<FilePreviewSheet path="C:/proj/demo.ts" sessionId={SESSION} onClose={() => {}} />)
    await waitFor(() => { expect(container.querySelector('.fp-copy')).toBeTruthy() })
    expect(container.querySelector('[data-role="md-view-toggle"]')).toBeNull()
  })

  it('renders an HTML document in a sandboxed iframe (scripts inert)', async () => {
    const html = '<!doctype html><title>示例</title><body><h1>页面标题</h1><script>window.pwned = 1</script></body>'
    readFileMock.mockResolvedValue({ kind: 'text', path: 'C:/proj/page.html', name: 'page.html', text: html })
    const { container } = render(<FilePreviewSheet path="C:/proj/page.html" sessionId={SESSION} onClose={() => {}} />)
    await screen.findByTitle('page.html')
    const frame = container.querySelector('.fp-html') as HTMLIFrameElement | null
    expect(frame).toBeTruthy()
    // No active content: sandbox has no allow-scripts / allow-same-origin.
    expect(frame?.getAttribute('sandbox')).toBe('')
    expect(frame?.srcdoc).toContain('页面标题')
    expect(container.querySelector('.fp-plain')).toBeNull()
  })

  it('closes via the sheet backdrop (onClose fires)', () => {
    readFileMock.mockResolvedValue({ kind: 'text', path: 'C:/proj/a.txt', name: 'a.txt', text: 'x' })
    const onClose = vi.fn()
    render(<FilePreviewSheet path="C:/proj/a.txt" sessionId={SESSION} onClose={onClose} />)
    const backdrop = document.querySelector('.sheet-backdrop')
    expect(backdrop).toBeTruthy()
    if (backdrop !== null) fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalled()
  })

  it('shows an image data URL for an image file path', async () => {
    readFileMock.mockResolvedValue({
      kind: 'image', path: 'C:/proj/shot.png', name: 'shot.png', dataUrl: 'data:image/png;base64,QUFB',
    })
    const { container } = render(<FilePreviewSheet path="C:/proj/shot.png" sessionId={SESSION} onClose={() => {}} />)
    await screen.findByTitle('C:/proj/shot.png')
    const img = container.querySelector('.fp-image') as HTMLImageElement | null
    expect(img).toBeTruthy()
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,QUFB')
    // No copy button / plain-text body for images.
    expect(container.querySelector('.fp-plain')).toBeNull()
    expect(screen.queryByRole('button', { name: '复制原文' })).toBeNull()
  })

  it('folds a long plain file behind 展开全部 and expands on tap', async () => {
    const long = Array.from({ length: 80 }, (_, i) => `line-${i}`).join('\n')
    readFileMock.mockResolvedValue({ kind: 'text', path: 'C:/proj/big.log', name: 'big.log', text: long })
    const { container } = render(<FilePreviewSheet path="C:/proj/big.log" sessionId={SESSION} onClose={() => {}} />)
    // The whole file is one pre text node, so match the folded body's text.
    await waitFor(() => {
      expect(container.querySelector('.fp-plain')?.textContent).toContain('line-79')
    })
    // Folded: the body is clamped and an expand toggle lists the line count.
    expect(container.querySelector('.fp-scroll-folded')).toBeTruthy()
    const expand = await screen.findByRole('button', { name: /展开全部（共 80 行）/ })
    fireEvent.click(expand)
    // Expanded: the clamp class goes away and the toggle flips to 收起.
    expect(container.querySelector('.fp-scroll-folded')).toBeNull()
    expect(screen.getByRole('button', { name: '收起' })).toBeTruthy()
  })

  it('does not fold a short file (no toggle, no clamp)', async () => {
    readFileMock.mockResolvedValue({ kind: 'text', path: 'C:/proj/small.txt', name: 'small.txt', text: 'one line\n' })
    const { container } = render(<FilePreviewSheet path="C:/proj/small.txt" sessionId={SESSION} onClose={() => {}} />)
    await screen.findByText('one line', { selector: '.fp-plain' })
    expect(container.querySelector('.fp-scroll-folded')).toBeNull()
    expect(screen.queryByRole('button', { name: /展开全部/ })).toBeNull()
  })
})
