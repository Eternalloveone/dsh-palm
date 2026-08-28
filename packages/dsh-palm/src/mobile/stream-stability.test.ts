/** Multi-frame stream regression: verify closed segments are never mutated. */
import { describe, expect, it } from 'vitest'
import { parseStreamPrefix, type StreamBlock } from '../mobile/markdown.ts'

/** Simulate the ChatView accumulator exactly as MarkdownText does. */
function simulate(texts: string[]): Array<{ id: number; block: StreamBlock }> {
  const acc: Array<{ id: number; block: StreamBlock }> = []
  let stableLen = 0
  let nextId = 0
  let prevText: string | null = null
  for (const text of texts) {
    // Text-rewrite guard (same as MarkdownText): compare the stable prefix
    // against the PREVIOUS frame's text at the same offset; on mismatch the
    // whole text re-parses from scratch.
    if (prevText !== null && stableLen > 0
      && text.slice(0, stableLen) !== prevText.slice(0, stableLen)) {
      acc.length = 0
      stableLen = 0
      nextId = 0
    }
    prevText = text
    const result = parseStreamPrefix(text, stableLen)
    for (const block of result.blocks) {
      const last = acc[acc.length - 1]
      if (block.kind === 'html' && last !== undefined && last.block.kind === 'html') {
        acc[acc.length - 1] = { id: last.id, block: { kind: 'html', html: last.block.html + block.html } }
      } else {
        acc.push({ id: nextId, block })
        nextId += 1
      }
    }
    stableLen = result.stableLen
  }
  return acc
}

/** Merge adjacent html blocks (the ChatView accumulator does this). */
function mergeAdjacentHtml(blocks: readonly StreamBlock[]): StreamBlock[] {
  const out: StreamBlock[] = []
  for (const block of blocks) {
    const last = out[out.length - 1]
    if (block.kind === 'html' && last !== undefined && last.kind === 'html') {
      out[out.length - 1] = { kind: 'html', html: last.html + block.html }
    } else {
      out.push(block)
    }
  }
  return out
}

describe('stream prefix multi-frame stability', () => {
  it('never mutates a closed paragraph across later frames', () => {
    const acc = simulate([
      '第一段 内容。\n\n',
      '第一段 内容。\n\n第二段开头',
      '第一段 内容。\n\n第二段开头续\n\n',
      '第一段 内容。\n\n第二段开头续\n\n第三段',
      '第一段 内容。\n\n第二段开头续\n\n第三段完\n\n',
    ])
    // Adjacent html runs merge into one segment (same as the terminal parse).
    expect(acc).toEqual([
      { id: 0, block: { kind: 'html', html: '<p>第一段 内容。</p><p>第二段开头续</p><p>第三段完</p>' } },
    ])
    expect(acc[0]?.block.kind === 'html' ? acc[0].block.html : '').toContain('<p>第一段 内容。</p>')
    expect(acc[0]?.block.kind === 'html' ? acc[0].block.html : '').toContain('<p>第二段开头续</p>')
  })

  it('matches a one-shot parse for the same accumulated text', () => {
    // Streaming text is always a growing PREFIX of the final text (never a
    // mid-text restart), so the rewrite guard must never fire here.
    const full = '第一段 内容。\n\n第二段开头续\n\n第三段完\n\n'
    const acc = simulate([full.slice(0, 4), full.slice(0, 12), full])
    const oneShot = parseStreamPrefix(full, 0)
    // The accumulator merges adjacent html runs; the one-shot parser emits
    // them separately — merge before comparing (rendering is identical).
    expect(acc.map(entry => entry.block)).toEqual(mergeAdjacentHtml(oneShot.blocks))
  })

  it('keeps a closed code fence stable while a later fence streams', () => {
    const acc = simulate([
      '说明\n\n```ts\nconst a = 1\n```\n\n',
      '说明\n\n```ts\nconst a = 1\n```\n\n继续\n\n```python\nprint(1)',
      '说明\n\n```ts\nconst a = 1\n```\n\n继续\n\n```python\nprint(1)\n```\n\n完\n\n',
    ])
    const kinds = acc.map(entry => entry.block.kind)
    expect(kinds).toEqual(['html', 'code', 'html', 'code', 'html'])
    expect(acc[1]?.block).toEqual({ kind: 'code', lang: 'ts', code: 'const a = 1' })
    expect(acc[3]?.block).toEqual({ kind: 'code', lang: 'python', code: 'print(1)' })
    expect(acc[4]?.block).toEqual({ kind: 'html', html: '<p>完</p>' })
  })

  it('re-parses from scratch when a final message rewrites the text', () => {
    // An assistant/message final swaps the accumulated text for the
    // authoritative content. Every incremental position becomes invalid, so
    // the whole text re-parses from zero — closed paragraphs are replaced by
    // the authoritative rendering, never mixed with stale offsets.
    const acc = simulate([
      '旧累积内容。\n\n',
      '权威终态文本。\n\n第二段\n\n',
    ])
    expect(acc).toEqual([
      { id: 0, block: { kind: 'html', html: '<p>权威终态文本。</p><p>第二段</p>' } },
    ])
  })

  it('does not repeat the tail in the accumulated blocks', () => {
    const acc = simulate(['开头\n\n中间\n', '开头\n\n中间文字\n\n结尾\n\n'])
    expect(acc).toEqual([
      { id: 0, block: { kind: 'html', html: '<p>开头</p><p>中间文字</p><p>结尾</p>' } },
    ])
  })
})
