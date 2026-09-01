// @vitest-environment jsdom
/** ui-text: path compression, preview summaries, timestamp de-dup. */
import { describe, expect, it } from 'vitest'
import { commonPathPrefix, compactPath, dominantPathPrefix, previewSummary, timeVisibility } from './ui-text.ts'

describe('commonPathPrefix', () => {
  it('finds the longest shared segment prefix (Windows backslashes)', () => {
    expect(commonPathPrefix(['D:\\demo\\a', 'D:\\demo\\b\\c'])).toBe('D:/demo')
  })

  it('needs at least two paths and two shared segments', () => {
    expect(commonPathPrefix(['D:\\demo\\a'])).toBe('')
    expect(commonPathPrefix(['D:\\demo', 'D:\\other'])).toBe('D:')
  })

  it('returns empty when nothing is shared', () => {
    expect(commonPathPrefix(['C:\\x', 'D:\\y'])).toBe('')
  })
})

describe('compactPath', () => {
  it('hides the common prefix with an ellipsis', () => {
    expect(compactPath('D:\\demo\\dsh-palm', 'D:/demo')).toBe('…dsh-palm')
    expect(compactPath('D:\\demo\\demo\\app', 'D:/demo')).toBe('…demo\\app')
  })

  it('keeps short paths untouched when no prefix is shared', () => {
    expect(compactPath('D:\\demo\\x', '')).toBe('D:\\demo\\x')
  })

  it('middle-truncates long remainders to first…last', () => {
    const full = 'D:\\demo\\demo\\packages\\pkg\\pkg_20260729_01_build_Short_Debug - 副本'
    const out = compactPath(full, 'D:/demo')
    expect(out.startsWith('…demo…')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(40)
  })
})

describe('previewSummary', () => {
  it('clamps plain text to 30 chars', () => {
    const long = '这是一条特别长的消息，超出三十个字符的部分应当被省略掉才行'.repeat(2)
    expect(previewSummary(long).length).toBeLessThanOrEqual(31)
    expect(previewSummary(long).endsWith('…')).toBe(true)
    expect(previewSummary('短消息')).toBe('短消息')
  })

  it('renders fenced code as a [代码] badge with the language', () => {
    expect(previewSummary('```ts\nconst a = 1\n```')).toBe('[代码] ts')
    expect(previewSummary('```\nplain fence\n```')).toBe('[代码]')
  })

  it('uses the first line only', () => {
    expect(previewSummary('第一行\n第二行')).toBe('第一行')
  })
})

describe('timeVisibility', () => {
  const minute = 60_000
  const base = 1_700_000_000_000

  it('shows only the last row of each minute bucket', () => {
    const times = [base, base + 1000, base + 2000, base + minute, base + minute + 500]
    expect(timeVisibility(times)).toEqual([false, false, true, false, true])
  })

  it('always shows the final row', () => {
    expect(timeVisibility([base])).toEqual([true])
  })
})

describe('dominantPathPrefix', () => {
  it('returns the majority prefix even with off-drive stragglers', () => {
    const paths = [
      'D:\\demo\\dsh-palm',
      'D:\\demo\\demo\\app',
      'D:\\demo\\demo\\lib',
      'C:\\Users\\alice\\.dsh\\workspace',
    ]
    expect(dominantPathPrefix(paths)).toBe('D:/demo')
  })

  it('needs at least two matching paths', () => {
    expect(dominantPathPrefix(['D:\\demo\\a', 'C:\\other\\b'])).toBe('')
  })

  it('keeps commonPathPrefix semantics for uniform lists', () => {
    expect(commonPathPrefix(['D:\\demo\\a', 'D:\\demo\\b'])).toBe('D:/demo')
  })
})
