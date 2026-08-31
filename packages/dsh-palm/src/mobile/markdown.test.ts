/**
 * Mobile markdown renderer tests: GFM subset coverage plus the security
 * contract — raw HTML escapes, dangerous link/image protocols are
 * stripped, code fences never parse their content, and file-path tokens
 * link to the host file opener.
 */
import { describe, expect, it } from 'vitest'
import { escapeHtml, parseMarkdown, parseSegments, parseStreamPrefix, renderInline, renderMarkdown, safeUrl } from './markdown.ts'

describe('safeUrl', () => {
  it('allows http/https/mailto/fragments and scheme-less targets', () => {
    expect(safeUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(safeUrl('http://example.com')).toBe('http://example.com')
    expect(safeUrl('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(safeUrl('#top')).toBe('#top')
    expect(safeUrl('./rel/path')).toBe('./rel/path')
  })

  it('rejects javascript:/data:/vbscript: and blanks', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull()
    expect(safeUrl('data:text/html,x')).toBeNull()
    expect(safeUrl('vbscript:x')).toBeNull()
    expect(safeUrl('')).toBeNull()
    expect(safeUrl('   ')).toBeNull()
  })

  it('rejects protocol-relative targets that escape the origin', () => {
    expect(safeUrl('//attacker.example/x')).toBeNull()
    expect(safeUrl('  //attacker.example/track.png')).toBeNull()
  })
})

describe('renderInline', () => {
  it('renders code, bold, italic, strikethrough and links', () => {
    expect(renderInline('`a<b`')).toBe('<code>a&lt;b</code>')
    expect(renderInline('**b**')).toBe('<strong>b</strong>')
    expect(renderInline('*i*')).toBe('<em>i</em>')
    expect(renderInline('~~d~~')).toBe('<del>d</del>')
    expect(renderInline('[x](https://e.com)')).toBe('<a href="https://e.com" target="_blank" rel="noopener noreferrer">x</a>')
  })

  it('strips unsafe link targets and renders the label as plain text', () => {
    expect(renderInline('[x](javascript:alert(1))')).toBe('x')
    expect(renderInline('![a](data:text/html,x)')).toBe('a')
  })

  it('escapes raw HTML instead of passing it through', () => {
    expect(renderInline('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})

describe('renderMarkdown', () => {
  it('renders headings, hr, paragraphs', () => {
    const html = renderMarkdown('# T\n\npara\n\n---')
    expect(html).toContain('<h1>T</h1>')
    expect(html).toContain('<p>para</p>')
    expect(html).toContain('<hr />')
  })

  it('renders fenced code without parsing its content, with full chrome', () => {
    const html = renderMarkdown('```ts\nconst a = **bold** <x>\n```')
    expect(html).toContain('<div class="code-block" data-lang="ts">')
    expect(html).toContain('<span class="code-lang">ts</span>')
    expect(html).toContain('<button type="button" class="code-btn code-copy" aria-label="复制代码">')
    expect(html).toContain('class="code-btn code-insert"')
    expect(html).toContain('class="code-btn code-open"')
    expect(html).toContain('<span class="code-line">const a = **bold** &lt;x&gt;</span>')
    // The fence content never runs through the inline pass.
    expect(html).not.toContain('<strong>')
  })

  it('renders ```diff fences as diff blocks', () => {
    const html = renderMarkdown('```diff\n- const a = 1\n+ const a = 2\n```')
    expect(html).toContain('<div class="diff-block" data-lang="diff">')
    expect(html).toContain('<span class="diff-label">变更对比</span>')
    expect(html).toContain('<span class="code-line">- const a = 1</span>')
  })

  it('recognizes diff fences case-insensitively', () => {
    const segments = parseSegments('```Diff\n- a\n+ b\n```')
    expect(segments[0]?.kind).toBe('diff')
    const upper = parseSegments('```DIFF\n- a\n+ b\n```')
    expect(upper[0]?.kind).toBe('diff')
  })

  it('links file-path tokens to the host file opener', () => {
    expect(renderInline('见 src/main.ts 文件')).toBe('见 <a class="file-link" data-path="src/main.ts">src/main.ts</a> 文件')
    expect(renderInline('改 D:\\work\\a.ts 即可')).toBe('改 <a class="file-link" data-path="D:\\work\\a.ts">D:\\work\\a.ts</a> 即可')
    expect(renderInline('在 ./lib/x.ts 里')).toContain('data-path="./lib/x.ts"')
  })

  it('does not link dates, bare filenames or bare URLs as file paths', () => {
    expect(renderInline('2024/01/15 发布')).not.toContain('file-link')
    expect(renderInline('file.ts 文件')).not.toContain('file-link')
    expect(renderInline('见 https://example.com/x.ts')).not.toContain('file-link')
  })

  it('splits segments at code and diff fences, preserving order', () => {
    const segments = parseSegments('前文\n\n```ts\nconst a = 1\n```\n\n中段\n\n```diff\n- a\n+ b\n```\n\n后文')
    expect(segments.map(segment => segment.kind)).toEqual(['html', 'code', 'html', 'diff', 'html'])
    const code = segments[1]
    expect(code).toMatchObject({ kind: 'code', lang: 'ts', code: 'const a = 1' })
    const diff = segments[3]
    expect(diff).toMatchObject({ kind: 'diff', text: '- a\n+ b' })
    const first = segments[0]
    if (first?.kind === 'html') expect(first.html).toContain('<p>前文</p>')
  })

  it('renders lists, blockquotes and tables', () => {
    const html = renderMarkdown('- a\n- b\n\n1. x\n2. y\n\n> quote\n\n| h1 | h2 |\n| --- | --- |\n| c1 | c2 |')
    expect(html).toContain('<ul><li>a</li><li>b</li></ul>')
    expect(html).toContain('<ol><li>x</li><li>y</li></ol>')
    expect(html).toContain('<blockquote><p>quote</p></blockquote>')
    expect(html).toContain('<thead><tr><th>h1</th><th>h2</th></tr></thead>')
    expect(html).toContain('<td>c1</td><td>c2</td>')
  })

  it('normalizes CRLF and keeps user-visible text intact', () => {
    // Hard line breaks render as <br /> (the streaming preview uses the
    // same form, so a turn closing never collapses a multi-line paragraph).
    expect(renderMarkdown('a\r\nb')).toBe('<p>a<br />b</p>')
  })
})

describe('escapeHtml', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml('<&>"\'')).toBe('&lt;&amp;&gt;&quot;&#39;')
  })

  it('equals the five sequential passes on mixed, pre-escaped and plain input', () => {
    // Single-pass map replacement must never diverge from the sequential
    // five-pass escape (including double-escaping of literal entities).
    expect(escapeHtml('a & b < c > d " e \' f')).toBe('a &amp; b &lt; c &gt; d &quot; e &#39; f')
    expect(escapeHtml('&amp; &lt; &gt;')).toBe('&amp;amp; &amp;lt; &amp;gt;')
    expect(escapeHtml('plain text 123')).toBe('plain text 123')
    expect(escapeHtml('')).toBe('')
  })
})

describe('in-body thinking tags', () => {
  it('extracts a single-line `<think>…</think>` into a think block', () => {
    const blocks = parseMarkdown('<think>先想一步</think>结论')
    expect(blocks.map(block => block.type)).toEqual(['think', 'paragraph'])
    expect(blocks[0]).toMatchObject({ type: 'think', text: '先想一步' })
    if (blocks[1]?.type === 'paragraph') expect(blocks[1].html).toBe('结论')
  })

  it('extracts a multi-line think block across blank lines, preserving paragraphs around it', () => {
    const blocks = parseMarkdown('前文\n\n<think>第一行\n\n第二行</think>\n\n后文')
    expect(blocks.map(block => block.type)).toEqual(['paragraph', 'think', 'paragraph'])
    expect(blocks[1]).toMatchObject({ type: 'think', text: '第一行\n\n第二行' })
    if (blocks[0]?.type === 'paragraph') expect(blocks[0].html).toBe('前文')
    if (blocks[2]?.type === 'paragraph') expect(blocks[2].html).toBe('后文')
  })

  it('matches case-insensitively and tolerates attributes', () => {
    const blocks = parseMarkdown('<THINK depth="3">abc</THINK>')
    expect(blocks.map(block => block.type)).toEqual(['think'])
    expect(blocks[0]).toMatchObject({ type: 'think', text: 'abc' })
  })

  it('keeps text before the tag and after the close in the surrounding paragraph', () => {
    const blocks = parseMarkdown('开头 <think>中间内容\n再想</think> 结尾')
    expect(blocks.map(block => block.type)).toEqual(['paragraph', 'think', 'paragraph'])
    expect(blocks[1]).toMatchObject({ type: 'think', text: '中间内容\n再想' })
    if (blocks[0]?.type === 'paragraph') expect(blocks[0].html).toBe('开头 ')
    if (blocks[2]?.type === 'paragraph') expect(blocks[2].html).toBe(' 结尾')
  })

  it('never extracts inside a fenced code block', () => {
    const blocks = parseMarkdown('```html\n<think>keep</think>\n```')
    expect(blocks.map(block => block.type)).toEqual(['code'])
    if (blocks[0]?.type === 'code') expect(blocks[0].code).toBe('<think>keep</think>')
  })

  it('degrades an unclosed tag to an ordinary (escaped) paragraph', () => {
    const source = '这是 <think 未闭合的标签\n第二行'
    expect(renderMarkdown(source)).toContain('&lt;think')
    expect(renderMarkdown(source)).not.toContain('think-block')
    expect(parseMarkdown(source).map(block => block.type)).toEqual(['paragraph'])
  })

  it('renders the static think block with the disclosure chrome', () => {
    const html = renderMarkdown('<think>a<b\n线2</think>')
    expect(html).toContain('<details class="chat-disclosure think-block">')
    expect(html).toContain('<summary class="chat-disclosure-head">')
    expect(html).toContain('<span class="chat-disclosure-label">思考过程</span>')
    expect(html).toContain('<span class="chat-disclosure-caret">')
    expect(html).toContain('a&lt;b\n线2')
    // Raw tags never leak into the output; content is escaped.
    expect(html).not.toContain('<think>')
    expect(html).not.toContain('</think>')
  })

  it('emits think segments between html runs, preserving order', () => {
    const segments = parseSegments('前文\n\n<think>链1\n链2</think>\n\n```ts\nconst a = 1\n```\n\n<think>尾</think>\n\n后文')
    expect(segments.map(segment => segment.kind)).toEqual(['html', 'think', 'code', 'think', 'html'])
    expect(segments[0]).toMatchObject({ kind: 'html' })
    expect(segments[1]).toMatchObject({ kind: 'think', text: '链1\n链2' })
    expect(segments[2]).toMatchObject({ kind: 'code', lang: 'ts' })
    expect(segments[3]).toMatchObject({ kind: 'think', text: '尾' })
    expect(segments[4]).toMatchObject({ kind: 'html' })
    if (segments[0]?.kind === 'html') expect(segments[0].html).toContain('<p>前文</p>')
  })
})

describe('parseStreamPrefix', () => {
  it('stabilizes closed paragraphs and reports an empty tail when complete', () => {
    // The trailing blank line closes the last paragraph (EOF alone does not).
    const result = parseStreamPrefix('第一段\n\n第二段\n\n', 0)
    expect(result.stableLen).toBe('第一段\n\n第二段\n\n'.length)
    expect(result.tail).toBe('')
    expect(result.blocks).toHaveLength(2)
    expect(result.blocks[0]).toEqual({ kind: 'html', html: '<p>第一段</p>' })
    expect(result.blocks[1]).toEqual({ kind: 'html', html: '<p>第二段</p>' })
  })

  it('keeps an open paragraph fully in the tail', () => {
    const result = parseStreamPrefix('还没结束的一段文字', 0)
    expect(result.blocks).toHaveLength(0)
    expect(result.stableLen).toBe(0)
    expect(result.tail).toBe('还没结束的一段文字')
  })

  it('stabilizes the prefix up to an open fence, tail starts at the fence', () => {
    const text = '前段\n\n```ts\nconst a = 1'
    const result = parseStreamPrefix(text, 0)
    expect(result.blocks).toEqual([{ kind: 'html', html: '<p>前段</p>' }])
    expect(result.stableLen).toBe('前段\n\n'.length)
    expect(result.tail).toBe('```ts\nconst a = 1')
  })

  it('stabilizes a closed fence as a code block', () => {
    const text = '前段\n\n```ts\nconst a = 1\n```\n\n后段\n\n'
    const result = parseStreamPrefix(text, 0)
    expect(result.blocks).toEqual([
      { kind: 'html', html: '<p>前段</p>' },
      { kind: 'code', lang: 'ts', code: 'const a = 1' },
      { kind: 'html', html: '<p>后段</p>' },
    ])
    expect(result.stableLen).toBe(text.length)
    expect(result.tail).toBe('')
  })

  it('stabilizes a closed diff fence as a diff block', () => {
    const result = parseStreamPrefix('```diff\n- a\n+ b\n```', 0)
    expect(result.blocks).toEqual([{ kind: 'diff', text: '- a\n+ b' }])
    expect(result.stableLen).toBe('```diff\n- a\n+ b\n```'.length)
  })

  it('treats an unclosed fence as an unstable tail', () => {
    const text = '```python\nprint(1)'
    const result = parseStreamPrefix(text, 0)
    expect(result.blocks).toHaveLength(0)
    expect(result.stableLen).toBe(0)
    expect(result.tail).toBe(text)
  })

  it('stabilizes a closed in-body think tag; the next paragraph stays open', () => {
    const open = String.fromCharCode(60, 116, 104, 105, 110, 107, 62)
    const close = String.fromCharCode(60, 47, 116, 104, 105, 110, 107, 62)
    const text = `前段\n\n${open}想了两步\n再想${close}\n\n结论`
    const result = parseStreamPrefix(text, 0)
    expect(result.blocks[0]).toEqual({ kind: 'html', html: '<p>前段</p>' })
    expect(result.blocks[1]).toEqual({ kind: 'think', text: '想了两步\n再想' })
    // The trailing paragraph at EOF is still open → stableLen stops before it.
    expect(result.blocks).toHaveLength(2)
    expect(result.stableLen).toBe(text.length - '结论'.length)
    expect(result.tail).toBe('结论')
  })

  it('keeps an open think tag in the tail', () => {
    const open = String.fromCharCode(60, 116, 104, 105, 110, 107, 62)
    const text = `前段\n\n${open}还在想`
    const result = parseStreamPrefix(text, 0)
    expect(result.blocks).toEqual([{ kind: 'html', html: '<p>前段</p>' }])
    expect(result.stableLen).toBe('前段\n\n'.length)
    expect(result.tail).toBe(`${open}还在想`)
  })

  it('increments across frames: only the newly-stable blocks come back', () => {
    const frame1 = '第一段\n\n```ts\nconst a = 1'
    const r1 = parseStreamPrefix(frame1, 0)
    expect(r1.blocks).toEqual([{ kind: 'html', html: '<p>第一段</p>' }])
    expect(r1.stableLen).toBe('第一段\n\n'.length)

    const frame2 = frame1 + '\n```\n\n第二段\n\n'
    const r2 = parseStreamPrefix(frame2, r1.stableLen)
    expect(r2.blocks).toEqual([
      { kind: 'code', lang: 'ts', code: 'const a = 1' },
      { kind: 'html', html: '<p>第二段</p>' },
    ])
    expect(r2.stableLen).toBe(frame2.length)
    expect(r2.tail).toBe('')
  })

  it('resets to the start when the text shrank before the stable prefix', () => {
    const r = parseStreamPrefix('短文', 500)
    // from > length: the parse restarts from 0 and the short text stays open.
    expect(r.stableLen).toBe(0)
    expect(r.tail).toBe('短文')
  })

  it('matches the terminal parse on already-closed input', () => {
    // The trailing blank line closes the last paragraph, so the whole input
    // is stable and must equal what the terminal parse would produce.
    const text = 'a\n\n```ts\nx = 1\n```\n\nb\n\n'
    const streamed = parseStreamPrefix(text, 0)
    const all = streamed.blocks
    const terminal = parseSegments(text)
    expect(all.map(b => b.kind)).toEqual(terminal.map(s => s.kind))
    expect(all[1]).toEqual({ kind: 'code', lang: 'ts', code: 'x = 1' })
  })
})
