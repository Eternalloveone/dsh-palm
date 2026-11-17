import { describe, expect, it } from 'vitest'
import { REDACTED } from './redact.ts'
import { LONG_IMAGE_DEFAULTS, layoutLongImage, wrapLines } from './long-image.ts'
import type { ExportRow } from './export.ts'

/** Every character is 10px wide: the layout tests need no real font metrics. */
const measure = (text: string): number => [...text].length * 10

const NOW = 1_700_000_000_000

describe('wrapLines', () => {
  it('breaks Latin runs at spaces, keeping words whole', () => {
    expect(wrapLines('aaa bbb ccc', 70, measure)).toEqual(['aaa bbb', 'ccc'])
  })

  it('breaks CJK text between characters', () => {
    expect(wrapLines('中文内容测试', 30, measure)).toEqual(['中文内', '容测试'])
  })

  it('honours explicit newlines and blank paragraphs', () => {
    expect(wrapLines('a\n\nb', 100, measure)).toEqual(['a', '', 'b'])
  })

  it('force-breaks a token longer than the line', () => {
    expect(wrapLines('abcdefgh', 30, measure)).toEqual(['abc', 'def', 'gh'])
  })

  it('does not leave a leading space on a wrapped line', () => {
    const lines = wrapLines('aaa bbb', 70, measure)
    expect(lines.every(line => !line.startsWith(' '))).toBe(true)
  })
})

describe('layoutLongImage', () => {
  const rows: ExportRow[] = [
    { role: 'user', text: '看看这个 key：sk-abcdefghijklmnop1234' }, //gitleaks:allow
    { role: 'assistant', text: '收到，先不改动。' },
  ]

  it('places a title, metadata, role labels and body lines in order', () => {
    const layout = layoutLongImage('修复审批卡', rows, LONG_IMAGE_DEFAULTS, measure, NOW)
    const kinds = layout.lines.map(line => line.kind)
    expect(kinds[0]).toBe('title')
    expect(kinds).toContain('meta')
    expect(kinds).toContain('role')
    expect(kinds).toContain('body')
    expect(layout.lines[0]?.text).toBe('修复审批卡')
    expect(layout.lines.some(line => line.text === '我')).toBe(true)
    expect(layout.lines.some(line => line.text === '助手')).toBe(true)
  })

  it('redacts secrets before they reach the image', () => {
    const layout = layoutLongImage('t', rows, LONG_IMAGE_DEFAULTS, measure, NOW)
    const all = layout.lines.map(line => line.text).join('\n')
    expect(all).toContain(`sk-${REDACTED}`)
    expect(all).not.toContain('abcdefghijklmnop1234')
  })

  it('stops at maxHeight and says so instead of producing a blank image', () => {
    const options = { ...LONG_IMAGE_DEFAULTS, maxHeight: 220 }
    const many: ExportRow[] = Array.from({ length: 20 }, (_, index) => ({
      role: 'assistant' as const,
      text: `第 ${index} 行内容`,
    }))
    const layout = layoutLongImage('长会话', many, options, measure, NOW)
    expect(layout.truncated).toBe(true)
    expect(layout.lines.some(line => line.text.includes('已截断'))).toBe(true)
    expect(layout.height).toBeLessThanOrEqual(220)
  })

  it('keeps every line inside the width', () => {
    const layout = layoutLongImage('标题 '.repeat(20), rows, LONG_IMAGE_DEFAULTS, measure, NOW)
    for (const line of layout.lines) {
      expect(measure(line.text)).toBeLessThanOrEqual(LONG_IMAGE_DEFAULTS.width - LONG_IMAGE_DEFAULTS.padding * 2)
    }
  })
})
