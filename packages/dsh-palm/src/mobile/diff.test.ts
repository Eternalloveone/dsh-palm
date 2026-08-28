/**
 * Unified-diff parser and word-diff tests: hunk/header handling, line
 * numbering, degenerate shapes models emit, and the LCS word marks.
 */
import { describe, expect, it } from 'vitest'
import { applyDiffDecision, parseDiff, wordDiff } from './diff.ts'

describe('parseDiff', () => {
  it('parses file headers and hunks with line numbers', () => {
    const diff = parseDiff([
      '--- a/src/main.ts',
      '+++ b/src/main.ts',
      '@@ -1,5 +1,6 @@',
      ' const a = 1',
      '-const b = 2',
      '+const b = 3',
      '+const c = 4',
      ' const d = 5',
    ].join('\n'))
    expect(diff.oldFile).toBe('src/main.ts')
    expect(diff.newFile).toBe('src/main.ts')
    expect(diff.hunks).toHaveLength(1)
    const hunk = diff.hunks[0]!
    expect(hunk.oldStart).toBe(1)
    expect(hunk.newStart).toBe(1)
    expect(hunk.lines.map(line => line.type)).toEqual(['ctx', 'del', 'add', 'add', 'ctx'])
    const [ctx, del, add] = hunk.lines
    expect(ctx).toMatchObject({ type: 'ctx', oldNo: 1, newNo: 1, text: 'const a = 1' })
    expect(del).toMatchObject({ type: 'del', oldNo: 2, text: 'const b = 2' })
    expect(add).toMatchObject({ type: 'add', newNo: 2, text: 'const b = 3' })
  })

  it('treats header-less input as one implicit hunk', () => {
    const diff = parseDiff('- a\n+ b\n c')
    expect(diff.hunks).toHaveLength(1)
    const hunk = diff.hunks[0]!
    expect(hunk.oldStart).toBe(1)
    expect(hunk.newStart).toBe(1)
    expect(hunk.lines.map(line => line.type)).toEqual(['del', 'add', 'ctx'])
    expect(hunk.lines[2]).toMatchObject({ oldNo: 2, newNo: 2 })
  })

  it('skips "\\ No newline" markers and normalizes CRLF', () => {
    const diff = parseDiff('@@ -1,2 +1,2 @@\r\n a\r\n-b\r\n\\ No newline at end of file\r\n+b\r\n')
    expect(diff.hunks[0]!.lines.map(line => line.type)).toEqual(['ctx', 'del', 'add'])
  })

  it('pairs add/del runs and marks words', () => {
    const diff = parseDiff('@@ -1,2 +1,2 @@\n-const value = 1\n+const value = 2\n')
    const [del, add] = diff.hunks[0]!.lines
    expect(del?.words?.map(word => word.kind)).toEqual(['same', 'same', 'same', 'same', 'same', 'same', 'del'])
    expect(add?.words?.map(word => word.kind)).toEqual(['same', 'same', 'same', 'same', 'same', 'same', 'add'])
  })

  it('pairs add/del runs by index and marks the leftover as whole-line', () => {
    const diff = parseDiff('- only removed\n+ only added\n+ second added\n')
    const [del, add1, add2] = diff.hunks[0]!.lines
    // del pairs with the first add: word-level marks, not a whole-line mark.
    expect(del?.words?.some(word => word.kind === 'del')).toBe(true)
    expect(add1?.words?.some(word => word.kind === 'add')).toBe(true)
    // The unpaired second add is a whole-line change (leading space kept).
    expect(add2?.words).toEqual([{ text: ' second added', kind: 'add' }])
  })
})

describe('wordDiff', () => {
  it('marks only the changed word', () => {
    const { oldWords, newWords } = wordDiff('const value = 1', 'const value = 2')
    expect(oldWords.map(word => word.text)).toEqual(['const', ' ', 'value', ' ', '=', ' ', '1'])
    expect(oldWords.map(word => word.kind)).toEqual(['same', 'same', 'same', 'same', 'same', 'same', 'del'])
    expect(newWords.map(word => word.kind)).toEqual(['same', 'same', 'same', 'same', 'same', 'same', 'add'])
  })

  it('keeps whitespace neutral', () => {
    const { oldWords, newWords } = wordDiff('a b', 'a  b')
    for (const word of [...oldWords, ...newWords]) {
      if (/^\s+$/.test(word.text)) expect(word.kind).toBe('same')
    }
  })

  it('returns all-same for identical text', () => {
    const { oldWords, newWords } = wordDiff('same text', 'same text')
    expect(oldWords.every(word => word.kind === 'same')).toBe(true)
    expect(newWords.every(word => word.kind === 'same')).toBe(true)
  })

  it('takes the linear approximation for huge token counts', () => {
    // 200 words joined by spaces = 399 tokens; 399 x 400 cells would blow
    // the LCS budget, so the degenerate path keeps the exact common
    // prefix/suffix and marks the middle changed.
    const long = Array.from({ length: 200 }, (_, i) => `w${i}`).join(' ')
    const changed = `${long} X`
    const { oldWords, newWords } = wordDiff(long, changed)
    expect(oldWords.length).toBe(399)
    expect(newWords.length).toBe(401)
    expect(oldWords[0]!.kind).toBe('same')
    expect(oldWords[398]!.kind).toBe('same')
    expect(newWords[400]!.kind).toBe('add')
  })
})

describe('applyDiffDecision', () => {
  it('keeps context, accepted adds and rejected dels', () => {
    const diff = parseDiff('@@ -1,3 +1,3 @@\n ctx\n-del\n+add\n')
    const hunk = diff.hunks[0]!
    const delKey = `0:${hunk.lines.findIndex(line => line.type === 'del')}`
    const addKey = `0:${hunk.lines.findIndex(line => line.type === 'add')}`
    expect(applyDiffDecision(diff, new Set([addKey]), new Set([delKey]))).toBe('ctx\ndel\nadd')
    expect(applyDiffDecision(diff, new Set(), new Set())).toBe('ctx')
  })
})
