// @vitest-environment jsdom
/**
 * C1 工具详情面板（2026-11-10）。
 *
 * 桌面端点一次工具行能看到「参数 / 输出 / 耗时 / 改了哪些文件」，手机端以前点开只有
 * 一段原始参数。这里钉住：状态与耗时、参数、输出、改动文件与真 hunk、点文件开预览。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ToolDetailSheet, durationTextOf } from './tool-detail-sheet.tsx'
import type { ToolCallInfo } from '../render/messages.ts'

vi.mock('./file-preview-sheet.tsx', () => ({
  FilePreviewSheet: ({ path }: { path: string }) => <div data-testid="preview">{path}</div>,
}))

const tool = (overrides: Partial<ToolCallInfo> = {}): ToolCallInfo => ({
  callId: 'c1',
  name: 'bash',
  state: 'ok',
  arguments: '{"cmd":"pytest -q"}',
  startedAt: 1_000,
  endedAt: 3_400,
  output: 'collected 12 items\n12 passed in 0.41s',
  ...overrides,
})

describe('durationTextOf', () => {
  it('毫秒 / 秒 / 分三档都说人话', () => {
    expect(durationTextOf(0, 850)).toBe('850 毫秒')
    expect(durationTextOf(0, 2400)).toBe('2.4 秒')
    expect(durationTextOf(0, 63_000)).toBe('1 分 03 秒')
  })

  it('缺一头就报不出耗时（不给假数据）', () => {
    expect(durationTextOf(undefined, 10)).toBeUndefined()
    expect(durationTextOf(10, undefined)).toBeUndefined()
  })
})

describe('ToolDetailSheet', () => {
  beforeEach(() => { cleanup() })
  afterEach(() => { cleanup() })

  it('状态 + 耗时 + 参数 + 输出都在', () => {
    render(<ToolDetailSheet tool={tool()} sessionId="s1" onClose={() => {}} />)
    expect(screen.getByText(/完成 · 耗时 2\.4 秒/)).toBeTruthy()
    // 参数是格式化后的 JSON（缩进两格），不是原样一坨。
    expect(screen.getByLabelText('参数').textContent).toContain('"cmd": "pytest -q"')
    expect(screen.getByLabelText('输出').textContent).toContain('12 passed')
    // 标题说清楚是哪一次调用（工具 · 摘要）。
    expect(screen.getAllByText(/pytest/).length).toBeGreaterThan(0)
  })

  it('改了文件：路径行 + 真 hunk，点路径开预览', () => {
    render(<ToolDetailSheet
      tool={tool({
        view: {
          card: 'diff',
          title: 'Edit a.ts',
          diffs: [{ path: 'src/a.ts', oldText: 'const a = 1\n', newText: 'const a = 2\n' }],
        },
      })}
      sessionId="s1"
      onClose={() => {}}
    />)
    const pathRow = screen.getByRole('button', { name: '预览文件：src/a.ts' })
    // 真 hunk：旧行在 −、新行在 +，不是"整份文件全红 + 全绿"。
    expect(screen.getByText('const a = 1')).toBeTruthy()
    expect(screen.getByText('const a = 2')).toBeTruthy()
    fireEvent.click(pathRow)
    expect(screen.getByTestId('preview').textContent).toBe('src/a.ts')
  })

  it('没有会话 id 时路径行不可点（老调用点）', () => {
    render(<ToolDetailSheet
      tool={tool({ metaPaths: ['src/b.ts'] })}
      onClose={() => {}}
    />)
    const row = screen.getByRole('button', { name: '预览文件：src/b.ts' })
    expect(row.getAttribute('aria-disabled')).toBeNull()
    // 没有 sessionId 就不挂 onClick：点了不会出现预览。
    fireEvent.click(row)
    expect(screen.queryByTestId('preview')).toBeNull()
  })

  it('运行中：只有状态，没有输出也不假装有时长', () => {
    render(<ToolDetailSheet
      tool={{ callId: 'c2', name: 'bash', state: 'running', arguments: '{"cmd":"sleep 1"}', startedAt: 5 }}
      onClose={() => {}}
    />)
    expect(screen.getByText('运行中')).toBeTruthy()
    expect(screen.queryByLabelText('输出')).toBeNull()
    expect(screen.queryByText(/耗时/)).toBeNull()
  })
})
