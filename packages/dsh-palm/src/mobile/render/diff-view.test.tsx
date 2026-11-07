// @vitest-environment jsdom
/**
 * DiffView component tests: the three-column render, the accept / reject
 * collapse states, and the line-level review flow (+ / − per line, the
 * tally footer, and confirm).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DiffView } from './diff-view.tsx'

vi.mock('./code-actions.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('./code-actions.ts')>()
  return { ...actual, copyText: vi.fn(async () => true) }
})

import { copyText } from './code-actions.ts'

const copyTextMock = vi.mocked(copyText)

const SAMPLE = [
  '--- a/src/main.ts',
  '+++ b/src/main.ts',
  '@@ -1,3 +1,3 @@',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  ' const c = 4',
].join('\n')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DiffView', () => {
  it('renders the label, filename and three-column rows', () => {
    render(<DiffView text={SAMPLE} />)
    expect(screen.getByText('变更对比')).toBeTruthy()
    expect(screen.getByText('src/main.ts')).toBeTruthy()
    expect(screen.getByText('const a = 1')).toBeTruthy()
    // Word-marked lines split their text across spans; compare textContent.
    const delText = document.querySelector('.diff-row.diff-del .diff-text')
    expect(delText?.textContent).toBe('const b = 2')
    const addText = document.querySelector('.diff-row.diff-add .diff-text')
    expect(addText?.textContent).toBe('const b = 3')
    // Old/new line numbers render in their columns.
    expect(screen.getByText('2', { selector: '.diff-oldno' })).toBeTruthy()
    expect(screen.getByText('2', { selector: '.diff-newno' })).toBeTruthy()
  })

  it('collapses to 已应用 on accept and 已拒绝 on reject, with 撤销', () => {
    const { unmount } = render(<DiffView text={SAMPLE} />)
    fireEvent.click(screen.getByRole('button', { name: '接受' }))
    expect(screen.getByText('已应用')).toBeTruthy()
    expect(screen.getByRole('button', { name: '撤销' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByRole('button', { name: '接受' })).toBeTruthy()
    unmount()
    render(<DiffView text={SAMPLE} />)
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }))
    expect(screen.getByText('已拒绝')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重新生成' })).toBeTruthy()
  })

  it('keeps the decided diff visible in context, softly dimmed', () => {
    render(<DiffView text={SAMPLE} />)
    fireEvent.click(screen.getByRole('button', { name: '接受' }))
    // The three-column body stays on screen (resolved state)…
    expect(screen.getByText('const a = 1')).toBeTruthy()
    const dimmed = document.querySelector('.diff-block .diff-dimmed')
    expect(dimmed).not.toBeNull()
    // …wrapped in the dimming container with the rows still queryable.
    expect(dimmed?.querySelector('.diff-row.diff-add')).not.toBeNull()
    // Undo restores the interactive view (no dimming wrapper).
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(document.querySelector('.diff-block .diff-dimmed')).toBeNull()
  })

  it('reviews line by line: + accepts adds, − rejects dels, confirm applies', () => {
    render(<DiffView text={SAMPLE} />)
    fireEvent.click(screen.getByRole('button', { name: '逐行审阅' }))
    // Tally starts at zero decisions.
    expect(screen.getByText(/接受 0 行 \/ 拒绝 0 行 \/ 剩余 2 行/)).toBeTruthy()
    const acceptLine = screen.getByRole('button', { name: '接受该行' })
    const rejectLine = screen.getByRole('button', { name: '拒绝该行' })
    fireEvent.click(acceptLine)
    fireEvent.click(rejectLine)
    expect(screen.getByText(/接受 1 行 \/ 拒绝 1 行 \/ 剩余 0 行/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(screen.getByText('已应用')).toBeTruthy()
    expect(screen.getByText(/接受 1 行 \/ 拒绝 1 行/)).toBeTruthy()
    // The result keeps the context, the accepted add and the kept deletion.
    fireEvent.click(screen.getByRole('button', { name: '复制结果' }))
    expect(copyTextMock).toHaveBeenCalledWith(
      'const a = 1\nconst b = 2\nconst b = 3\nconst c = 4',
      '已复制结果代码',
    )
  })

  it('keeps context lines inert in review mode', () => {
    render(<DiffView text={SAMPLE} />)
    fireEvent.click(screen.getByRole('button', { name: '逐行审阅' }))
    // Only the add and del lines carry action buttons.
    expect(screen.getAllByRole('button', { name: '接受该行' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '拒绝该行' })).toHaveLength(1)
  })

  it('cancels review mode without applying anything', () => {
    render(<DiffView text={SAMPLE} />)
    fireEvent.click(screen.getByRole('button', { name: '逐行审阅' }))
    fireEvent.click(screen.getByRole('button', { name: '接受该行' }))
    // Cancel leaves review without applying: the head actions return and no
    // applied state appears.
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByRole('button', { name: '接受' })).toBeTruthy()
    expect(screen.queryByText('已应用')).toBeNull()
    // Re-entering review starts from a clean slate.
    fireEvent.click(screen.getByRole('button', { name: '逐行审阅' }))
    expect(screen.getByText(/接受 0 行 \/ 拒绝 0 行 \/ 剩余 2 行/)).toBeTruthy()
  })
})
