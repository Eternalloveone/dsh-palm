// @vitest-environment jsdom
/**
 * CodeBlock component tests: chrome (language label, action buttons),
 * copy feedback (check + 已复制 for 1.5s), folding for long blocks, and
 * the run button for bash/python. The Shiki loader is mocked — the CDN
 * import never runs under vitest.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CodeBlock, FOLD_THRESHOLD } from './code-block.tsx'

vi.mock('./shiki.ts', () => ({
  languageInfo: (lang: string) => {
    const map: Record<string, { label: string; shiki: string | null; runnable: boolean; ext: string }> = {
      ts: { label: 'TypeScript', shiki: 'typescript', runnable: false, ext: 'ts' },
      python: { label: 'Python', shiki: 'python', runnable: true, ext: 'py' },
      bash: { label: 'Bash', shiki: 'bash', runnable: true, ext: 'sh' },
    }
    return map[lang] ?? { label: lang, shiki: null, runnable: false, ext: 'txt' }
  },
  highlightCode: vi.fn(async () => '<pre class="shiki" tabindex="0"><code><span class="line">const a = 1</span></code></pre>'),
  highlightCodeSync: vi.fn(() => '<pre class="shiki" tabindex="0"><code><span class="line">const a = 1</span></code></pre>'),
}))

vi.mock('./toast.tsx', () => ({ toast: vi.fn() }))
vi.mock('./code-actions.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('./code-actions.ts')>()
  return {
    ...actual,
    copyText: vi.fn(async () => true),
    insertCode: vi.fn(),
    openCodeInTab: vi.fn(),
    runCode: vi.fn(async () => null),
  }
})

import { toast } from './toast.tsx'
import { copyText, insertCode, openCodeInTab, runCode } from './code-actions.ts'

const copyTextMock = vi.mocked(copyText)
const insertCodeMock = vi.mocked(insertCode)
const openCodeInTabMock = vi.mocked(openCodeInTab)
const runCodeMock = vi.mocked(runCode)
const toastMock = vi.mocked(toast)

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('CodeBlock', () => {
  it('renders the language label and the action buttons', () => {
    render(<CodeBlock lang="ts" code="const a = 1" />)
    expect(screen.getByText('TypeScript')).toBeTruthy()
    expect(screen.getByRole('button', { name: '复制代码' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '插入到编辑器' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '新标签页打开' })).toBeTruthy()
    // ts is not runnable: no run button.
    expect(screen.queryByRole('button', { name: '运行代码' })).toBeNull()
  })

  it('shows the run button for bash and python blocks', () => {
    const { unmount } = render(<CodeBlock lang="bash" code="echo hi" />)
    expect(screen.getByRole('button', { name: '运行代码' })).toBeTruthy()
    unmount()
    render(<CodeBlock lang="python" code="print(1)" />)
    expect(screen.getByRole('button', { name: '运行代码' })).toBeTruthy()
  })

  it('copies with a check + 已复制 for 1.5s, then restores', async () => {
    render(<CodeBlock lang="ts" code="const a = 1" />)
    const copy = screen.getByRole('button', { name: '复制代码' })
    await act(async () => { fireEvent.click(copy) })
    expect(copyTextMock).toHaveBeenCalledWith('const a = 1', '已复制到剪贴板')
    expect(screen.getByText('已复制')).toBeTruthy()
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(screen.queryByText('已复制')).toBeNull()
  })

  it('inserts into the editor and opens in a new tab', () => {
    render(<CodeBlock lang="ts" code="const a = 1" />)
    fireEvent.click(screen.getByRole('button', { name: '插入到编辑器' }))
    expect(insertCodeMock).toHaveBeenCalledWith('const a = 1')
    fireEvent.click(screen.getByRole('button', { name: '新标签页打开' }))
    expect(openCodeInTabMock).toHaveBeenCalledWith('const a = 1', 'ts')
  })

  it('folds long blocks and expands on demand', () => {
    const code = Array.from({ length: FOLD_THRESHOLD + 1 }, (_, i) => `line ${i}`).join('\n')
    render(<CodeBlock lang="ts" code={code} />)
    const expand = screen.getByRole('button', { name: '展开全部' })
    expect(expand).toBeTruthy()
    fireEvent.click(expand)
    expect(screen.getByRole('button', { name: '收起' })).toBeTruthy()
  })

  it('does not fold short blocks', () => {
    render(<CodeBlock lang="ts" code="a\nb" />)
    expect(screen.queryByRole('button', { name: '展开全部' })).toBeNull()
  })

  it('toasts when no sandbox runner is available', async () => {
    render(<CodeBlock lang="bash" code="echo hi" />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '运行代码' })) })
    expect(runCodeMock).toHaveBeenCalledWith('echo hi', 'bash')
    expect(toastMock).toHaveBeenCalledWith('当前环境不支持代码执行')
  })
})
