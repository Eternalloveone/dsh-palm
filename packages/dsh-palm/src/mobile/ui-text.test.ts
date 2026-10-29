// @vitest-environment jsdom
/** ui-text: path compression, preview summaries, timestamp de-dup. */
import { describe, expect, it } from 'vitest'
import { commonPathPrefix, compactPath, dominantPathPrefix, formatRunDuration, previewSummary, timeVisibility } from './ui-text.ts'

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

  it('keeps the tail of a long remainder, not the head', () => {
    // 尾部才是"哪个项目"的答案；保留头部会把真实目录名挤掉（实测两条同名
    // 工作区的副标题因此完全相同）。
    const full = 'D:\\demo\\demo\\packages\\pkg\\pkg_20260729_01_build_Short_Debug - 副本'
    const out = compactPath(full, 'D:/demo')
    expect(out.startsWith('…\\')).toBe(true)
    expect(out.endsWith('副本')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(28)
  })

  it('keeps the last two directories when the workspace is nested deep', () => {
    const out = compactPath('E:\\work\\chip\\proj-a\\panel-oled', 'E:/work/chip')
    expect(out.replace('…', '').split(/[\\\\/]/).join('/')).toBe('proj-a/panel-oled')
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

  it('strips the markdown a list row cannot render', () => {
    // 实测：列表里出现 "## 结论"、"## 🎉 两件都完成了"、"- 修好了"，看着像没加工的日志。
    expect(previewSummary('## 结论')).toBe('结论')
    expect(previewSummary('### v1.6.2 已发布')).toBe('v1.6.2 已发布')
    expect(previewSummary('- 只读挂载修好了')).toBe('只读挂载修好了')
    expect(previewSummary('1. 先看尾巴')).toBe('先看尾巴')
    expect(previewSummary('> 引用一句话')).toBe('引用一句话')
    expect(previewSummary('**加粗**和`代码`')).toBe('加粗和代码')
    expect(previewSummary('见[文档](https://example.com/a)')).toBe('见文档')
    expect(previewSummary('![截图](x.png)').startsWith('[图片]')).toBe(true)
  })

  it('skips marker-only lines and takes the first real sentence', () => {
    expect(previewSummary('## 结论\n\n第一句话才是内容')).toBe('结论')
    expect(previewSummary('---\n真正的第一句')).toBe('真正的第一句')
    expect(previewSummary('| 列 | 列 |\n正文在这里')).toBe('正文在这里')
  })

  it('uses the first line only', () => {
    expect(previewSummary('第一行\n第二行')).toBe('第一行')
  })
})

describe('timeVisibility', () => {
  const minute = 60_000
  const base = 1_700_000_000_000

  it('每条消息都带时刻：一分钟内连发也不再省略', () => {
    const times = [base, base + 1000, base + 2000, base + minute, base + minute + 500]
    expect(timeVisibility(times)).toEqual([true, true, true, true, true])
  })

  it('always shows the final row', () => {
    expect(timeVisibility([base])).toEqual([true])
  })
})

describe('formatRunDuration (turn clock)', () => {
  it('renders whole seconds under a minute', () => {
    expect(formatRunDuration(0)).toBe('0秒')
    expect(formatRunDuration(45_000)).toBe('45秒')
    expect(formatRunDuration(45_999)).toBe('45秒') // floor, not round
  })

  it('renders minutes with zero-padded seconds', () => {
    expect(formatRunDuration(95_000)).toBe('1分35秒')
    expect(formatRunDuration(120_000)).toBe('2分00秒')
    expect(formatRunDuration(3_725_000)).toBe('62分05秒')
  })

  it('clamps negative durations to zero', () => {
    expect(formatRunDuration(-5_000)).toBe('0秒')
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
