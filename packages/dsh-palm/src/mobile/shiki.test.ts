// Lightweight highlighter: token emission shape + plain fallbacks.
import { describe, expect, it } from 'vitest'
import { highlightCode, languageInfo } from './shiki.ts'

describe('lightweight highlight', () => {
  it('emits token spans for ts', async () => {
    const html = await highlightCode(
      'interface Page<T> { rows: T[]; hasMore: boolean }\n// note\nasync function loadOlder(beforeSeq?: number) {\n  return "ok" + 42\n}',
      'ts',
    )
    expect(html).toContain('tok-keyword')
    expect(html).toContain('tok-comment')
    expect(html).toContain('tok-string')
    expect(html).toContain('tok-number')
    expect(html).toContain('tok-type')
    expect(html).toContain('tok-func')
    expect(html).toContain('<span class="line">')
  })

  it('treats # lines as comments in python', async () => {
    const html = await highlightCode('# a comment\ndef f():\n    return 1\n', 'py')
    expect((html ?? '').startsWith('<pre class="shiki"')).toBe(true)
    expect(html).toContain('tok-comment')
    expect(html).toContain('tok-keyword')
    expect(html).toContain('tok-number')
  })

  it('returns null for unknown/config languages (plain fallback)', async () => {
    expect(await highlightCode('a: 1', 'yaml')).toBeNull()
    expect(await highlightCode('plain', 'weirdlang')).toBeNull()
    expect(languageInfo('py').runnable).toBe(true)
  })
})
