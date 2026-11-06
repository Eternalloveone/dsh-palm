import { describe, expect, it } from 'vitest'
import { sanitizeFileName, truncate } from './text.ts'

describe('truncate', () => {
  it('leaves short text untouched', () => {
    expect(truncate('hello', 10)).toBe('hello')
    expect(truncate('hello', 5)).toBe('hello')
  })

  it('appends an ellipsis when it cuts, keeping the max length', () => {
    expect(truncate('hello world', 8)).toBe('hello w…')
    expect(truncate('hello world', 8)).toHaveLength(8)
  })

  it('supports a custom suffix', () => {
    expect(truncate('abcdef', 5, '...')).toBe('ab...')
  })

  it('handles empty input and non-positive limits', () => {
    expect(truncate('', 10)).toBe('')
    expect(truncate('abc', 0)).toBe('')
  })
})

describe('sanitizeFileName', () => {
  it('replaces characters Windows/macOS reject', () => {
    expect(sanitizeFileName('a/b:c*d?e"f<g>h|i')).toBe('a_b_c_d_e_f_g_h_i')
  })

  it('trims trailing dots and spaces', () => {
    expect(sanitizeFileName('会话名. . ')).toBe('会话名')
  })

  it('falls back for an empty title', () => {
    expect(sanitizeFileName('   ')).toBe('会话')
  })

  it('caps the stem length', () => {
    expect(sanitizeFileName('x'.repeat(100), 10)).toHaveLength(10)
  })
})
