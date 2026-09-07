import { describe, expect, it } from 'vitest'
import { detectReport, parseReportLines } from './report.ts'

describe('detectReport', () => {
  it('flags two or more status lines', () => {
    expect(detectReport('- 脚本重启：✓ 通过\n- 宿主 3080：✓ 正常')).toBe(true)
    expect(detectReport('构建 pipeline → ✓ 通过\n- 校验回归 → ✗ 失败')).toBe(true)
  })

  it('flags one status line plus a section heading', () => {
    expect(detectReport('### 验证结果\n- 脚本重启：✓ 通过')).toBe(true)
  })

  it('flags one status line plus a commit fragment', () => {
    expect(detectReport('- 宿主 3080：✓ 正常\ncommit a3f9c21')).toBe(true)
    expect(detectReport('- 宿主 3080：✓ 正常\n`a3f9c21`')).toBe(true)
  })

  it('keeps ordinary chat on the plain path (no false positives)', () => {
    expect(detectReport('好的，我已经确认没问题了。')).toBe(false)
    // A ✓ deep inside a prose sentence is not a structured status line.
    expect(detectReport('这个结果看起来 ✓ 不错，明天继续。')).toBe(false)
    // Statuses only count on structured lines.
    expect(detectReport('我检查了 a ✓ b，然后做了 c。\n大概就是这样。')).toBe(false)
  })

  it('ignores pending/empty text at the caller level (empty → false)', () => {
    expect(detectReport('')).toBe(false)
  })
})

describe('parseReportLines', () => {
  it('splits status, heading, commit and text lines in order', () => {
    const segments = parseReportLines([
      '### 验证结果',
      '- 脚本重启：✓ 通过',
      '构建 pipeline → ✗ 失败（超时）',
      '提交为 `a3f9c21` 的改动保留。',
      'commit a3f9c21',
    ].join('\n'))
    expect(segments[0]).toEqual({ type: 'heading', level: 3, text: '验证结果' })
    expect(segments[1]).toEqual({ type: 'status', label: '脚本重启', status: 'ok', note: '通过' })
    expect(segments[2]).toEqual({ type: 'status', label: '构建 pipeline', status: 'fail', note: '失败（超时）' })
    expect(segments[3]).toEqual({ type: 'text', text: '提交为 `a3f9c21` 的改动保留。' })
    expect(segments[4]).toEqual({ type: 'commit', hash: 'a3f9c21' })
  })

  it('keeps empty and non-matching lines as plain text', () => {
    const segments = parseReportLines('普通一行\n\n- 宿主：● 运行中')
    expect(segments[0]).toEqual({ type: 'text', text: '普通一行' })
    expect(segments[1]).toEqual({ type: 'text', text: '' })
    expect(segments[2]).toEqual({ type: 'status', label: '宿主', status: 'run', note: '运行中' })
  })

  it('handles long descriptors with parenthesised commands (real agent output)', () => {
    const text = [
      '• Typecheck (`tsc -b --pretty false`): ✓ 通过',
      '• 单元测试 (`vitest run`，74 文件 / 918 用例): ✓ 通过',
      '• 构建 (`tsc -b && tsdown`，main/client/mobile 三入口): ✓ 通过',
      '• 工作树状态: ✓ 干净（仅 running-probe.mjs 未跟踪）',
    ].join('\n')
    expect(detectReport(text)).toBe(true)
    const segments = parseReportLines(text)
    expect(segments.every(segment => segment.type === 'status')).toBe(true)
    expect(segments).toHaveLength(4)
    expect(segments[0]).toMatchObject({ label: 'Typecheck (`tsc -b --pretty false`)', status: 'ok' })
  })

  it('consumes a two-line "commit" + hash as one commit chip', () => {
    const hash = '0123456789abcdef0123456789abcdef01234567'
    const segments = parseReportLines([
      '验证于 main 分支。',
      'commit',
      hash,
    ].join('\n'))
    expect(segments).toContainEqual({ type: 'commit', hash })
    expect(segments.some(segment => segment.type === 'text' && segment.text === 'commit')).toBe(false)
  })

  it('does not treat a bare mid-sentence hash as a commit', () => {
    expect(detectReport('构建产物摘要 3f2ab91cc7 正常')).toBe(false)
    expect(parseReportLines('构建产物摘要 3f2ab91cc7 正常')[0]).toEqual({ type: 'text', text: '构建产物摘要 3f2ab91cc7 正常' })
  })
})
